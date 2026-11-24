import { defineConfig } from 'prisma/config';

// The Prisma CLI does not load .env by itself; Node can (missing file is fine).
try {
  process.loadEnvFile('.env');
} catch {
  // No .env: rely on the real environment (CI, production).
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // Run by `prisma migrate reset` (npm run db:migrate:reset) and `prisma db seed`.
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Only migrate/studio/db commands need it; `prisma generate` doesn't.
    url: process.env.DATABASE_URL ?? '',
  },
});
