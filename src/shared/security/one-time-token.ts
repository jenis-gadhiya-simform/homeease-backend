import { createHash, randomBytes } from 'node:crypto';

/** A random single-use token and the SHA-256 that is stored in its place. */
export interface OneTimeToken {
  /** 32 random bytes, base64url: goes only into the emailed link. */
  token: string;
  /** Hex SHA-256 of `token`: the only form the database keeps. */
  tokenHash: string;
}

/** Account-setup, password-reset and magic-link tokens (F02). */
export function generateOneTimeToken(): OneTimeToken {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashOneTimeToken(token) };
}

/**
 * The stored form of a token. A plain SHA-256 is enough: the token has 256
 * bits of entropy, so there is nothing to brute-force, and the lookup by
 * hash is an indexed equality (no timing to compare).
 */
export function hashOneTimeToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
