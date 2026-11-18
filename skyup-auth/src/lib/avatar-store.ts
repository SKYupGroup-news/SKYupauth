import { createHash } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from './env';
import { prisma } from './db';

/**
 * Where uploaded profile pictures live.
 *
 * Three drivers behind one interface, because the right answer changes with
 * scale and should not require touching call sites:
 *
 *   database  — the bytes sit in Postgres. Correct, zero setup, and wrong past a
 *               few thousand readers: it spends database IO and app memory on
 *               static files.
 *   disk      — a local directory. Fine for one instance; not shared between them.
 *   s3        — any S3-compatible bucket (AWS, R2, Spaces) fronted by a CDN.
 *               This is the one that belongs in front of real traffic.
 *
 * `avatarSrcFor()` is the only place a URL is produced, so switching drivers
 * changes where bytes are read from and nothing else.
 *
 * The disk driver's paths are computed at runtime and marked `turbopackIgnore`:
 * without that the bundler treats them as possible module imports and pulls the
 * entire source tree into the server output.
 */
export type AvatarDriver = 'database' | 'disk' | 's3';

export interface StoredAvatar {
  data: Uint8Array<ArrayBuffer>;
  mimeType: string;
}

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function diskPath(userId: string, mimeType: string): string {
  // Hashed so a user id never becomes a guessable path on disk.
  const name = createHash('sha256').update(userId).digest('hex').slice(0, 32);
  return path.join(/*turbopackIgnore: true*/ env.AVATAR_DISK_PATH, `${name}.${EXT[mimeType] ?? 'bin'}`);
}

/** Object key used by the s3 driver; also what the CDN path maps to. */
export function objectKey(userId: string, mimeType: string): string {
  return `avatars/${userId}.${EXT[mimeType] ?? 'bin'}`;
}

async function s3Request(
  method: 'PUT' | 'GET' | 'DELETE',
  key: string,
  body?: Uint8Array,
  contentType?: string,
): Promise<Response> {
  // Presigned-free path: buckets are expected to be reached over a private
  // endpoint or with credentials supplied by the environment/IAM role.
  const base = env.AVATAR_S3_ENDPOINT!.replace(/\/$/, '');
  const url = `${base}/${key}`;

  return fetch(url, {
    method,
    headers: {
      ...(contentType ? { 'Content-Type': contentType } : {}),
      ...(env.AVATAR_S3_TOKEN ? { Authorization: `Bearer ${env.AVATAR_S3_TOKEN}` } : {}),
    },
    body: body ? Buffer.from(body) : undefined,
  });
}

export async function putAvatar(
  userId: string,
  avatar: StoredAvatar,
): Promise<void> {
  switch (env.AVATAR_DRIVER) {
    case 'disk': {
      await mkdir(/*turbopackIgnore: true*/ env.AVATAR_DISK_PATH, { recursive: true });
      await writeFile(/*turbopackIgnore: true*/ diskPath(userId, avatar.mimeType), avatar.data);
      break;
    }
    case 's3': {
      const response = await s3Request(
        'PUT',
        objectKey(userId, avatar.mimeType),
        avatar.data,
        avatar.mimeType,
      );
      if (!response.ok) {
        throw new Error(`Avatar upload failed (${response.status})`);
      }
      break;
    }
    default: {
      await prisma.userAvatar.upsert({
        where: { userId },
        create: { userId, data: avatar.data, mimeType: avatar.mimeType },
        update: { data: avatar.data, mimeType: avatar.mimeType },
      });
    }
  }

  // The pointer row is written whatever the driver, so the app always knows the
  // content type without having to ask storage.
  if (env.AVATAR_DRIVER !== 'database') {
    await prisma.userAvatar.upsert({
      where: { userId },
      create: { userId, data: new Uint8Array(0), mimeType: avatar.mimeType },
      update: { data: new Uint8Array(0), mimeType: avatar.mimeType },
    });
  }
}

export async function getAvatar(userId: string): Promise<StoredAvatar | null> {
  const row = await prisma.userAvatar.findUnique({ where: { userId } });
  if (!row) return null;

  switch (env.AVATAR_DRIVER) {
    case 'disk': {
      try {
        const file = await readFile(/*turbopackIgnore: true*/ diskPath(userId, row.mimeType));
        const bytes = new Uint8Array(file.length);
        bytes.set(file);
        return { data: bytes, mimeType: row.mimeType };
      } catch {
        return null;
      }
    }
    case 's3': {
      const response = await s3Request('GET', objectKey(userId, row.mimeType));
      if (!response.ok) return null;
      const buffer = new Uint8Array(await response.arrayBuffer());
      const bytes = new Uint8Array(buffer.length);
      bytes.set(buffer);
      return { data: bytes, mimeType: row.mimeType };
    }
    default:
      return { data: row.data as Uint8Array<ArrayBuffer>, mimeType: row.mimeType };
  }
}

export async function deleteAvatar(userId: string): Promise<void> {
  const row = await prisma.userAvatar.findUnique({ where: { userId } });

  if (row) {
    if (env.AVATAR_DRIVER === 'disk') {
      await unlink(/*turbopackIgnore: true*/ diskPath(userId, row.mimeType)).catch(() => {});
    } else if (env.AVATAR_DRIVER === 's3') {
      await s3Request('DELETE', objectKey(userId, row.mimeType)).catch(() => {});
    }
  }

  await prisma.userAvatar.deleteMany({ where: { userId } });
}

/**
 * Public URL for an avatar. With a CDN configured the browser never touches
 * this service for images at all — which is the entire point of moving them.
 */
export function avatarPublicUrl(userId: string, version: Date, mimeType?: string): string {
  if (env.AVATAR_CDN_URL && mimeType) {
    return `${env.AVATAR_CDN_URL.replace(/\/$/, '')}/${objectKey(userId, mimeType)}?v=${version.getTime()}`;
  }
  return `/api/avatar/${userId}?v=${version.getTime()}`;
}
