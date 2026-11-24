import { redactUrl } from './logger.module.js';

describe('redactUrl', () => {
  it('hides OIDC codes, state and link intents', () => {
    expect(
      redactUrl('/auth/customer/oidc/google/callback?code=abc&state=def'),
    ).toBe(
      '/auth/customer/oidc/google/callback?code=%5BREDACTED%5D&state=%5BREDACTED%5D',
    );
    expect(redactUrl('/auth/customer/oidc/google/login?intent=xyz')).toBe(
      '/auth/customer/oidc/google/login?intent=%5BREDACTED%5D',
    );
  });

  it('leaves other URLs alone', () => {
    expect(redactUrl('/me')).toBe('/me');
    expect(redactUrl('/bookings?page=2')).toBe('/bookings?page=2');
  });
});
