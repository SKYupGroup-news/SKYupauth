import { hash, verify } from '@node-rs/argon2';

// OWASP-recommended argon2id baseline: 19 MiB memory, 2 passes, 1 lane.
const OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(digest: string, password: string): Promise<boolean> {
  try {
    return await verify(digest, password, OPTIONS);
  } catch {
    // A malformed or truncated digest must read as "wrong password", not a 500.
    return false;
  }
}

/**
 * Burns roughly the same CPU as a real verification. Called when an account
 * does not exist so that response timing does not reveal which emails are
 * registered.
 */
export async function fakeVerify(): Promise<void> {
  await hash('timing-equalizer', OPTIONS);
}
