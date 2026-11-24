import { z } from 'zod';
import { MaintenanceJob } from './maintenance.constants.js';

export const maintenanceJobSchema = z.enum(MaintenanceJob);

/** A BullMQ job id as this module creates them (no `:`), or a scheduler's numeric/`repeat` id. */
export const jobIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[\w:.-]+$/, 'Malformed job id');
