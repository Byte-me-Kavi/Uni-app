// File checks: is this file what its type says, and does it carry anything that runs?
//
// Not a virus scanner (ClamAV comes before regional launch; see docs/scope.md). These checks stop
// the attacks that realistically arrive through study documents:
//   * a program renamed to .pdf or .docx (the bytes must match the type);
//   * Office files with macros, ActiveX controls, embedded programs (OLE objects), or templates and
//     frames loaded from the internet (remote template injection);
//   * old-format Office files (.doc, .ppt, .xls) with macros;
//   * PDFs that run JavaScript, launch programs, carry embedded files, Flash/RichMedia or XFA forms
//     (looked for in plain objects and inside compressed object streams, with #xx escapes decoded);
//   * zip archives holding programs or scripts, or Office files with macros;
//   * "text" files that are really binary.
// Every reason is written for the student who sent the file.

export type Verdict = { ok: true } | { ok: false; reason: string };

const OK: Verdict = { ok: true };
const no = (reason: string): Verdict => ({ ok: false, reason });
const NOT_WHAT_IT_SAYS = 'This file is not the type its name says.';
const UNREADABLE = 'This file could not be checked, so it was not shared.';

const OOXML = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);
const LEGACY_OFFICE = new Set(['application/msword', 'application/vnd.ms-powerpoint', 'application/vnd.ms-excel']);

const startsWith = (bytes: Uint8Array, prefix: number[], at = 0) => prefix.every((b, i) => bytes[at + i] === b);
const latin1 = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);

export async function inspect(bytes: Uint8Array, mime: string): Promise<Verdict> {
  if (bytes.length === 0) return no('The file is empty.');
  try {
    if (mime === 'application/pdf') return await inspectPdf(bytes);
    if (OOXML.has(mime)) return await inspectOoxml(bytes);
    if (LEGACY_OFFICE.has(mime)) return inspectLegacyOffice(bytes);
    if (mime === 'application/zip') return await inspectZip(bytes);
    if (mime === 'text/plain') return inspectText(bytes);
    if (mime === 'image/jpeg') return startsWith(bytes, [0xff, 0xd8, 0xff]) ? OK : no(NOT_WHAT_IT_SAYS);
    if (mime === 'image/png') return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ? OK : no(NOT_WHAT_IT_SAYS);
    if (mime === 'image/webp') {
      return startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8) ? OK : no(NOT_WHAT_IT_SAYS);
    }
    return no('This kind of file is not allowed.');
  } catch {
    return no(UNREADABLE);
  }
}

// ---------------------------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------------------------

// Names may hide letters as #xx escapes: /J#61vaScript is /JavaScript.
const unescapeNames = (text: string) =>
  text.replace(/\/[^\s/<>[\]()%]+/g, (name) => name.replace(/#([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))));

const PDF_ACTIVE: [RegExp, string][] = [
  [/\/(JavaScript|JS)(?![A-Za-z])/, 'This PDF runs scripts.'],
  [/\/Launch(?![A-Za-z])/, 'This PDF tries to open programs.'],
  [/\/(EmbeddedFiles?|FileAttachment)(?![A-Za-z])/, 'This PDF carries other files inside it.'],
  [/\/RichMedia(?![A-Za-z])/, 'This PDF carries Flash or other embedded media.'],
  [/\/XFA(?![A-Za-z])/, 'This PDF uses XFA forms, which can run scripts.'],
];

function pdfFinding(text: string): string | null {
  const clean = /#[0-9A-Fa-f]{2}/.test(text) ? unescapeNames(text) : text;
  for (const [pattern, reason] of PDF_ACTIVE) if (pattern.test(clean)) return reason;
  return null;
}

async function inspectPdf(bytes: Uint8Array): Promise<Verdict> {
  const text = latin1(bytes);
  const header = text.indexOf('%PDF-');
  if (header < 0 || header > 1024) return no(NOT_WHAT_IT_SAYS);
  const plain = pdfFinding(text);
  if (plain) return no(plain);

  // Object streams (PDF 1.5+) keep dictionaries compressed, where names cannot be seen. Inflate
  // each one (they are small) and look again.
  const objStm = /\/Type\s*\/ObjStm/g;
  let match: RegExpExecArray | null;
  let seen = 0;
  while ((match = objStm.exec(text)) && seen < 500) {
    seen++;
    const dictStart = text.lastIndexOf('<<', match.index);
    const streamAt = text.indexOf('stream', match.index);
    if (dictStart < 0 || streamAt < 0) continue;
    const dict = text.slice(dictStart, streamAt);
    let start = streamAt + 'stream'.length;
    if (text[start] === '\r') start++;
    if (text[start] === '\n') start++;
    let end = text.indexOf('endstream', start);
    if (end < 0) continue;
    // The line break before "endstream" is not part of the data.
    while (end > start && (text[end - 1] === '\n' || text[end - 1] === '\r')) end--;
    if (!/\/FlateDecode/.test(dict)) continue;
    const inflated = await inflate(bytes.subarray(start, end), 'deflate', 8_000_000, true).catch(() => null);
    if (!inflated) continue;
    const found = pdfFinding(latin1(inflated));
    if (found) return no(found);
  }
  return OK;
}

// ---------------------------------------------------------------------------------------------
// Zip (and Office Open XML, which is a zip)
// ---------------------------------------------------------------------------------------------

type ZipEntry = { name: string; method: number; compressedSize: number; size: number; localOffset: number };

export function readZip(bytes: Uint8Array): ZipEntry[] | null {
  if (!startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end-of-central-directory record is within the last 64 KB.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  if (count === 0xffff || at === 0xffffffff) return null; // zip64: not expected in study files
  const entries: ZipEntry[] = [];
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) return null;
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    entries.push({
      method: view.getUint16(at + 10, true),
      compressedSize: view.getUint32(at + 20, true),
      size: view.getUint32(at + 24, true),
      localOffset: view.getUint32(at + 42, true),
      name: decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength)),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export async function readEntry(bytes: Uint8Array, entry: ZipEntry, limit: number): Promise<Uint8Array | null> {
  if (entry.size > limit) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = entry.localOffset;
  if (at + 30 > bytes.length || view.getUint32(at, true) !== 0x04034b50) return null;
  const start = at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true);
  const data = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return await inflate(data, 'deflate-raw', limit);
  return null;
}

const EXECUTABLE = /\.(exe|com|bat|cmd|scr|pif|msi|msp|dll|cpl|jar|js|jse|vbs|vbe|wsf|wsh|ps1|psm1|hta|lnk|apk|app|sh|reg|iso|img)$/i;
const MACRO_OFFICE = /\.(docm|dotm|xlsm|xltm|xlam|pptm|potm|ppam|ppsm|sldm)$/i;

async function inspectOoxml(bytes: Uint8Array): Promise<Verdict> {
  const entries = readZip(bytes);
  if (!entries) return no(NOT_WHAT_IT_SAYS);
  const names = entries.map((e) => e.name);
  if (!names.includes('[Content_Types].xml')) return no(NOT_WHAT_IT_SAYS);
  if (names.some((n) => /(^|\/)vbaProject\.bin$/i.test(n) || /(^|\/)vbaData\.xml$/i.test(n))) return no('This file has macros.');
  if (names.some((n) => /(^|\/)activeX\//i.test(n))) return no('This file has ActiveX controls.');
  if (names.some((n) => /\/embeddings\/.*(\.bin|oleObject)/i.test(n) || EXECUTABLE.test(n) || MACRO_OFFICE.test(n))) {
    return no('This file has programs embedded in it.');
  }

  for (const entry of entries) {
    const isTypes = entry.name === '[Content_Types].xml';
    if (!isTypes && !entry.name.endsWith('.rels')) continue;
    const data = await readEntry(bytes, entry, 2_000_000);
    if (!data) return no(UNREADABLE);
    const xml = new TextDecoder().decode(data);
    if (isTypes) {
      if (/macroEnabled/i.test(xml)) return no('This file has macros.');
      continue;
    }
    // Relationships that pull content from the internet when the file opens.
    for (const rel of xml.match(/<Relationship\b[^>]*>/g) ?? []) {
      if (!/TargetMode\s*=\s*["']External["']/i.test(rel)) continue;
      if (/Type\s*=\s*["'][^"']*\/(attachedTemplate|oleObject|frame|subDocument|package)["']/i.test(rel)) {
        return no('This file loads content from the internet when it opens.');
      }
    }
  }
  return OK;
}

async function inspectZip(bytes: Uint8Array): Promise<Verdict> {
  const entries = readZip(bytes);
  if (!entries) return no(NOT_WHAT_IT_SAYS);
  if (entries.some((e) => EXECUTABLE.test(e.name))) return no('This archive has programs or scripts inside.');
  if (entries.some((e) => MACRO_OFFICE.test(e.name) || /(^|\/)vbaProject\.bin$/i.test(e.name))) {
    return no('This archive has files with macros inside.');
  }
  if (entries.some((e) => /\.zip$/i.test(e.name))) return no('Archives inside archives cannot be checked.');
  return OK;
}

// ---------------------------------------------------------------------------------------------
// Old Office formats (Compound File Binary)
// ---------------------------------------------------------------------------------------------

function utf16(text: string) {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) out[i * 2] = text.charCodeAt(i);
  return out;
}

function contains(bytes: Uint8Array, needle: Uint8Array) {
  outer: for (let i = 0; i <= bytes.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

// Every VBA project has a _VBA_PROJECT stream (a name no ordinary text contains).
const VBA_MARKER = utf16('_VBA_PROJECT');

function inspectLegacyOffice(bytes: Uint8Array): Verdict {
  if (!startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return no(NOT_WHAT_IT_SAYS);
  // Storage and stream names in the directory are UTF-16.
  if (contains(bytes, VBA_MARKER)) return no('This file has macros.');
  return OK;
}

// ---------------------------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------------------------

function inspectText(bytes: Uint8Array): Verdict {
  const head = bytes.subarray(0, 8192);
  for (const b of head) if (b === 0) return no(NOT_WHAT_IT_SAYS);
  return OK;
}

// ---------------------------------------------------------------------------------------------
// Inflating, with a size cap (no zip bombs)
// ---------------------------------------------------------------------------------------------

// partial: on a damaged stream, return what was inflated before the damage (enough to look for
// names in; a file cannot hide a script by corrupting the end of its own stream).
async function inflate(data: Uint8Array, format: 'deflate' | 'deflate-raw', limit: number, partial = false): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream(format));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    let next: ReadableStreamReadResult<Uint8Array>;
    try {
      next = await reader.read();
    } catch (error) {
      if (partial && total > 0) break;
      throw error;
    }
    const { done, value } = next;
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new Error('too large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
