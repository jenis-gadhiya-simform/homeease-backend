import {
  google,
  microsoft,
  type OidcProviderConfig,
} from '@nestjs/authentication';
import { IdentityProvider } from '../../../generated/prisma/client.js';
import { type Env, env } from '../../../config/env.js';

/** Social sign-in providers, as they appear in routes and API responses (F02 v2). */
export const SocialProvider = {
  GOOGLE: 'google',
  MICROSOFT: 'microsoft',
} as const;
export type SocialProvider =
  (typeof SocialProvider)[keyof typeof SocialProvider];

export const SOCIAL_PROVIDERS = Object.values(SocialProvider);

const IDENTITY_PROVIDER = {
  [SocialProvider.GOOGLE]: IdentityProvider.GOOGLE,
  [SocialProvider.MICROSOFT]: IdentityProvider.MICROSOFT,
} as const satisfies Record<SocialProvider, IdentityProvider>;

const SOCIAL_PROVIDER = {
  [IdentityProvider.GOOGLE]: SocialProvider.GOOGLE,
  [IdentityProvider.MICROSOFT]: SocialProvider.MICROSOFT,
} as const satisfies Record<IdentityProvider, SocialProvider>;

export const toIdentityProvider = (provider: SocialProvider) =>
  IDENTITY_PROVIDER[provider];
export const toSocialProvider = (provider: IdentityProvider) =>
  SOCIAL_PROVIDER[provider];

export function isSocialProvider(value: unknown): value is SocialProvider {
  return (SOCIAL_PROVIDERS as readonly unknown[]).includes(value);
}

/**
 * Hints for the provider's login page, not checks (the browser carries them).
 * `select_account`: a shared computer never silently reuses the last account.
 */
const AUTHORIZATION_PARAMS = { prompt: 'select_account' };

/**
 * The `@nestjs/authentication` OIDC client config of every enabled provider:
 * one whose settings are all set (Google: id + secret; Microsoft: id +
 * secret + tenant). The env schema refuses a partly set provider.
 */
export function socialProviderConfigs(
  source: Env = env,
): Partial<Record<SocialProvider, OidcProviderConfig>> {
  const configs: Partial<Record<SocialProvider, OidcProviderConfig>> = {};
  if (source.GOOGLE_CLIENT_ID && source.GOOGLE_CLIENT_SECRET) {
    configs[SocialProvider.GOOGLE] = {
      ...google({
        clientId: source.GOOGLE_CLIENT_ID,
        clientSecret: source.GOOGLE_CLIENT_SECRET,
      }),
      authorizationParams: AUTHORIZATION_PARAMS,
    };
  }
  if (
    source.MICROSOFT_CLIENT_ID &&
    source.MICROSOFT_CLIENT_SECRET &&
    source.MICROSOFT_TENANT_ID
  ) {
    configs[SocialProvider.MICROSOFT] = {
      // Single tenant only (the package can't validate the templated issuer
      // of `common` / `consumers`): personal accounts have a tenant of their own.
      ...microsoft({
        tenant: source.MICROSOFT_TENANT_ID,
        clientId: source.MICROSOFT_CLIENT_ID,
        clientSecret: source.MICROSOFT_CLIENT_SECRET,
      }),
      authorizationParams: AUTHORIZATION_PARAMS,
    };
  }
  return configs;
}

/** Enabled providers, in a stable order. */
export function enabledSocialProviders(source: Env = env): SocialProvider[] {
  const configs = socialProviderConfigs(source);
  return SOCIAL_PROVIDERS.filter((provider) => provider in configs);
}

/** The redirect URI to register with each provider (`:provider` is filled in). */
export function socialCallbackUrl(source: Env = env): string {
  return new URL('/auth/customer/oidc/:provider/callback', source.API_URL)
    .toString()
    .replace('%3Aprovider', ':provider');
}
