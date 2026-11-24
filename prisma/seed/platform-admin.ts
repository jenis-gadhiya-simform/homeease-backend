import type { PasswordHasher } from '@nestjs/authentication';
import { z } from 'zod';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { passwordSchema } from '../../src/shared/security/password-policy.js';

export interface PlatformAdminInput {
  email: string | undefined;
  password: string | undefined;
  name: string;
}

export interface SeedOptions {
  /** Re-hash the password of an existing admin (`--reset-password`). */
  resetPassword: boolean;
}

export type SeedOutcome = 'created' | 'updated' | 'password-reset';

const inputSchema = z.object({
  email: z
    .email('PLATFORM_ADMIN_EMAIL must be an email address')
    .transform((email) => email.trim().toLowerCase()),
  password: passwordSchema,
  name: z.string().trim().min(1),
});

/** Validates the env input; throws one message naming what's missing or wrong. */
export function parsePlatformAdminInput(input: PlatformAdminInput) {
  const missing = [
    !input.email && 'PLATFORM_ADMIN_EMAIL',
    !input.password && 'PLATFORM_ADMIN_PASSWORD',
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(
      `Cannot seed the platform admin: set ${missing.join(' and ')} (see .env.example).`,
    );
  }
  const result = inputSchema.safeParse(input);
  if (!result.success) {
    // Messages name the field, never echo the password.
    const problems = result.error.issues.map(
      (issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`,
    );
    throw new Error(
      `Cannot seed the platform admin:\n  ${problems.join('\n  ')}`,
    );
  }
  return result.data;
}

/**
 * Upserts the one platform admin by lowercased email. Safe to re-run: it
 * never duplicates the user, and keeps the existing password unless
 * `resetPassword` is set (or the user has none yet).
 */
export async function seedPlatformAdmin(
  prisma: PrismaClient,
  hasher: PasswordHasher,
  input: PlatformAdminInput,
  options: SeedOptions,
): Promise<SeedOutcome> {
  const { email, password, name } = parsePlatformAdminInput(input);

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true },
  });

  if (!existing) {
    await prisma.user.create({
      data: {
        email,
        name,
        passwordHash: await hasher.hash(password),
        isPlatformAdmin: true,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });
    return 'created';
  }

  const setPassword = options.resetPassword || existing.passwordHash === null;
  await prisma.user.update({
    where: { id: existing.id },
    data: {
      name,
      isPlatformAdmin: true,
      // A disabled admin stays disabled unless the password is (re)set on purpose.
      ...(setPassword && {
        passwordHash: await hasher.hash(password),
        status: 'ACTIVE',
      }),
    },
  });
  return setPassword ? 'password-reset' : 'updated';
}
