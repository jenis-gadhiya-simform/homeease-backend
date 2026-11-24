import { Global, Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { DatabaseHealthIndicator } from './database.health.js';
import { AdminPrismaService, PrismaService } from './prisma.service.js';
import { TenantPrismaService } from './tenant-prisma.service.js';

/**
 * PostgreSQL through Prisma. Global: inject `PrismaService` (app role, RLS
 * applies), `TenantPrismaService` (tenant-scoped transactions) or, in
 * platform-admin and job code only, `AdminPrismaService` (bypasses RLS).
 * Pools open at startup (failing fast if the database is unreachable) and
 * close on shutdown.
 */
@Global()
@Module({
  imports: [TerminusModule],
  providers: [
    PrismaService,
    AdminPrismaService,
    TenantPrismaService,
    DatabaseHealthIndicator,
  ],
  exports: [
    PrismaService,
    AdminPrismaService,
    TenantPrismaService,
    DatabaseHealthIndicator,
  ],
})
export class DatabaseModule {}
