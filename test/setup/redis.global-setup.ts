import { createClient } from 'redis';
import type { TestProject } from 'vitest/node';

/**
 * E2E tests use their own Redis logical database (see vitest.config.e2e.ts),
 * so they never touch dev data in database 0. It is emptied before the run
 * (leftovers from an interrupted run) and after it (passed or failed).
 */
export default async function setup(project: TestProject) {
  const url = project.config.env.REDIS_URL;
  const db = url ? Number(new URL(url).pathname.slice(1) || 0) : 0;
  if (!url || !(db > 0)) {
    throw new Error(
      `Refusing to use "${url}": e2e tests must use a Redis database other than 0 (e.g. redis://localhost:6379/1)`,
    );
  }

  await flushDatabase(url);
  return () => flushDatabase(url);
}

/** Deletes every key in this logical database only (FLUSHDB, not FLUSHALL). */
async function flushDatabase(url: string) {
  const client = createClient({ url });
  await client.connect();
  try {
    await client.flushDb();
  } finally {
    await client.close();
  }
}
