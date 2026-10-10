import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { argon2id, argon2Verify } from 'hash-wasm';

/**
 * Passwords are stored as Argon2id (64 MiB, 3 passes, 4 lanes: the same cost the platform service uses, so either side can check the other's).
 * Hashes written before this change are bcrypt and still verify; they are replaced at the person's next login.
 */
export const hashPassword = (plain: string) =>
  argon2id({ password: plain, salt: randomBytes(16), parallelism: 4, iterations: 3, memorySize: 65536, hashLength: 32, outputType: 'encoded' });

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  try {
    if (stored.startsWith('$argon2')) return await argon2Verify({ password: plain, hash: stored });
    if (stored.startsWith('$2')) return await bcrypt.compare(plain, stored);
  } catch { /* a damaged hash is simply a wrong password */ }
  return false;
}
export const needsUpgrade = (stored: string) => !stored.startsWith('$argon2id$');
