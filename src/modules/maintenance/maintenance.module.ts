import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { MAINTENANCE_QUEUE } from './maintenance.constants.js';
import { MaintenanceController } from './maintenance.controller.js';
import { MaintenanceProcessor } from './maintenance.processor.js';
import { MaintenanceScheduler } from './maintenance.scheduler.js';

/**
 * Scheduled housekeeping (F15): the "maintenance" queue, its schedules
 * (BullMQ job schedulers, registered at startup), its worker, and admin
 * routes to inspect and trigger runs. The work itself lives in the module
 * that owns the data (e.g. `UnverifiedAccountsCleanupService` in AuthModule).
 */
@Module({
  imports: [BullModule.registerQueue({ name: MAINTENANCE_QUEUE }), AuthModule],
  controllers: [MaintenanceController],
  providers: [MaintenanceScheduler, MaintenanceProcessor],
})
export class MaintenanceModule {}
