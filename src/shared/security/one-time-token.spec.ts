import { generateOneTimeToken, hashOneTimeToken } from './one-time-token.js';

describe('one-time tokens', () => {
  it('generates a 256-bit base64url token and its SHA-256', () => {
    const { token, tokenHash } = generateOneTimeToken();
    expect(token).toMatch(/^[\w-]{43}$/);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashOneTimeToken(token)).toBe(tokenHash);
  });

  it('never repeats', () => {
    const tokens = new Set(
      Array.from({ length: 100 }, () => generateOneTimeToken().token),
    );
    expect(tokens.size).toBe(100);
  });
});
