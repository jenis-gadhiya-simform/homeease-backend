import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../../config/env.js';
import { type Prisma, PrismaClient } from '../../generated/prisma/client.js';

/**
 * Prisma warnings are emitted as events and logged through pino. Query errors
 * are not: they reach the caller as exceptions, and handled ones (e.g. a
 * unique violation turned into 409) shouldn't be logged as errors.
 */
type PrismaOptions = Prisma.PrismaClientOptions & {
  log: [{ emit: 'event'; level: 'warn' }];
};

/**
 * One pooled Prisma client whose connections run as `role`.
 *
 * Uses the `pg` driver adapter, so queries go through node-postgres: pooled,
 * and traced by NestJS Observe like any other `pg` query.
 */
abstract class RolePrismaClient
  extends PrismaClient<PrismaOptions>
  implements OnModuleInit, OnModuleDestroy
{
  protected abstract readonly logger: Logger;

  constructor(role: string, poolMax: number) {
    super({
      adapter: new PrismaPg({
        connectionString: env.DATABASE_URL,
        max: poolMax,
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 30_000,
        // Every session runs in UTC, so now(), date_trunc() and timestamptz
        // text never depend on the server's zone; and as `role`, so
        // row-level security applies to the app (F01).
        options: `-c TimeZone=UTC -c role=${role}`,
      }),
      log: [{ emit: 'event', level: 'warn' }],
    });

    this.$on('warn', (event) => this.logger.warn(event.message));
  }

  /** Fails startup with a clear message when the database is unreachable. */
  async onModuleInit() {
    try {
      await this.$queryRaw`SELECT 1`;
    } catch (error) {
      const target = new URL(env.DATABASE_URL);
      // Connection failures carry the reason in `code` (e.g. ECONNREFUSED);
      // their message is empty.
      const { code, message } = error as { code?: string; message?: string };
      const reason = code ?? message?.trim() ?? String(error);
      throw new Error(
        `Database unreachable at ${target.host}${target.pathname}: ${reason}`,
        { cause: error },
      );
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

/**
 * The app's Prisma client, connected as `DATABASE_APP_ROLE` (slotwise_app):
 * row-level security applies, so tenant tables are only visible through
 * `TenantPrismaService`. Inject it in repositories only; services and
 * controllers never see Prisma.
 */
@Injectable()
export class PrismaService extends RolePrismaClient {
  protected readonly logger = new Logger(PrismaService.name);

  constructor() {
    super(env.DATABASE_APP_ROLE, env.DATABASE_POOL_MAX);
  }
}

/**
 * Connected as `DATABASE_ADMIN_ROLE` (slotwise_admin, BYPASSRLS): sees every
 * tenant. Only for platform-admin endpoints and background jobs that work
 * across tenants; never inject it into tenant-facing code. Small pool.
 */
@Injectable()
export class AdminPrismaService extends RolePrismaClient {
  protected readonly logger = new Logger(AdminPrismaService.name);

  constructor() {
    super(env.DATABASE_ADMIN_ROLE, Math.min(env.DATABASE_POOL_MAX, 3));
  }
}
