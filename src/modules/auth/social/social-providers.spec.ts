import { parseEnv } from '../../../config/env.js';
import {
  enabledSocialProviders,
  SocialProvider,
  socialCallbackUrl,
  socialProviderConfigs,
} from './social-providers.js';

describe('social providers', () => {
  it('enables nothing without credentials', () => {
    expect(enabledSocialProviders(parseEnv({}))).toEqual([]);
  });

  it('enables each provider whose settings are all set', () => {
    const env = parseEnv({
      GOOGLE_CLIENT_ID: 'g-id',
      GOOGLE_CLIENT_SECRET: 'g-secret',
      MICROSOFT_CLIENT_ID: 'm-id',
      MICROSOFT_CLIENT_SECRET: 'm-secret',
      MICROSOFT_TENANT_ID: '9188040d-6c67-4c5b-b112-36a304b66dad',
    });
    expect(enabledSocialProviders(env)).toEqual([
      SocialProvider.GOOGLE,
      SocialProvider.MICROSOFT,
    ]);
    const configs = socialProviderConfigs(env);
    expect(configs[SocialProvider.GOOGLE]).toMatchObject({
      issuer: 'https://accounts.google.com',
      clientId: 'g-id',
      authorizationParams: { prompt: 'select_account' },
    });
    expect(configs[SocialProvider.MICROSOFT]).toMatchObject({
      issuer:
        'https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0',
      clientId: 'm-id',
    });
  });

  it('uses the configured Microsoft tenant in the issuer', () => {
    const configs = socialProviderConfigs(
      parseEnv({
        MICROSOFT_CLIENT_ID: 'm-id',
        MICROSOFT_CLIENT_SECRET: 'm-secret',
        MICROSOFT_TENANT_ID: 'AAAAAAAA-1111-4222-8333-444444444444',
      }),
    );
    expect(configs[SocialProvider.MICROSOFT]?.issuer).toBe(
      'https://login.microsoftonline.com/aaaaaaaa-1111-4222-8333-444444444444/v2.0',
    );
  });

  it('builds the callback URL from API_URL, keeping the :provider placeholder', () => {
    expect(
      socialCallbackUrl(parseEnv({ API_URL: 'https://api.slotwise.example' })),
    ).toBe(
      'https://api.slotwise.example/auth/customer/oidc/:provider/callback',
    );
  });
});
