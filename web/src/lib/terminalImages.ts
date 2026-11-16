/**
 * Compatibility shim between agents that speak iTerm2 inline images
 * (OSC 1337 ; File=) and @xterm/addon-image.
 *
 * Two gaps make otherwise valid sequences render as nothing:
 *  - the addon aborts when `size` is missing, while several agents (omp among
 *    them) omit it because iTerm2 infers it from the payload;
 *  - the addon decodes PNG, JPEG and GIF only, while agents ship WebP.
 *
 * Everything else passes through byte-for-byte, and a chunk with no image in it
 * is handed on without copying or decoding.
 */

const OSC_IMAGE = '\x1b]1337;File=';
const PREFIX = new TextEncoder().encode(OSC_IMAGE);
const COLON = new Uint8Array([0x3a]);
const EMPTY = new Uint8Array(0);
const BEL = 0x07;
const ESC = 0x1b;
const BASE64_CHUNK = 0x8000;

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, from: number): number {
  const last = haystack.length - needle.length;
  outer: for (let i = from; i <= last; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/** Index just past the OSC terminator (BEL or ST), or -1 when incomplete. */
function endOfOsc(bytes: Uint8Array, from: number): number {
  for (let i = from; i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte === BEL) return i + 1;
    if (byte === ESC && bytes[i + 1] === 0x5c) return i + 2;
  }
  return -1;
}

/** Index where the payload stops: before BEL or before the ST introducer. */
function endOfPayload(bytes: Uint8Array, oscEnd: number): number {
  return bytes[oscEnd - 1] === BEL ? oscEnd - 1 : oscEnd - 2;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function decodeBase64(text: string): Uint8Array | null {
  try {
    const raw = atob(text);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function encodeBase64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    text += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
  }
  return btoa(text);
}

function isWebp(bytes: Uint8Array): boolean {
  return (
    bytes.length > 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  );
}

async function webpToPng(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') return null;
  try {
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/webp' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return null;
    }
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null;
  }
}

function fieldValue(fields: string[], key: string): string | undefined {
  const prefix = `${key}=`;
  for (const field of fields) {
    if (field.startsWith(prefix)) return field.slice(prefix.length);
  }
  return undefined;
}

function buildImageOsc(fields: string[], payload: string): Uint8Array {
  return new TextEncoder().encode(`${OSC_IMAGE}${fields.join(';')}:${payload}\x07`);
}

/**
 * Rewrites one complete image OSC so the addon accepts it. Returns null when
 * the sequence is already acceptable, and a promise only when the payload has
 * to be re-encoded.
 */
function rewriteImageOsc(seq: Uint8Array, headerEnd: number, payloadEnd: number): Uint8Array | null | Promise<Uint8Array | null> {
  const header = new TextDecoder().decode(seq.subarray(PREFIX.length, headerEnd));
  const fields = header.split(';').filter(Boolean);
  if (fieldValue(fields, 'inline') !== '1') return null;

  const declared = fieldValue(fields, 'size');
  const payload = new TextDecoder().decode(seq.subarray(headerEnd + 1, payloadEnd)).replace(/\s+/g, '');
  const decoded = decodeBase64(payload);
  if (!decoded) return null;

  if (!isWebp(decoded)) {
    if (declared === String(decoded.length)) return null;
    const withSize = fields.filter((field) => !field.startsWith('size='));
    withSize.push(`size=${decoded.length}`);
    return buildImageOsc(withSize, payload);
  }

  return webpToPng(decoded).then((png) => {
    const image = png ?? decoded;
    if (!png && declared === String(decoded.length)) return null;
    const withSize = fields.filter((field) => !field.startsWith('size='));
    withSize.push(`size=${image.length}`);
    return buildImageOsc(withSize, png ? encodeBase64(png) : payload);
  });
}

/**
 * Feeds PTY bytes to the terminal, rewriting inline-image sequences as they
 * cross frame boundaries. `write` returns synchronously when nothing needs
 * decoding so the hot path stays allocation-light.
 */
export class InlineImageStream {
  private carry: Uint8Array = EMPTY;

  write(chunk: Uint8Array): Uint8Array[] | Promise<Uint8Array[]> {
    const buffered = this.carry.length ? concat(this.carry, chunk) : chunk;
    this.carry = EMPTY;

    const first = indexOfBytes(buffered, PREFIX, 0);
    if (first < 0) {
      const keep = Math.min(PREFIX.length - 1, buffered.length);
      this.carry = buffered.slice(buffered.length - keep);
      return keep === buffered.length ? [] : [buffered.subarray(0, buffered.length - keep)];
    }
    return this.drain(buffered, first);
  }

  private drain(buffered: Uint8Array, first: number): Uint8Array[] | Promise<Uint8Array[]> {
    const parts: Uint8Array[] = [];
    let pending: Promise<void> | null = null;
    let pos = 0;
    let search = first;

    const queue = (part: Uint8Array) => {
      if (pending) pending = pending.then(() => void parts.push(part));
      else parts.push(part);
    };

    for (;;) {
      if (search < 0) break;
      if (search > pos) queue(buffered.subarray(pos, search));
      const oscEnd = endOfOsc(buffered, search + PREFIX.length);
      if (oscEnd < 0) {
        this.carry = buffered.slice(search);
        break;
      }
      const sequence = buffered.subarray(search, oscEnd);
      const headerEnd = indexOfBytes(sequence, COLON, PREFIX.length);
      if (headerEnd < 0) {
        queue(sequence);
      } else {
        const rewritten = rewriteImageOsc(sequence, headerEnd, endOfPayload(buffered, oscEnd) - search);
        if (rewritten instanceof Promise) {
          pending = (pending ?? Promise.resolve()).then(async () => {
            parts.push((await rewritten) ?? sequence);
          });
        } else {
          queue(rewritten ?? sequence);
        }
      }
      pos = oscEnd;
      search = indexOfBytes(buffered, PREFIX, pos);
    }
    if (pos < buffered.length && this.carry.length === 0) queue(buffered.subarray(pos));

    return pending ? pending.then(() => parts) : parts;
  }

  reset(): void {
    this.carry = EMPTY;
  }
}
