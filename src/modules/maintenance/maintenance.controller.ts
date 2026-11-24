import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { PlatformAdminOnly } from '../auth/platform-admin.guard.js';
import type { MaintenanceJob } from './maintenance.constants.js';
import { MaintenanceScheduler } from './maintenance.scheduler.js';
import { jobIdSchema, maintenanceJobSchema } from './maintenance.schemas.js';

/** Platform admin: see the housekeeping schedules and run a job now (F15). */
@ApiTags('Admin')
@ApiBearerAuth()
@PlatformAdminOnly()
@Controller('admin/maintenance')
export class MaintenanceController {
  constructor(private readonly scheduler: MaintenanceScheduler) {}

  @Get('schedules')
  @ApiOperation({ summary: 'Scheduled maintenance jobs and their next run' })
  @ApiOkResponse({
    schema: {
      example: [
        {
          job: 'purge-unverified-customers',
          pattern: '0 3 * * *',
          timezone: 'Asia/Kolkata',
          nextRunAt: '2026-11-24T21:30:00.000Z',
        },
      ],
    },
  })
  schedules() {
    return this.scheduler.schedules();
  }

  @Post('jobs/:job/run')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Run a maintenance job now',
    description:
      'Queues a one-off run; poll `GET /admin/maintenance/jobs/:jobId` for its state and result.',
  })
  @ApiAcceptedResponse({
    schema: {
      example: { jobId: 'purge-unverified-customers-manual-1764000000000' },
    },
  })
  run(@Param('job', { schema: maintenanceJobSchema }) job: MaintenanceJob) {
    return this.scheduler.runNow(job);
  }

  @Get('jobs/:jobId')
  @ApiOperation({ summary: 'State and result of a maintenance job' })
  @ApiOkResponse({
    schema: {
      example: {
        jobId: 'purge-unverified-customers-manual-1764000000000',
        job: 'purge-unverified-customers',
        state: 'completed',
        attemptsMade: 1,
        result: {
          cutoff: '2026-11-17T10:00:00.000Z',
          deleted: 12,
          batches: 1,
          truncated: false,
        },
        failedReason: null,
        finishedAt: '2026-11-24T10:00:01.000Z',
      },
    },
  })
  async job(@Param('jobId', { schema: jobIdSchema }) jobId: string) {
    const status = await this.scheduler.status(jobId);
    if (!status) throw new NotFoundException('Job not found');
    return status;
  }
}
