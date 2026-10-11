// A preview for a link a student is about to send: title, description, image and site name from
// the page's Open Graph tags (or its <title>). Called by the sender's app while they type, as in
// WhatsApp; the preview then travels inside the message, so the people receiving it never contact
// the site just because a message arrived.
//
// Only public web pages: http(s) on the normal ports, no IP addresses in private ranges and no
// local names, at most 3 redirects (each checked), 5 seconds and the first 400 KB of the page.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

const env = (name: string) => Deno.env.get(name) ?? '';
const MAX_BYTES = 400_000;
const cache = new Map<string, { at: number; preview: unknown }>(); // per instance, an hour

function isPublic(url: URL) {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (url.port && url.port !== '443' && url.port !== '80') return false;
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || /(^|\.)(localhost|local|internal|lan|home|corp)$/.test(host)) return false;
  if (host.startsWith('[') || host.includes(':')) return false; // IPv6 literals
  const ip = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ip) {
    const [a, b] = [Number(ip[1]), Number(ip[2])];
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224 || (a === 100 && b >= 64 && b <= 127)) {
      return false;
    }
  }
  return true;
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();

function meta(html: string, names: string[]) {
  for (const name of names) {
    const tag = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, 'i').exec(html)?.[0];
    const content = tag && /content=["']([^"']*)["']/i.exec(tag)?.[1];
    if (content) return decode(content);
  }
  return null;
}

async function fetchPage(start: URL) {
  let url = start;
  for (let hop = 0; hop < 4; hop++) {
    if (!isPublic(url)) return null;
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'UniEraLinkPreview/1.0 (+https://uniera.lk)', Accept: 'text/html' },
    });
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get('location');
      await response.body?.cancel();
      if (!next) return null;
      url = new URL(next, url);
      continue;
    }
    if (!response.ok || !(response.headers.get('content-type') ?? '').includes('text/html')) {
      await response.body?.cancel();
      return null;
    }
    const reader = response.body!.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    await reader.cancel().catch(() => {});
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c.subarray(0, Math.min(c.length, total - offset)), offset);
      offset += c.length;
    }
    return { url, html: new TextDecoder().decode(bytes) };
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  // Signed-in students only.
  const authorization = req.headers.get('Authorization') ?? '';
  const who = await fetch(`${env('SUPABASE_URL')}/auth/v1/user`, {
    headers: { Authorization: authorization, apikey: env('SUPABASE_ANON_KEY') },
  });
  if (!who.ok) return json({ error: 'Sign in first.' }, 401);

  const body = await req.json().catch(() => null);
  let target: URL;
  try {
    target = new URL(String(body?.url ?? ''));
  } catch {
    return json({ preview: null });
  }
  const key = target.toString();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 3_600_000) return json({ preview: hit.preview });

  let preview: Record<string, string> | null = null;
  try {
    const page = await fetchPage(target);
    if (page) {
      const title = meta(page.html, ['og:title', 'twitter:title']) ?? decode(/<title[^>]*>([^<]*)<\/title>/i.exec(page.html)?.[1] ?? '');
      const image = meta(page.html, ['og:image:secure_url', 'og:image', 'twitter:image']);
      const imageUrl = image ? new URL(image, page.url) : null;
      if (title) {
        preview = {
          url: key,
          title: title.slice(0, 200),
          ...(meta(page.html, ['og:description', 'description', 'twitter:description'])
            ? { description: meta(page.html, ['og:description', 'description', 'twitter:description'])!.slice(0, 300) }
            : {}),
          site: (meta(page.html, ['og:site_name']) ?? page.url.hostname.replace(/^www\./, '')).slice(0, 100),
          ...(imageUrl && imageUrl.protocol === 'https:' ? { image: imageUrl.toString().slice(0, 1000) } : {}),
        };
      }
    }
  } catch {
    preview = null;
  }
  cache.set(key, { at: Date.now(), preview });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return json({ preview });
});
