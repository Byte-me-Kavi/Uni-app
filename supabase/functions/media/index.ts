// Files in chats, and stickers, stored in Cloudflare R2. The app never holds R2 keys.
//
//   sign            a 10-minute upload URL for one photo, document or voice note, to the PRIVATE
//                   chat bucket. The database (api.begin_chat_upload, with the student's own
//                   token) checks they may post in that chat and reserves chat/<chat>/<id>.<ext>;
//                   the URL is signed for exactly that path, type and size.
//   shop_sign       a 10-minute upload URL for one shop photo, size chart or payment slip (JPEG,
//                   up to 3 MB; a slip may also be a PDF, up to 5 MB), to the private bucket.
//                   api.begin_shop_upload reserves shop/<student>/<id>.jpg or .pdf; a listing or
//                   order only accepts the student's own.
//   shop_check      after a PDF slip is uploaded: the same checks as chat documents (really a PDF;
//                   no JavaScript, launch actions, embedded files, Flash or XFA). A clean one can
//                   be used in an order; anything else is deleted and the student told why.
//   read            short-lived download links (6 hours) for private files, only those the
//                   student may see (api.media_access: files in, or forwarded to, their chats;
//                   shop photos of listings they can see; slips of their orders, or for the reps).
//   ad_sign         admins only: a 10-minute upload URL for one ad photo, GIF, video or cover
//                   image, to the PUBLIC bucket (ads/<id>.<ext>; api.begin_ad_upload checks the
//                   admin, type and size).
//   ad_commit       checks the upload's first bytes match its type (JPEG, PNG, WebP, GIF, MP4/MOV)
//                   and its size; only then can an ad use it. Anything else is deleted.
//   post_sign       up to 4 photos for a feed post, in one call: two upload URLs each (the 1080 px
//                   feed copy and the full copy) to the PUBLIC bucket (posts/<id>.jpg and
//                   posts/<id>.full.jpg; api.begin_post_upload checks the student and the sizes).
//   post_commit     checks both copies of each photo are JPEGs of the sizes reserved; only then can
//                   a post use them. Anything else is deleted.
//   post_delete     deletes the student's own post (api.delete_post) and its photos from the bucket.
//   sticker_sign    stickers are public and stored once per unique file (stickers/<sha256>.webp).
//                   If the sticker already exists it is just added to the student's library.
//   sticker_commit  checks the uploaded sticker really is a WebP whose SHA-256 is its name, then
//                   records it (api.commit_sticker, service role). Anything else is deleted.
//   cleanup         called by the database (pg_net, x-media-secret): deletes files of deleted
//                   accounts queued in ops.file_deletions, from either bucket.
//
// Secrets: R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY (public bucket:
// avatars and stickers) and R2_CHAT_BUCKET, R2_CHAT_ACCESS_KEY_ID, R2_CHAT_SECRET_ACCESS_KEY (the
// private chat bucket), and MEDIA_SECRET (the same value as the Vault secret media_function_secret).

import { createClient, type PostgrestError } from 'npm:@supabase/supabase-js@2.117.3';
import { AwsClient } from 'npm:aws4fetch@1.0.20';

import { inspect } from '../files/inspect.ts';

const CACHE_CONTROL = 'public, max-age=31536000, immutable'; // paths are never reused
// Every upload link is for one new file only (If-None-Match: *, covered by the signature): once
// the file is there, the same link cannot replace it, so a file cannot be swapped for another after
// it was checked.
const ONCE = { 'If-None-Match': '*' };
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
    error.code === '42501'
      ? 403
      : error.code === 'PT429'
        ? 429
        : error.code === '22023'
          ? 400
          : error.code?.startsWith('PGRST3')
            ? 401
            : 500;
  return json({ error: status === 500 ? 'Something went wrong. Try again.' : error.message }, status);
}

const env = (name: string) => Deno.env.get(name) ?? '';
const ready = [
  'R2_ACCOUNT_ID',
  'R2_BUCKET',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_CHAT_BUCKET',
  'R2_CHAT_ACCESS_KEY_ID',
  'R2_CHAT_SECRET_ACCESS_KEY',
].every((n) => env(n));
const publicR2 = new AwsClient({
  accessKeyId: env('R2_ACCESS_KEY_ID'),
  secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
  service: 's3',
  region: 'auto',
});
const chatR2 = new AwsClient({
  accessKeyId: env('R2_CHAT_ACCESS_KEY_ID'),
  secretAccessKey: env('R2_CHAT_SECRET_ACCESS_KEY'),
  service: 's3',
  region: 'auto',
});
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

// The first bytes of each type an ad may use.
function matchesType(b: Uint8Array, mime: string) {
  const text = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (mime === 'image/jpeg') return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (mime === 'image/png') return b[0] === 0x89 && text(1, 4) === 'PNG';
  if (mime === 'image/webp') return text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP';
  if (mime === 'image/gif') return text(0, 4) === 'GIF8';
  // MP4 and MOV: an "ftyp" box first (older MOV files may start with moov, mdat, wide or free).
  if (mime === 'video/mp4' || mime === 'video/quicktime') return ['ftyp', 'moov', 'mdat', 'wide', 'free'].includes(text(4, 8));
  return false;
}

// Constant-time comparison for the database's shared secret.
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
  if (!ready) return json({ error: 'File sharing is not set up yet.' }, 503);

  const body = await req.json().catch(() => null);
  const action = body?.action;

  if (action === 'cleanup') {
    if (!sameSecret(req.headers.get('x-media-secret') ?? '', env('MEDIA_SECRET'))) return json({ error: 'Not allowed.' }, 403);
    const service = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
      db: { schema: 'api' },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await service.rpc('files_to_delete', { p_limit: 200 });
    if (error) return fromDatabase(error);
    const files = (data ?? []) as { bucket: 'public' | 'chat'; path: string }[];
    const gone = (
      await Promise.all(
        files.map(async (f) => {
          const res =
            f.bucket === 'public'
              ? await publicR2.fetch(publicUrl(f.path), { method: 'DELETE' })
              : await chatR2.fetch(chatUrl(f.path), { method: 'DELETE' });
          // 404: already gone.
          return res.ok || res.status === 404 ? f : null;
        }),
      )
    ).filter((f): f is { bucket: 'public' | 'chat'; path: string } => f !== null);
    if (gone.length > 0) {
      const { error: doneError } = await service.rpc('files_deleted', { p_files: gone });
      if (doneError) return fromDatabase(doneError);
    }
    return json({ deleted: gone.length, left: files.length - gone.length });
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
    const { data, error } = await db.rpc('begin_chat_upload', {
      p_conversation_id: String(body.conversation_id ?? ''),
      p_kind: String(body.kind ?? ''),
      p_mime: String(body.mime ?? ''),
      p_size: size,
    });
    if (error) return fromDatabase(error);
    const { path, mime } = data as { path: string; mime: string };
    const headers = { 'Content-Type': mime, 'Content-Length': String(size), 'Cache-Control': CACHE_CONTROL, ...ONCE };
    return json({
      path,
      url: await signPut(chatR2, chatUrl(path), headers, 600),
      // Content-Length is set by the phone from the file itself.
      headers: { 'Content-Type': mime, 'Cache-Control': CACHE_CONTROL, ...ONCE },
    });
  }

  if (action === 'shop_sign') {
    const size = Number(body.size);
    if (!Number.isInteger(size) || size <= 0) return json({ error: 'Missing file size.' }, 400);
    const { data, error } = await db.rpc('begin_shop_upload', {
      p_kind: String(body.kind ?? ''),
      p_size: size,
      p_mime: body.mime === 'application/pdf' ? 'application/pdf' : 'image/jpeg',
    });
    if (error) return fromDatabase(error);
    const { path, mime } = data as { path: string; mime: string };
    const headers = { 'Content-Type': mime, 'Content-Length': String(size), 'Cache-Control': CACHE_CONTROL, ...ONCE };
    return json({
      path,
      mime,
      url: await signPut(chatR2, chatUrl(path), headers, 600),
      headers: { 'Content-Type': mime, 'Cache-Control': CACHE_CONTROL, ...ONCE },
    });
  }

  if (action === 'shop_check') {
    // Only the student's own PDF, still waiting for its check.
    const { data, error } = await db.rpc('shop_upload_to_check', { p_path: String(body.path ?? '') });
    if (error) return fromDatabase(error);
    const upload = data as { path: string; size: number; mime: string } | null;
    if (!upload) return json({ error: 'Unknown upload.' }, 400);
    const object = await chatR2.fetch(chatUrl(upload.path));
    const bytes = object.ok ? new Uint8Array(await object.arrayBuffer()) : null;
    const verdict =
      bytes && bytes.length <= 5_000_000
        ? await inspect(bytes, 'application/pdf')
        : { ok: false as const, reason: 'The PDF did not finish uploading. Try again.' };
    const service = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
      db: { schema: 'api' },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: saveError } = await service.rpc('shop_upload_checked', { p_path: upload.path, p_ok: verdict.ok });
    if (saveError) return fromDatabase(saveError);
    if (!verdict.ok) {
      await chatR2.fetch(chatUrl(upload.path), { method: 'DELETE' });
      return json({ error: verdict.reason }, 400);
    }
    return json({ ok: true });
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

  if (action === 'ad_sign') {
    const size = Number(body.size);
    if (!Number.isInteger(size) || size <= 0) return json({ error: 'Missing file size.' }, 400);
    const { data, error } = await db.rpc('begin_ad_upload', {
      p_kind: String(body.kind ?? ''),
      p_mime: String(body.mime ?? ''),
      p_size: size,
    });
    if (error) return fromDatabase(error);
    const { path, mime } = data as { path: string; mime: string };
    const headers = { 'Content-Type': mime, 'Content-Length': String(size), 'Cache-Control': CACHE_CONTROL, ...ONCE };
    return json({
      path,
      url: await signPut(publicR2, publicUrl(path), headers, 600),
      headers: { 'Content-Type': mime, 'Cache-Control': CACHE_CONTROL, ...ONCE },
    });
  }

  if (action === 'ad_commit') {
    const { data, error } = await db.rpc('ad_upload_to_check', { p_path: String(body.path ?? '') });
    if (error) return fromDatabase(error);
    const upload = data as { path: string; mime: string; size: number } | null;
    if (!upload) return json({ error: 'Unknown upload.' }, 400);
    const head = await publicR2.fetch(publicUrl(upload.path), { headers: { Range: 'bytes=0-15' } });
    const bytes = head.ok ? new Uint8Array(await head.arrayBuffer()) : null;
    const total = Number(head.headers.get('content-range')?.split('/')[1] ?? head.headers.get('content-length'));
    const ok = !!bytes && total === upload.size && matchesType(bytes, upload.mime);
    const service = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
      db: { schema: 'api' },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: saveError } = await service.rpc('ad_upload_checked', { p_path: upload.path, p_ok: ok });
    if (saveError) return fromDatabase(saveError);
    if (!ok) {
      await publicR2.fetch(publicUrl(upload.path), { method: 'DELETE' });
      return json(
        { error: bytes ? 'That file is not the photo or video it says it is.' : 'The file did not finish uploading. Try again.' },
        400,
      );
    }
    return json({ path: upload.path });
  }

  if (action === 'post_sign') {
    const photos = Array.isArray(body.photos) ? body.photos.slice(0, 4) : [];
    const { data, error } = await db.rpc('begin_post_upload', {
      p_photos: photos.map((p: Record<string, unknown>) => ({
        size: Number(p?.size),
        full_size: Number(p?.full_size),
        width: Number(p?.width),
        height: Number(p?.height),
      })),
    });
    if (error) return fromDatabase(error);
    const reserved = data as { id: string; size: number; full_size: number }[];
    const sign = (path: string, size: number) =>
      signPut(
        publicR2,
        publicUrl(path),
        { 'Content-Type': 'image/jpeg', 'Content-Length': String(size), 'Cache-Control': CACHE_CONTROL, ...ONCE },
        600,
      );
    return json({
      photos: await Promise.all(
        reserved.map(async (r) => ({
          id: r.id,
          url: await sign(`posts/${r.id}.jpg`, r.size),
          full_url: await sign(`posts/${r.id}.full.jpg`, r.full_size),
        })),
      ),
      headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': CACHE_CONTROL, ...ONCE },
    });
  }

  if (action === 'post_commit') {
    const ids = Array.isArray(body.ids) ? body.ids.filter((i: unknown) => typeof i === 'string').slice(0, 4) : [];
    const { data, error } = await db.rpc('post_uploads_to_check', { p_ids: ids });
    if (error) return fromDatabase(error);
    const uploads = (data ?? []) as { id: string; size: number; full_size: number }[];
    if (uploads.length !== ids.length) return json({ error: 'Add the photos again.' }, 400);
    const isJpeg = async (path: string, size: number) => {
      const head = await publicR2.fetch(publicUrl(path), { headers: { Range: 'bytes=0-15' } });
      const bytes = head.ok ? new Uint8Array(await head.arrayBuffer()) : null;
      const total = Number(head.headers.get('content-range')?.split('/')[1] ?? head.headers.get('content-length'));
      return !!bytes && total === size && matchesType(bytes, 'image/jpeg');
    };
    const verdicts = await Promise.all(
      uploads.map(async (u) => ({
        id: u.id,
        ok: (await isJpeg(`posts/${u.id}.jpg`, u.size)) && (await isJpeg(`posts/${u.id}.full.jpg`, u.full_size)),
      })),
    );
    const ok = verdicts.filter((v) => v.ok).map((v) => v.id);
    const bad = verdicts.filter((v) => !v.ok).map((v) => v.id);
    const service = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
      db: { schema: 'api' },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: saveError } = await service.rpc('post_uploads_checked', { p_ok: ok, p_bad: bad });
    if (saveError) return fromDatabase(saveError);
    if (bad.length > 0) {
      await Promise.all(
        bad.flatMap((id) =>
          [`posts/${id}.jpg`, `posts/${id}.full.jpg`].map((path) => publicR2.fetch(publicUrl(path), { method: 'DELETE' })),
        ),
      );
      return json({ error: 'A photo did not finish uploading. Try again.' }, 400);
    }
    return json({ ok: true });
  }

  if (action === 'post_delete') {
    const postId = Number(body.post_id);
    if (!Number.isSafeInteger(postId) || postId <= 0) return json({ error: 'Unknown post.' }, 400);
    const { data, error } = await db.rpc('delete_post', { p_post_id: postId });
    if (error) return fromDatabase(error);
    const photos = ((data ?? []) as unknown[]).filter((id): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id));
    await Promise.all(
      photos.flatMap((id) =>
        [`posts/${id}.jpg`, `posts/${id}.full.jpg`].map((path) => publicR2.fetch(publicUrl(path), { method: 'DELETE' })),
      ),
    );
    return json({ ok: true });
  }

  if (action === 'sticker_sign') {
    const size = Number(body.size);
    const hash = String(body.hash ?? '');
    const { data, error } = await db.rpc('begin_sticker_upload', { p_hash: hash, p_size: size, p_animated: !!body.animated });
    if (error) return fromDatabase(error);
    const result = data as { exists: boolean; path?: string; sticker?: string };
    if (result.exists) return json({ exists: true, sticker: result.sticker });
    const headers = { 'Content-Type': 'image/webp', 'Content-Length': String(size), 'Cache-Control': CACHE_CONTROL, ...ONCE };
    return json({
      exists: false,
      url: await signPut(publicR2, publicUrl(result.path!), headers, 600),
      headers: { 'Content-Type': 'image/webp', 'Cache-Control': CACHE_CONTROL, ...ONCE },
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
    const animated =
      text(0, Math.min(bytes.length, 64)).includes('ANIM') || text(0, Math.min(bytes.length, 4096)).includes('ANMF');

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
