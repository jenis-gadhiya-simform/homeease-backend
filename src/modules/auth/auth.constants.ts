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
} as const;
