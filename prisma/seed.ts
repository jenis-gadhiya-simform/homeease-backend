/**
 * `npm run db:seed` (also run by `npm run db:migrate:reset`).
 *
 * Seeds exactly one user: the platform admin, from PLATFORM_ADMIN_EMAIL,
 * PLATFORM_ADMIN_PASSWORD and PLATFORM_ADMIN_NAME. Nothing else: tenants,
 * staff, services and customers are created through the API. Test and perf
 * data never come from here.
 *
 *   npm run db:seed                        create the admin, or update its name
 *   npm run db:seed -- --reset-password    also re-hash the password from env
 */
import { parseArgs } from 'node:util';

// Like prisma.config.ts: load .env when present, otherwise use the real
// environment (CI, production deploy step). Must run before `env` is imported.
try {
  process.loadEnvFile('.env');
} catch {
  // No .env file.
}

const { values } = parseArgs({
  options: { 'reset-password': { type: 'boolean', default: false } },
});

const { PasswordHasher } = await import('@nestjs/authentication');
const { env } = await import('../src/config/env.js');
const { PrismaService } =
  await import('../src/shared/database/prisma.service.js');
const { seedPlatformAdmin } = await import('./seed/platform-admin.js');

const prisma = new PrismaService();
try {
  const outcome = await seedPlatformAdmin(
    prisma,
    new PasswordHasher(),
    {
      email: env.PLATFORM_ADMIN_EMAIL,
      password: env.PLATFORM_ADMIN_PASSWORD,
      name: env.PLATFORM_ADMIN_NAME,
    },
    { resetPassword: values['reset-password'] },
  );
  const messages = {
    created: 'Platform admin created',
    updated: 'Platform admin already exists; password unchanged',
    'password-reset': 'Platform admin password set',
  };
  console.log(`${messages[outcome]}: ${env.PLATFORM_ADMIN_EMAIL}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
