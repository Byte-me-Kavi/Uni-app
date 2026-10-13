// Fresher selection letters, in their own PRIVATE R2 bucket with their own keys: nothing else in
// the app can read this bucket, and this function can read nothing else. A letter shows the
// student's NIC number, address and results, so it is kept only until the fresher verifies their
// university email (or is turned down, or their fresher time runs out), then deleted.
//
//   sign     a 10-minute upload URL for the fresher's letter (a JPEG photo or a PDF, up to 10 MB).
//            api.begin_letter_upload, with the fresher's token, checks they may upload now and
//            reserves letters/<student>/<id>.jpg or .pdf.
//   commit   checks the upload really is a JPEG, or a PDF with no scripts, launch actions, embedded
//            files or forms; records its SHA-256 (the same file used twice is flagged to admins);
//            only then does the letter join the queue. Anything else is deleted.
//   view     national admins: a 5-minute link to one letter (api.fresher_letter audits each view).
//   cleanup  called by the database every 30 minutes (pg_net, x-letters-secret): deletes the
//            letters in identity.letter_deletions from the bucket.
//
// Secrets: R2_ACCOUNT_ID, R2_LETTERS_BUCKET, R2_LETTERS_ACCESS_KEY_ID, R2_LETTERS_SECRET_ACCESS_KEY
// (an API token for this bucket only), LETTERS_SECRET (the same value as the Vault secret
// letters_function_secret).

import { createClient, type PostgrestError } from 'npm:@supabase/supabase-js@2.117.3';
import { AwsClient } from 'npm:aws4fetch@1.0.20';

import { inspect } from '../files/inspect.ts';

const ONCE = { 'If-None-Match': '*' };
const VIEW_SECONDS = 5 * 60;
const MAX_BYTES = 10_000_000;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

function fromDatabase(error: PostgrestError) {
  const status =
    error.code === '42501'
      ? 403
      : error.code === 'PT429'
        ? 429
        : error.code === '22023'
          ? 400
          : error.code === 'P0002'
            ? 404
            : error.code?.startsWith('PGRST3')
              ? 401
              : 500;
  return json({ error: status === 500 ? 'Something went wrong. Try again.' : error.message }, status);
}

const env = (name: string) => Deno.env.get(name) ?? '';
const ready = ['R2_ACCOUNT_ID', 'R2_LETTERS_BUCKET', 'R2_LETTERS_ACCESS_KEY_ID', 'R2_LETTERS_SECRET_ACCESS_KEY'].every((n) => env(n));
const r2 = new AwsClient({
  accessKeyId: env('R2_LETTERS_ACCESS_KEY_ID'),
  secretAccessKey: env('R2_LETTERS_SECRET_ACCESS_KEY'),
  service: 's3',
  region: 'auto',
});
const objectUrl = (path: string) => `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com/${env('R2_LETTERS_BUCKET')}/${path}`;

const service = () =>
  createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    db: { schema: 'api' },
    auth: { persistSession: false, autoRefreshToken: false },
  });

function sameSecret(a: string, b: string) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length || x.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  if (!ready) return json({ error: 'Letter uploads are not set up yet.' }, 503);

  const body = await req.json().catch(() => null);
  const action = body?.action;

  if (action === 'cleanup') {
    if (!sameSecret(req.headers.get('x-letters-secret') ?? '', env('LETTERS_SECRET'))) return json({ error: 'Not allowed.' }, 403);
    const db = service();
    const { data, error } = await db.rpc('letters_to_delete', { p_limit: 200 });
    if (error) return fromDatabase(error);
    const paths = (data ?? []) as string[];
    const results = await Promise.all(
      paths.map(async (path) => {
        const res = await r2.fetch(objectUrl(path), { method: 'DELETE' });
        // 404: never finished uploading, or already gone. Either way it is not there.
        return res.ok || res.status === 404 ? path : null;
      }),
    );
    const gone = results.filter((p): p is string => p !== null);
    if (gone.length > 0) {
      const { error: doneError } = await db.rpc('letters_deleted', { p_paths: gone });
      if (doneError) return fromDatabase(doneError);
    }
    return json({ deleted: gone.length, left: paths.length - gone.length });
  }

  const authorization = req.headers.get('Authorization');
  if (!authorization) return json({ error: 'Sign in first.' }, 401);
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    db: { schema: 'api' },
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (action === 'sign') {
    const size = Number(body.size);
    if (!Number.isInteger(size) || size <= 0) return json({ error: 'Missing file size.' }, 400);
    const { data, error } = await db.rpc('begin_letter_upload', { p_mime: String(body.mime ?? ''), p_size: size });
    if (error) return fromDatabase(error);
    const { path, mime } = data as { path: string; mime: string };
    const url = new URL(objectUrl(path));
    url.searchParams.set('X-Amz-Expires', '600');
    const headers = { 'Content-Type': mime, 'Content-Length': String(size), ...ONCE };
    const signed = await r2.sign(new Request(url, { method: 'PUT', headers }), { aws: { signQuery: true, allHeaders: true } });
    // Content-Length is set by the phone from the file itself.
    return json({ path, url: signed.url, headers: { 'Content-Type': mime, ...ONCE } });
  }

  if (action === 'commit') {
    const { data, error } = await db.rpc('letter_upload_to_check', { p_path: String(body.path ?? '') });
    if (error) return fromDatabase(error);
    const upload = data as { path: string; mime: string; size: number } | null;
    if (!upload) return json({ error: 'Upload the letter again.' }, 400);

    const object = await r2.fetch(objectUrl(upload.path));
    const bytes = object.ok ? new Uint8Array(await object.arrayBuffer()) : null;
    let verdict: { ok: true } | { ok: false; reason: string };
    if (!bytes || bytes.length !== upload.size || bytes.length > MAX_BYTES) {
      verdict = { ok: false, reason: 'The letter did not finish uploading. Try again.' };
    } else if (upload.mime === 'image/jpeg') {
      verdict =
        bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
          ? { ok: true }
          : { ok: false, reason: 'That photo could not be read. Take it again.' };
    } else {
      verdict = await inspect(bytes, 'application/pdf');
    }

    const sha = verdict.ok && bytes ? hex(await crypto.subtle.digest('SHA-256', bytes)) : null;
    const { error: saveError } = await service().rpc('letter_upload_checked', {
      p_path: upload.path,
      p_ok: verdict.ok,
      p_sha256: sha,
    });
    if (saveError) return fromDatabase(saveError);
    if (!verdict.ok) {
      await r2.fetch(objectUrl(upload.path), { method: 'DELETE' });
      return json({ error: verdict.reason }, 400);
    }
    return json({ ok: true });
  }

  if (action === 'view') {
    const { data, error } = await db.rpc('fresher_letter', { p_user_id: String(body.user_id ?? '') });
    if (error) return fromDatabase(error);
    const { path, mime } = data as { path: string; mime: string };
    const url = new URL(objectUrl(path));
    url.searchParams.set('X-Amz-Expires', String(VIEW_SECONDS));
    // Never cached on the phone or anywhere in between.
    url.searchParams.set('response-cache-control', 'no-store');
    const signed = await r2.sign(new Request(url), { aws: { signQuery: true } });
    return json({ url: signed.url, mime, expires_in: VIEW_SECONDS });
  }

  return json({ error: 'Unknown action.' }, 400);
});
