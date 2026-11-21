import { Global, Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { DatabaseHealthIndicator } from './database.health.js';
import { PrismaService } from './prisma.service.js';

/**
 * PostgreSQL through Prisma. Global: inject `PrismaService` in any
 * repository. The pool opens at startup (failing fast if the database is
 * unreachable) and closes on shutdown.
 */
@Global()
@Module({
  imports: [TerminusModule],
  providers: [PrismaService, DatabaseHealthIndicator],
  exports: [PrismaService, DatabaseHealthIndicator],
})
export class DatabaseModule {}
