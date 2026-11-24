import { env } from '../../config/env.js';
import { LINK_PATHS } from './auth.constants.js';

/** A link into the web app (APP_URL) carrying a one-time token. */
export function appLink(
  path: (typeof LINK_PATHS)[keyof typeof LINK_PATHS],
  params: Record<string, string | undefined>,
): string {
  const url = new URL(path, env.APP_URL);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return url.toString();
}
