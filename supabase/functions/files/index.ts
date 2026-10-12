// Shared-library files and file checks. Files live in the private chat bucket in Cloudflare R2
// (shared files under resources/), read through the media function's signed links.
//
// Called by students (their own token; the database decides what they may do):
//   resource_upload   sign a 10-minute upload for a new shared file (api.begin_resource_upload
//                     reserves resources/<id>.<ext>; the URL is signed for exactly that key, type
//                     and size)
//   resource_finish   after that upload: check the file, then make it live or quarantine it
//   resource_publish  share a file from a chat (api.begin_publish checks the student may): copy
//                     it inside R2 to its own key, check it, then make it live or quarantine it
//
// Called by the database (pg_net, with the shared secret FILES_SECRET in x-files-secret):
//   check_chat        check a document or photo just shared in a chat; a file that fails is
//                     blocked for everyone (api.chat_file_checked)
//
// Called by itself, after a file passes (same secret, a separate request so a heavy file never
// holds up a check):
//   extract_text      the text inside a PDF, Word, PowerPoint, Excel or text file, for search,
//                     stored once per fingerprint (api.store_file_text)
//
// Every checked file is fingerprinted (SHA-256), so duplicates are recognised.
//
// Secrets: R2_ACCOUNT_ID, R2_CHAT_BUCKET, R2_CHAT_ACCESS_KEY_ID, R2_CHAT_SECRET_ACCESS_KEY,
// FILES_SECRET (the same value as the Vault secret `files_function_secret`).

import { createClient, type PostgrestError } from 'npm:@supabase/supabase-js@2.117.3';
import { AwsClient } from 'npm:aws4fetch@1.0.20';

import { extractText, EXTRACTABLE } from './extract.ts';
import { inspect } from './inspect.ts';

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

const MAX_BYTES = 26_214_400;
const CACHE_CONTROL = 'private, max-age=31536000, immutable';
// Every upload link is for one new file only (If-None-Match: *, covered by the signature): once
// the file is there, the same link cannot replace it, so a file cannot be swapped for another after
// it was checked.
const ONCE = { 'If-None-Match': '*' };

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const env = (name: string) => Deno.env.get(name) ?? '';
const ready = ['R2_ACCOUNT_ID', 'R2_CHAT_BUCKET', 'R2_CHAT_ACCESS_KEY_ID', 'R2_CHAT_SECRET_ACCESS_KEY'].every((n) => env(n));
const r2 = new AwsClient({
  accessKeyId: env('R2_CHAT_ACCESS_KEY_ID'),
  secretAccessKey: env('R2_CHAT_SECRET_ACCESS_KEY'),
  service: 's3',
  region: 'auto',
});
const objectUrl = (key: string) => `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com/${env('R2_CHAT_BUCKET')}/${key}`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

function fromDatabase(error: PostgrestError) {
  const status =
    error.code === '42501' ? 403 : error.code === 'PT429' ? 429 : error.code === '22023' ? 400 : error.code === 'P0002' ? 404 : 500;
  return json({ error: status === 500 ? 'Something went wrong. Try again.' : error.message }, status);
}

// Compares in constant time, so the secret cannot be guessed one character at a time.
function sameSecret(a: string, b: string) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length || x.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

const service = () =>
  createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    db: { schema: 'api' },
    auth: { persistSession: false, autoRefreshToken: false },
  });

/** The object's bytes, or null if it is missing or too large. */
async function download(key: string): Promise<Uint8Array | null> {
  const response = await r2.fetch(objectUrl(key));
  if (!response.ok) return null;
  const length = Number(response.headers.get('Content-Length') ?? '0');
  if (length > MAX_BYTES) {
    await response.body?.cancel();
    return null;
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return bytes.length > MAX_BYTES ? null : bytes;
}

const fingerprint = async (bytes: Uint8Array) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');

/** After a file passes: extract its text in a request of its own (search inside files). */
function extractLater(key: string, mime: string, sha256: string) {
  if (!EXTRACTABLE.has(mime) || !env('FILES_SECRET')) return;
  const request = fetch(`${env('SUPABASE_URL')}/functions/v1/files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-files-secret': env('FILES_SECRET') },
    body: JSON.stringify({ action: 'extract_text', key, mime, sha256 }),
  }).catch(() => {});
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(request);
}

/** Checks a shared file already at its key, and records the verdict. */
async function checkResource(resourceId: string, key: string, mime: string) {
  const bytes = await download(key);
  const verdict = bytes ? await inspect(bytes, mime) : { ok: false as const, reason: 'The file did not finish uploading. Try again.' };
  const sha256 = bytes ? await fingerprint(bytes) : null;
  const { data, error } = await service().rpc('finish_resource', {
    p_resource_id: resourceId,
    p_ok: verdict.ok,
    p_reason: verdict.ok ? null : verdict.reason,
    p_size: bytes?.length ?? null,
    p_sha256: sha256,
  });
  if (error) return fromDatabase(error);
  if ((data as { status?: string } | null)?.status === 'live' && sha256) extractLater(key, mime, sha256);
  return json(data);
}

async function signPut(key: string, headers: Record<string, string>, seconds: number) {
  const url = new URL(objectUrl(key));
  url.searchParams.set('X-Amz-Expires', String(seconds));
  const signed = await r2.sign(new Request(url, { method: 'PUT', headers }), { aws: { signQuery: true, allHeaders: true } });
  return signed.url;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  if (!ready) return json({ error: 'File sharing is not set up yet.' }, 503);

  const body = await req.json().catch(() => null);
  const action = body?.action;

  // ------------------------------------------------------------------ from the database, or itself
  const trusted = !!env('FILES_SECRET') && sameSecret(req.headers.get('x-files-secret') ?? '', env('FILES_SECRET'));

  if (action === 'extract_text') {
    if (!trusted) return json({ error: 'Not allowed.' }, 401);
    const key = String(body.key ?? '');
    const sha256 = String(body.sha256 ?? '');
    const mime = String(body.mime ?? '');
    if (!/^[0-9a-f]{64}$/.test(sha256) || !(key.startsWith('chat/') || key.startsWith('resources/'))) {
      return json({ error: 'Bad request.' }, 400);
    }
    const { data: needed } = await service().rpc('needs_text', { p_sha256: sha256 });
    if (needed === false) return json({ extracted: false, reason: 'already' });
    const bytes = await download(key);
    if (!bytes) return json({ extracted: false });
    const text = await extractText(bytes, mime).catch(() => null);
    if (!text) return json({ extracted: false });
    const { error } = await service().rpc('store_file_text', { p_sha256: sha256, p_text: text });
    if (error) return fromDatabase(error);
    return json({ extracted: true, characters: text.length });
  }

  if (action === 'check_chat') {
    if (!trusted) return json({ error: 'Not allowed.' }, 401);
    const messageId = String(body.message_id ?? '');
    const path = String(body.path ?? '');
    if (!/^[0-9a-f-]{36}$/.test(messageId) || !path.startsWith('chat/')) return json({ error: 'Bad request.' }, 400);
    const bytes = await download(path);
    // A file that is not there (yet) stays unchecked; nothing is blocked on a network error.
    if (!bytes) return json({ checked: false });
    const mime = String(body.mime ?? '');
    const verdict = await inspect(bytes, mime);
    const sha256 = await fingerprint(bytes);
    const { error } = await service().rpc('chat_file_checked', {
      p_message_id: messageId,
      p_ok: verdict.ok,
      p_reason: verdict.ok ? null : verdict.reason,
      p_sha256: sha256,
    });
    if (error) return fromDatabase(error);
    if (verdict.ok) extractLater(path, mime, sha256);
    return json({ checked: true, ok: verdict.ok });
  }

  // ------------------------------------------------------------------ from students
  const authorization = req.headers.get('Authorization');
  if (!authorization) return json({ error: 'Sign in first.' }, 401);
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    db: { schema: 'api' },
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (action === 'resource_upload') {
    const size = Number(body.size);
    const { data, error } = await db.rpc('begin_resource_upload', {
      p_module_id: Number(body.module_id),
      p_category: String(body.category ?? ''),
      p_title: String(body.title ?? ''),
      p_mime: String(body.mime ?? ''),
      p_size: Number.isInteger(size) ? size : -1,
      ...(body.paper_year ? { p_paper_year: Number(body.paper_year) } : {}),
      ...(body.scope ? { p_scope: String(body.scope) } : {}),
    });
    if (error) return fromDatabase(error);
    const { resource_id, key, mime } = data as { resource_id: string; key: string; mime: string };
    const headers = { 'Content-Type': mime, 'Content-Length': String(size), 'Cache-Control': CACHE_CONTROL, ...ONCE };
    return json({
      resource_id,
      url: await signPut(key, headers, 600),
      // Content-Length is set by the phone from the file itself.
      headers: { 'Content-Type': mime, 'Cache-Control': CACHE_CONTROL, ...ONCE },
    });
  }

  if (action === 'resource_finish') {
    const { data, error } = await db.rpc('pending_resource', { p_resource_id: String(body.resource_id ?? '') });
    if (error) return fromDatabase(error);
    if (!data) return json({ error: 'That file is not waiting to be shared.' }, 404);
    const pending = data as { resource_id: string; key: string; mime: string };
    return checkResource(pending.resource_id, pending.key, pending.mime);
  }

  if (action === 'resource_publish') {
    const { data, error } = await db.rpc('begin_publish', {
      p_message_id: String(body.message_id ?? ''),
      p_module_id: Number(body.module_id),
      p_category: String(body.category ?? ''),
      ...(body.title ? { p_title: String(body.title) } : {}),
      ...(body.paper_year ? { p_paper_year: Number(body.paper_year) } : {}),
      ...(body.scope ? { p_scope: String(body.scope) } : {}),
    });
    if (error) return fromDatabase(error);
    const started = data as { resource_id: string; key: string; source_path: string; mime: string };
    // Copied inside R2: the shared file outlives the chat message, and nothing passes through here.
    const copy = await r2.fetch(objectUrl(started.key), {
      method: 'PUT',
      headers: { 'x-amz-copy-source': `/${env('R2_CHAT_BUCKET')}/${started.source_path}` },
    });
    if (!copy.ok) {
      await service().rpc('finish_resource', {
        p_resource_id: started.resource_id,
        p_ok: false,
        p_reason: 'This file could not be copied. Try again.',
      });
      return json({ error: 'This file could not be shared. Try again.' }, 502);
    }
    return checkResource(started.resource_id, started.key, started.mime);
  }

  return json({ error: 'Unknown action.' }, 400);
});
