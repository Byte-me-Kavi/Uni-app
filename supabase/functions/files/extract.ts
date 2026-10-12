// Text inside files, for search ("Dijkstra" finds Lecture 7). PDF (the first 80 pages, through
// pdf.js), Word, PowerPoint and Excel (their XML), and plain text. At most 200,000 characters.
// Runs only after a file has passed its check, in its own request, so a heavy file can never hold
// up or break the check itself.

import { readEntry, readZip } from './inspect.ts';

const MAX_CHARS = 200_000;
const MAX_PDF_PAGES = 80;

export const EXTRACTABLE = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
]);

const tidy = (text: string) =>
  text
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_CHARS);

const decodeXml = (text: string) =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');

/** The text runs of an Office XML part (<w:t>, <a:t> or <t>), a line per paragraph. */
function officeText(xml: string, tag: 'w:t' | 'a:t' | 't', paragraph: string) {
  const withBreaks = xml.split(`</${paragraph}>`).join('\n');
  const runs = withBreaks.match(new RegExp(`<${tag}(?:\\s[^>]*)?>[^<]*</${tag}>|\\n`, 'g')) ?? [];
  return decodeXml(runs.map((r) => (r === '\n' ? '\n' : r.replace(/<[^>]+>/g, ''))).join(''));
}

async function zipText(bytes: Uint8Array, mime: string) {
  const entries = readZip(bytes);
  if (!entries) return null;
  const decoder = new TextDecoder();
  const read = async (name: string) => {
    const entry = entries.find((e) => e.name === name);
    const data = entry ? await readEntry(bytes, entry, 20_000_000) : null;
    return data ? decoder.decode(data) : '';
  };
  if (mime.includes('wordprocessingml')) return officeText(await read('word/document.xml'), 'w:t', 'w:p');
  if (mime.includes('presentationml')) {
    const slides = entries
      .map((e) => e.name)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
    const parts: string[] = [];
    for (const name of slides) parts.push(officeText(await read(name), 'a:t', 'a:p'));
    return parts.join('\n\n');
  }
  return officeText(await read('xl/sharedStrings.xml'), 't', 'si');
}

async function pdfText(bytes: Uint8Array) {
  // Loaded only here: pdf.js is large and most requests never need it.
  const { getDocumentProxy } = await import('npm:unpdf@1.8.1');
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const parts: string[] = [];
  let length = 0;
  for (let n = 1; n <= Math.min(pdf.numPages, MAX_PDF_PAGES) && length < MAX_CHARS; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const text = (content.items as { str?: string; hasEOL?: boolean }[])
      .map((item) => (item.str ?? '') + (item.hasEOL ? '\n' : ' '))
      .join('');
    parts.push(text);
    length += text.length;
  }
  return parts.join('\n\n');
}

export async function extractText(bytes: Uint8Array, mime: string): Promise<string | null> {
  if (!EXTRACTABLE.has(mime)) return null;
  const text =
    mime === 'application/pdf'
      ? await pdfText(bytes)
      : mime === 'text/plain'
        ? new TextDecoder().decode(bytes.subarray(0, MAX_CHARS * 4))
        : await zipText(bytes, mime);
  const clean = text ? tidy(text) : '';
  return clean.length >= 3 ? clean : null;
}
