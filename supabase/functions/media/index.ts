// Photos and documents sent in chats, stored in Cloudflare R2.
//
// The app never holds R2 keys. To send a file it calls this function (action "sign") with the chat,
// kind, type and size. The database (api.begin_chat_upload, with the student's own token) checks
// they may post in that chat, rate-limits, and reserves a fresh path under chat/<chat id>/; this
// function returns a 10-minute upload URL signed for exactly that path, type and size, so R2
// refuses anything else. The phone uploads straight to R2 (no bytes pass through here), then sends
// the message, which only accepts an upload the same student made for that chat.
//
// Files are read through the public media URL. Paths contain two random ids (122 bits each), so
// they cannot be guessed; anyone given a link can open it, as with most chat apps' media links.
//
// Secrets: R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY (shared with `avatar`).

import { createClient, type PostgrestError } from 'npm:@supabase/supabase-js@2.117.3';
import { AwsClient } from 'npm:aws4fetch@1.0.20';

const CACHE_CONTROL = 'public, max-age=31536000, immutable'; // paths are never reused

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  if (!r2Ready) return json({ error: 'File sharing is not set up yet.' }, 503);

  const authorization = req.headers.get('Authorization');
  if (!authorization) return json({ error: 'Sign in first.' }, 401);
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    db: { schema: 'api' },
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const body = await req.json().catch(() => null);
  if (body?.action !== 'sign') return json({ error: 'Unknown action.' }, 400);

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

  const url = new URL(objectUrl(path));
  url.searchParams.set('X-Amz-Expires', '600');
  const headers = { 'Content-Type': mime, 'Content-Length': String(size), 'Cache-Control': CACHE_CONTROL };
  // allHeaders: the signature covers type, size and cache header, so R2 refuses anything else.
  const signed = await r2.sign(new Request(url, { method: 'PUT', headers }), { aws: { signQuery: true, allHeaders: true } });
  return json({
    path,
    url: signed.url,
    // Content-Length is set by the phone from the file itself.
    headers: { 'Content-Type': mime, 'Cache-Control': CACHE_CONTROL },
  });
});
