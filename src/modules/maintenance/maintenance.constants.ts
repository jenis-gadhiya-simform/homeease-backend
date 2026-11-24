/** The queue for housekeeping jobs that run on a schedule (F15). */
export const MAINTENANCE_QUEUE = 'maintenance';

/**
 * Job names on the maintenance queue. Each scheduled one has a job
 * scheduler with the same id (`MAINTENANCE_SCHEDULES`).
 */
export const MaintenanceJob = {
  /** Delete customer accounts nobody verified or used (F02 shells). */
  PURGE_UNVERIFIED_CUSTOMERS: 'purge-unverified-customers',
} as const;
export type MaintenanceJob =
  (typeof MaintenanceJob)[keyof typeof MaintenanceJob];

export const MAINTENANCE_JOBS = Object.values(MaintenanceJob);

/**
 * When each job runs: a cron pattern read in `DISPLAY_TIMEZONE` (IST), as
 * every daily job is (docs/features/F15). 03:00 IST = 21:30Z the day before.
 */
export const MAINTENANCE_SCHEDULES: Record<MaintenanceJob, string> = {
  [MaintenanceJob.PURGE_UNVERIFIED_CUSTOMERS]: '0 3 * * *',
};
