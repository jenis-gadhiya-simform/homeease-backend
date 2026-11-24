/** Lifetimes of emailed links (F02). */
export const SETUP_TOKEN_TTL_MS = 72 * 60 * 60 * 1000;
export const STAFF_RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
export const CUSTOMER_RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

/**
 * A customer without a password may set one within this long after a
 * magic-link sign-in ("a fresh magic-link session").
 */
export const FRESH_SIGN_IN_MS = 15 * 60 * 1000;

/** The refresh token travels only in this httpOnly cookie, scoped to /auth. */
export const REFRESH_COOKIE = 'sw_refresh';
export const REFRESH_COOKIE_PATH = '/auth';

/** Paths in the web app (APP_URL) that emailed links open. */
export const LINK_PATHS = {
  login: '/login',
  accountSetup: '/account-setup',
  staffPasswordReset: '/reset-password',
  magicLink: '/magic-link',
  customerPasswordReset: '/customer/reset-password',
  /** Where social sign-in lands (`?redirectTo=` on success, `?error=` otherwise). */
  socialCallback: '/auth/social/callback',
  /** The customer's sign-in methods page, where linking lands. */
  signInMethods: '/account/sign-in-methods',
} as const;

/** A social login, between the redirect to the provider and the callback. */
export const SOCIAL_LOGIN_TTL_MS = 10 * 60 * 1000;
/** A link intent (POST /me/identities/:provider/link) is single use, this long. */
export const LINK_INTENT_TTL_MS = 5 * 60 * 1000;
