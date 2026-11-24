import { isFreshEmailSignIn } from './customer-auth.service.js';

describe('isFreshEmailSignIn', () => {
  const now = Date.UTC(2026, 10, 22, 12, 0, 0);
  const secondsAgo = (s: number) => Math.floor(now / 1000) - s;

  it('accepts a magic-link sign-in up to 15 minutes old', () => {
    expect(
      isFreshEmailSignIn({ amr: ['email'], auth_time: secondsAgo(60) }, now),
    ).toBe(true);
    expect(
      isFreshEmailSignIn({ amr: ['email'], auth_time: secondsAgo(900) }, now),
    ).toBe(true);
  });

  it('rejects an older magic-link sign-in', () => {
    expect(
      isFreshEmailSignIn({ amr: ['email'], auth_time: secondsAgo(901) }, now),
    ).toBe(false);
  });

  it('rejects password sign-ins and tokens without the claims', () => {
    expect(
      isFreshEmailSignIn({ amr: ['pwd'], auth_time: secondsAgo(1) }, now),
    ).toBe(false);
    expect(isFreshEmailSignIn({ amr: ['email'] }, now)).toBe(false);
    expect(
      isFreshEmailSignIn({ amr: 'email', auth_time: secondsAgo(1) }, now),
    ).toBe(false);
    expect(isFreshEmailSignIn(null, now)).toBe(false);
  });
});
