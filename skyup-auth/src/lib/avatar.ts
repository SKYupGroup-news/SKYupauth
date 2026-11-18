/** Formats browsers reliably render, and that cannot carry script. */
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/** ~512KB of decoded bytes — generous for a compressed profile picture. */
export const MAX_AVATAR_BYTES = 512 * 1024;

export interface DecodedImage {
  // Prisma's Bytes maps to Uint8Array, not Node's Buffer. The ArrayBuffer type
  // argument is required: a bare Uint8Array widens to ArrayBufferLike, which
  // Prisma's input type rejects.
  data: Uint8Array<ArrayBuffer>;
  mimeType: string;
}

/**
 * Parses a `data:image/...;base64,...` URI into bytes.
 *
 * SVG is deliberately not allowed: it can embed scripts, and this image is
 * served from our own origin where that would be a stored-XSS vector.
 */
export function decodeDataUri(value: string): DecodedImage | { error: string } {
  const match = /^data:([a-z0-9.+/-]+);base64,(.+)$/i.exec(value.trim());
  if (!match) {
    return { error: 'Expected a base64 image data URI.' };
  }

  const mimeType = match[1]!.toLowerCase();
  if (!ALLOWED.has(mimeType)) {
    return {
      error: `Unsupported image type "${mimeType}". Use PNG, JPEG, WebP or GIF.`,
    };
  }

  let data: Buffer;
  try {
    data = Buffer.from(match[2]!, 'base64');
  } catch {
    return { error: 'That image could not be decoded.' };
  }

  if (data.length === 0) return { error: 'That image is empty.' };
  if (data.length > MAX_AVATAR_BYTES) {
    return {
      error: `That image is ${(data.length / 1024).toFixed(0)}KB. The limit is ${
        MAX_AVATAR_BYTES / 1024
      }KB.`,
    };
  }

  // Trust the bytes, not the declared type: check the magic number.
  const sniffed = sniff(data);
  if (!sniffed) return { error: 'That file is not a valid image.' };

  // Allocate a fresh view so the type is Uint8Array<ArrayBuffer>, which is what
  // Prisma's Bytes expects — wrapping a Buffer keeps its ArrayBufferLike type.
  const bytes = new Uint8Array(data.length);
  bytes.set(data);

  return { data: bytes, mimeType: sniffed };
}

function sniff(data: Buffer): string | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg';
  }
  if (data.length >= 12 && data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  if (data.length >= 6 && data.subarray(0, 6).toString('ascii').startsWith('GIF8')) {
    return 'image/gif';
  }
  return null;
}
