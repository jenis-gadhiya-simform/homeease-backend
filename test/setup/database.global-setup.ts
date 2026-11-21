import { execFileSync } from 'node:child_process';
import pg from 'pg';
import type { TestProject } from 'vitest/node';

/**
 * Prepares the e2e test database before any test file runs (creates it if it
 * doesn't exist, then applies all migrations), and empties it after the run.
 */
export default async function setup(project: TestProject) {
  // `test.env` from vitest.config.e2e.ts (it only reaches test workers).
  const url = project.config.env.DATABASE_URL;
  if (!url || !new URL(url).pathname.includes('test')) {
    throw new Error(
      `Refusing to use "${url}": e2e tests must use a database whose name contains "test"`,
    );
  }

  await createDatabaseIfMissing(url);

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });

  // Teardown: runs once after all e2e tests, whether they passed or failed.
  return () => truncateAllTables(url);
}

/**
 * Deletes every row from every table in the public schema, keeping the
 * schema and Prisma's migration history, so the next run starts empty.
 */
async function truncateAllTables(url: string) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
       WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
    );
    if (rows.length > 0) {
      const tables = rows
        .map(({ tablename }) => `public.${client.escapeIdentifier(tablename)}`)
        .join(', ');
      await client.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
    }
  } finally {
    await client.end();
  }
}

async function createDatabaseIfMissing(url: string) {
  const target = new URL(url);
  const name = decodeURIComponent(target.pathname.slice(1));

  // Connect to the server's default `postgres` database to manage databases.
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });

  await client.connect();
  try {
    const { rowCount } = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [name],
    );
    if (!rowCount) {
      // Identifiers can't be query parameters; quote it (names may contain "-").
      await client.query(`CREATE DATABASE ${client.escapeIdentifier(name)}`);
    }
  } finally {
    await client.end();
  }
}
