import { isFreshPasswordlessSignIn } from './customer-auth.service.js';

describe('isFreshPasswordlessSignIn', () => {
  const now = Date.UTC(2026, 10, 22, 12, 0, 0);
  const secondsAgo = (s: number) => Math.floor(now / 1000) - s;

  it('accepts a magic-link sign-in up to 15 minutes old', () => {
    expect(
      isFreshPasswordlessSignIn(
        { amr: ['email'], auth_time: secondsAgo(60) },
        now,
      ),
    ).toBe(true);
    expect(
      isFreshPasswordlessSignIn(
        { amr: ['email'], auth_time: secondsAgo(900) },
        now,
      ),
    ).toBe(true);
  });

  it('accepts a Google / Microsoft sign-in up to 15 minutes old', () => {
    expect(
      isFreshPasswordlessSignIn(
        { amr: ['oidc'], auth_time: secondsAgo(60) },
        now,
      ),
    ).toBe(true);
    expect(
      isFreshPasswordlessSignIn(
        { amr: ['oidc'], auth_time: secondsAgo(901) },
        now,
      ),
    ).toBe(false);
  });

  it('rejects an older magic-link sign-in', () => {
    expect(
      isFreshPasswordlessSignIn(
        { amr: ['email'], auth_time: secondsAgo(901) },
        now,
      ),
    ).toBe(false);
  });

  it('rejects password sign-ins and tokens without the claims', () => {
    expect(
      isFreshPasswordlessSignIn(
        { amr: ['pwd'], auth_time: secondsAgo(1) },
        now,
      ),
    ).toBe(false);
    expect(isFreshPasswordlessSignIn({ amr: ['email'] }, now)).toBe(false);
    expect(
      isFreshPasswordlessSignIn(
        { amr: 'email', auth_time: secondsAgo(1) },
        now,
      ),
    ).toBe(false);
    expect(isFreshPasswordlessSignIn(null, now)).toBe(false);
  });
});
