// Photos are served straight from the public R2 bucket. Paths are random per upload, so a URL never
// changes content and can be cached forever.
const base = process.env.EXPO_PUBLIC_MEDIA_URL?.replace(/\/$/, '');

export function mediaUrl(path: string | null | undefined): string | null {
  return path && base ? `${base}/${path}` : null;
}
