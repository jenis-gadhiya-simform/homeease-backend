import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service.js';

/**
 * Audit log (F09, table + `AuditService` only; the API comes later).
 * Global: any feature records its changes with `AuditService.record(tx, …)`.
 */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
