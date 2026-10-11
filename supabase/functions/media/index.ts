// Files in chats, and stickers, stored in Cloudflare R2. The app never holds R2 keys.
//
//   sign            a 10-minute upload URL for one photo, document or voice note, to the PRIVATE
//                   chat bucket. The database (api.begin_chat_upload, with the student's own
//                   token) checks they may post in that chat and reserves chat/<chat>/<id>.<ext>;
//                   the URL is signed for exactly that path, type and size.
//   read            short-lived download links (6 hours) for private files, only those the
//                   student may see (api.media_access: files in, or forwarded to, their chats).
//   sticker_sign    stickers are public and stored once per unique file (stickers/<sha256>.webp).
//                   If the sticker already exists it is just added to the student's library.
//   sticker_commit  checks the uploaded sticker really is a WebP whose SHA-256 is its name, then
//                   records it (api.commit_sticker, service role). Anything else is deleted.
//
// Secrets: R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY (public bucket:
// avatars and stickers) and R2_CHAT_BUCKET, R2_CHAT_ACCESS_KEY_ID, R2_CHAT_SECRET_ACCESS_KEY (the
// private chat bucket).

import { createClient, type PostgrestError } from 'npm:@supabase/supabase-js@2.117.3';
import { AwsClient } from 'npm:aws4fetch@1.0.20';

const CACHE_CONTROL = 'public, max-age=31536000, immutable'; // paths are never reused
const READ_SECONDS = 6 * 60 * 60;
const MAX_STICKER_BYTES = 1_000_000;

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
    error.code === '42501' ? 403 : error.code === 'PT429' ? 429 : error.code === '22023' ? 400 : error.code?.startsWith('PGRST3') ? 401 : 500;
  return json({ error: status === 500 ? 'Something went wrong. Try again.' : error.message }, status);
}

const env = (name: string) => Deno.env.get(name) ?? '';
const ready = ['R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_CHAT_BUCKET', 'R2_CHAT_ACCESS_KEY_ID', 'R2_CHAT_SECRET_ACCESS_KEY'].every(
  (n) => env(n),
);
const publicR2 = new AwsClient({ accessKeyId: env('R2_ACCESS_KEY_ID'), secretAccessKey: env('R2_SECRET_ACCESS_KEY'), service: 's3', region: 'auto' });
const chatR2 = new AwsClient({ accessKeyId: env('R2_CHAT_ACCESS_KEY_ID'), secretAccessKey: env('R2_CHAT_SECRET_ACCESS_KEY'), service: 's3', region: 'auto' });
const endpoint = () => `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`;
const publicUrl = (path: string) => `${endpoint()}/${env('R2_BUCKET')}/${path}`;
const chatUrl = (path: string) => `${endpoint()}/${env('R2_CHAT_BUCKET')}/${path}`;

async function signPut(client: AwsClient, objectUrl: string, headers: Record<string, string>, seconds: number) {
  const url = new URL(objectUrl);
  url.searchParams.set('X-Amz-Expires', String(seconds));
  // allHeaders: the signature covers type, size and cache header, so R2 refuses anything else.
  const signed = await client.sign(new Request(url, { method: 'PUT', headers }), { aws: { signQuery: true, allHeaders: true } });
  return signed.url;
}

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  if (!ready) return json({ error: 'File sharing is not set up yet.' }, 503);

  const authorization = req.headers.get('Authorization');
  if (!authorization) return json({ error: 'Sign in first.' }, 401);
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    db: { schema: 'api' },
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const body = await req.json().catch(() => null);
  const action = body?.action;

  if (action === 'sign') {
    const size = Number(body.size);
    if (!Number.isInteger(size) || size <= 0) return json({ error: 'Missing file size.' }, 400);
    const { data, error } = await db.rpc('begin_chat_upload', {
      p_conversation_id: String(body.conversation_id ?? ''),
      p_kind: String(body.kind ?? ''),
      p_mime: String(body.mime ?? ''),
      p_size: size,
    });
    if (error) return fromDatabase(error);
    const { path, mime } = data as { path: string; mime: string };
    const headers = { 'Content-Type': mime, 'Content-Length': String(size), 'Cache-Control': CACHE_CONTROL };
    return json({
      path,
      url: await signPut(chatR2, chatUrl(path), headers, 600),
      // Content-Length is set by the phone from the file itself.
      headers: { 'Content-Type': mime, 'Cache-Control': CACHE_CONTROL },
    });
  }

  if (action === 'read') {
    const paths = Array.isArray(body.paths) ? body.paths.filter((p: unknown) => typeof p === 'string').slice(0, 100) : [];
    if (paths.length === 0) return json({ urls: {} });
    const { data, error } = await db.rpc('media_access', { p_paths: paths });
    if (error) return fromDatabase(error);
    const urls: Record<string, string> = {};
    for (const path of (data ?? []) as string[]) {
      const url = new URL(chatUrl(path));
      url.searchParams.set('X-Amz-Expires', String(READ_SECONDS));
      urls[path] = (await chatR2.sign(new Request(url), { aws: { signQuery: true } })).url;
    }
    return json({ urls, expires_in: READ_SECONDS });
  }

  if (action === 'sticker_sign') {
    const size = Number(body.size);
    const hash = String(body.hash ?? '');
    const { data, error } = await db.rpc('begin_sticker_upload', { p_hash: hash, p_size: size, p_animated: !!body.animated });
    if (error) return fromDatabase(error);
    const result = data as { exists: boolean; path?: string; sticker?: string };
    if (result.exists) return json({ exists: true, sticker: result.sticker });
    const headers = { 'Content-Type': 'image/webp', 'Content-Length': String(size), 'Cache-Control': CACHE_CONTROL };
    return json({
      exists: false,
      url: await signPut(publicR2, publicUrl(result.path!), headers, 600),
      headers: { 'Content-Type': 'image/webp', 'Cache-Control': CACHE_CONTROL },
    });
  }

  if (action === 'sticker_commit') {
    const hash = String(body.hash ?? '');
    if (!/^[0-9a-f]{64}$/.test(hash)) return json({ error: 'Unknown sticker.' }, 400);
    const { data: who } = await db.auth.getUser(authorization.replace(/^Bearer /i, ''));
    if (!who?.user) return json({ error: 'Sign in first.' }, 401);

    const path = `stickers/${hash}.webp`;
    const object = await publicR2.fetch(publicUrl(path));
    if (!object.ok) return json({ error: 'The sticker did not finish uploading. Try again.' }, 400);
    const bytes = new Uint8Array(await object.arrayBuffer());
    const text = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
    const webp = bytes.length <= MAX_STICKER_BYTES && text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP';
    const same = webp && hex(await crypto.subtle.digest('SHA-256', bytes)) === hash;
    if (!same) {
      await publicR2.fetch(publicUrl(path), { method: 'DELETE' });
      return json({ error: 'That file is not a sticker we can use.' }, 400);
    }
    // Animated WebP files carry an ANIM chunk near the start.
    const animated = text(0, Math.min(bytes.length, 64)).includes('ANIM') || text(0, Math.min(bytes.length, 4096)).includes('ANMF');

    const service = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
      db: { schema: 'api' },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await service.rpc('commit_sticker', {
      p_user_id: who.user.id,
      p_hash: hash,
      p_size: bytes.length,
      p_animated: animated,
    });
    if (error) return fromDatabase(error);
    return json({ sticker: data, animated });
  }

  return json({ error: 'Unknown action.' }, 400);
});
