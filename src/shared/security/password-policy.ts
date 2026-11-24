import { z } from 'zod';

/** F02 password policy: at least 10 characters, not a commonly breached password. */
export const PASSWORD_MIN_LENGTH = 10;
/** `PasswordHasher.hash()` refuses longer input. */
export const PASSWORD_MAX_LENGTH = 1024;

/**
 * A small list of breached passwords that pass the length rule. Compared
 * case-insensitively. Not a substitute for a full breach corpus; it stops the
 * passwords people actually try first.
 */
const BREACHED_PASSWORDS = new Set([
  '1234567890',
  '0123456789',
  '0987654321',
  '1q2w3e4r5t',
  '1qaz2wsx3edc',
  'qwertyuiop',
  'asdfghjkl;',
  'zaq12wsxcde3',
  'password12',
  'password123',
  'password1234',
  'passw0rd123',
  'iloveyou12',
  'qwerty1234',
  'qwerty12345',
  'qwerty123456',
  'abcdefghij',
  'abc1234567',
  'letmein123',
  'welcome123',
  'welcome@123',
  'admin12345',
  'admin@1234',
  'administrator',
  'changeme123',
  'football123',
  'sunshine123',
  'princess123',
  'trustno1234',
  'superman123',
  'baseball123',
  'monkey12345',
  'dragon12345',
  'master12345',
  'india@1234',
  'india12345',
]);

export const passwordSchema = z
  .string()
  .min(
    PASSWORD_MIN_LENGTH,
    `Must be at least ${PASSWORD_MIN_LENGTH} characters`,
  )
  .max(PASSWORD_MAX_LENGTH, `Must be at most ${PASSWORD_MAX_LENGTH} characters`)
  .refine(
    (value) => !BREACHED_PASSWORDS.has(value.toLowerCase()),
    'Too common: this password appears in breach lists',
  );
