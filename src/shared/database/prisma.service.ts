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
 * The app's single Prisma client (one connection pool per process).
 *
 * Uses the `pg` driver adapter, so queries go through node-postgres: pooled,
 * and traced by NestJS Observe like any other `pg` query.
 * Inject it in repositories only; services and controllers never see Prisma.
 */
@Injectable()
export class PrismaService
  extends PrismaClient<PrismaOptions>
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      adapter: new PrismaPg({
        connectionString: env.DATABASE_URL,
        max: env.DATABASE_POOL_MAX,
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 30_000,
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
