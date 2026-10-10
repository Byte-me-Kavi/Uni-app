// Profile photos in Cloudflare R2.
//
// The app never holds R2 keys. It calls this function, which holds them as Supabase secrets:
//   sign    -> the database picks a fresh path in the caller's own folder (api.begin_avatar_upload,
//              rate-limited), and the caller gets a 2-minute upload URL signed for exactly that
//              path, size and type.
//   commit  -> checks the file arrived, is a JPEG under 1 MB, records it (api.set_my_avatar, which
//              only accepts the caller's own folder) and deletes the previous photo.
//   remove  -> clears the photo and deletes its file.
// Every database call runs with the caller's own token, so the database decides who they are and
// whether their account is active. The phone resizes photos to 512x512 JPEG (about 50 to 150 KB)
// and re-encoding drops EXIF data such as location.
//
// Secrets: R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
// (an R2 API token with Object Read & Write on this bucket only).

import { createClient, type PostgrestError } from 'npm:@supabase/supabase-js@2.117.3';
import { AwsClient } from 'npm:aws4fetch@1.0.20';

const MAX_BYTES = 1_000_000;
const CACHE_CONTROL = 'public, max-age=31536000, immutable'; // paths are never reused
const PATH = /^avatars\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/;

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
const r2Ready = ['R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'].every((n) => env(n));
const r2 = new AwsClient({
  accessKeyId: env('R2_ACCESS_KEY_ID'),
  secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
  service: 's3',
  region: 'auto',
});
const objectUrl = (path: string) => `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com/${env('R2_BUCKET')}/${path}`;

async function deleteObject(path: string | null) {
  if (path && PATH.test(path)) await r2.fetch(objectUrl(path), { method: 'DELETE' });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  if (!r2Ready) return json({ error: 'Photo uploads are not set up yet.' }, 503);

  const authorization = req.headers.get('Authorization');
  if (!authorization) return json({ error: 'Sign in first.' }, 401);
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    db: { schema: 'api' },
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const body = await req.json().catch(() => null);

  if (body?.action === 'sign') {
    const size = Number(body.size);
    if (!Number.isInteger(size) || size <= 0) return json({ error: 'Missing photo size.' }, 400);
    if (size > MAX_BYTES) return json({ error: 'That photo is too large. Choose another.' }, 400);

    const { data: path, error } = await db.rpc('begin_avatar_upload');
    if (error) return fromDatabase(error);

    const url = new URL(objectUrl(path as string));
    url.searchParams.set('X-Amz-Expires', '120');
    const headers = { 'Content-Type': 'image/jpeg', 'Content-Length': String(size), 'Cache-Control': CACHE_CONTROL };
    // allHeaders: the signature covers type, size and cache header, so R2 refuses anything else.
    const signed = await r2.sign(new Request(url, { method: 'PUT', headers }), { aws: { signQuery: true, allHeaders: true } });
    return json({
      path,
      url: signed.url,
      // Content-Length is set by the phone from the file itself.
      headers: { 'Content-Type': headers['Content-Type'], 'Cache-Control': CACHE_CONTROL },
    });
  }

  if (body?.action === 'commit') {
    const path = String(body.path ?? '');
    if (!PATH.test(path)) return json({ error: 'Unknown photo.' }, 400);

    // The first bytes of every JPEG are FF D8 FF.
    const head = await r2.fetch(objectUrl(path), { headers: { Range: 'bytes=0-2' } });
    const bytes = head.ok ? new Uint8Array(await head.arrayBuffer()) : null;
    const total = Number(head.headers.get('content-range')?.split('/')[1] ?? head.headers.get('content-length'));
    if (!bytes) return json({ error: 'The photo did not finish uploading. Try again.' }, 400);
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff || !(total <= MAX_BYTES)) {
      return json({ error: 'That file is not a photo we can use.' }, 400);
    }

    // Refuses paths outside the caller's own folder, so nobody can claim another student's photo.
    const { data: old, error } = await db.rpc('set_my_avatar', { p_path: path });
    if (error) return fromDatabase(error);
    if (old !== path) await deleteObject(old as string | null);
    return json({ avatar_path: path });
  }

  if (body?.action === 'remove') {
    const { data: old, error } = await db.rpc('set_my_avatar', { p_path: null });
    if (error) return fromDatabase(error);
    await deleteObject(old as string | null);
    return json({ avatar_path: null });
  }

  return json({ error: 'Unknown action.' }, 400);
});
