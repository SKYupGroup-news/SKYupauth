import { describe, expect, it } from 'vitest';
import zlib from 'node:zlib';
import { MAX_AVATAR_BYTES, decodeDataUri } from '@/lib/avatar';

function pngBytes(): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(body) : 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.from([0, 0, 0, 0]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const asDataUri = (mime: string, bytes: Buffer) =>
  `data:${mime};base64,${bytes.toString('base64')}`;

describe('avatar upload validation', () => {
  it('accepts a real PNG', () => {
    const result = decodeDataUri(asDataUri('image/png', pngBytes()));
    expect('error' in result).toBe(false);
    if (!('error' in result)) expect(result.mimeType).toBe('image/png');
  });

  it('REJECTS SVG — it can carry script and we serve from our own origin', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const result = decodeDataUri(asDataUri('image/svg+xml', svg));
    expect('error' in result).toBe(true);
  });

  it('SNIFFS the magic number rather than trusting the declared type', () => {
    // A PNG announced as JPEG must be stored and served as what it actually is.
    const result = decodeDataUri(asDataUri('image/jpeg', pngBytes()));
    expect('error' in result).toBe(false);
    if (!('error' in result)) expect(result.mimeType).toBe('image/png');
  });

  it('rejects bytes that are not an image at all', () => {
    const result = decodeDataUri(asDataUri('image/png', Buffer.from('definitely not an image')));
    expect('error' in result).toBe(true);
  });

  it('rejects anything that is not a base64 data URI', () => {
    expect('error' in decodeDataUri('https://example.com/avatar.png')).toBe(true);
    expect('error' in decodeDataUri('')).toBe(true);
  });

  it('rejects an oversized image', () => {
    const huge = Buffer.concat([pngBytes(), Buffer.alloc(MAX_AVATAR_BYTES + 1)]);
    const result = decodeDataUri(asDataUri('image/png', huge));
    expect('error' in result).toBe(true);
  });
});
