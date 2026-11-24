import { z } from 'zod';
import { passwordSchema } from '../../shared/security/password-policy.js';
import { AccountKind } from '../../shared/context/request-context.js';

/** Emails are compared and stored lowercased. */
export const emailSchema = z
  .email()
  .max(254)
  .transform((email) => email.trim().toLowerCase());

/**
 * Sign-in checks the password against the stored hash only: policy rules are
 * enforced when a password is set, so older passwords keep working.
 */
const anyPasswordSchema = z.string().min(1).max(1024);

/** An emailed token (base64url, 32 bytes). */
const tokenSchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[\w-]+$/, 'Malformed token');

export const loginSchema = z.object({
  email: emailSchema,
  password: anyPasswordSchema,
});
export type LoginDto = z.infer<typeof loginSchema>;

export const accountSetupTokenParamSchema = tokenSchema;

export const completeAccountSetupSchema = z.object({
  token: tokenSchema,
  password: passwordSchema,
});
export type CompleteAccountSetupDto = z.infer<
  typeof completeAccountSetupSchema
>;

export const magicLinkRequestSchema = z.object({
  email: emailSchema,
  /** The business whose booking page the customer is on (validated in F01). */
  tenantSlug: z
    .string()
    .regex(/^[a-z0-9-]{3,40}$/)
    .optional(),
});
export type MagicLinkRequestDto = z.infer<typeof magicLinkRequestSchema>;

export const magicLinkVerifySchema = z.object({ token: tokenSchema });
export type MagicLinkVerifyDto = z.infer<typeof magicLinkVerifySchema>;

export const accountTypeSchema = z.enum(AccountKind);

export const forgotPasswordSchema = z.object({
  email: emailSchema,
  accountType: accountTypeSchema,
});
export type ForgotPasswordDto = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: tokenSchema,
  accountType: accountTypeSchema,
  password: passwordSchema,
});
export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>;

export const changeCustomerPasswordSchema = z.object({
  /** Required when the account already has a password. */
  currentPassword: anyPasswordSchema.optional(),
  newPassword: passwordSchema,
});
export type ChangeCustomerPasswordDto = z.infer<
  typeof changeCustomerPasswordSchema
>;
