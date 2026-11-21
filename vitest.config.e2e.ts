import { defineConfig } from 'vitest/config';

// E2E tests run against real services from `docker compose up -d`, using a
// separate Postgres database and a separate Redis logical database, so they
// never touch dev data. Both are emptied after the run.
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5433/homeease-test';
const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    env: { DATABASE_URL: TEST_DATABASE_URL, REDIS_URL: TEST_REDIS_URL },
    // Create + migrate the test database, prepare Redis db 1; both return a
    // teardown that empties them after all tests.
    globalSetup: [
      './test/setup/database.global-setup.ts',
      './test/setup/redis.global-setup.ts',
    ],
  },
});
