import { z } from 'zod';

/**
 * Time rules (see docs/architecture.md, "Time and money"):
 * - Every instant is stored, computed and exchanged in UTC. The API accepts
 *   and returns ISO 8601 strings with a `Z` suffix only; offsets are refused.
 * - `DISPLAY_TIMEZONE` is used **only** for emails, reports and job
 *   schedules. Never in the API, the database or env.
 */
export const DISPLAY_TIMEZONE = 'Asia/Kolkata';

/**
 * Zod schema for an API instant: ISO 8601 in UTC (`2026-11-24T10:00:00Z`,
 * optional milliseconds). Parses to a `Date`.
 */
export const utcInstantSchema = z.iso
  .datetime({ offset: false, local: false })
  .transform((value) => new Date(value));

/** Parses an ISO 8601 UTC string (`…Z`) to a `Date`; throws on anything else. */
export function parseUtc(value: string): Date {
  const result = utcInstantSchema.safeParse(value);
  if (!result.success) {
    throw new RangeError(
      `Expected an ISO 8601 UTC timestamp ending in "Z", got "${value}"`,
    );
  }
  return result.data;
}

/** `true` when `value` is an ISO 8601 UTC string the API would accept. */
export function isUtcIso(value: string): boolean {
  return utcInstantSchema.safeParse(value).success;
}

/** Serializes an instant for the API: always UTC with milliseconds and `Z`. */
export function toUtcIso(instant: Date): string {
  return instant.toISOString();
}

/** A half-open time range: `start` included, `end` excluded. */
export interface TimeRange {
  start: Date;
  end: Date;
}

/**
 * Whether two half-open ranges `[start, end)` share any instant. Touching
 * ranges (one ends when the next starts) don't overlap, the same as
 * Postgres `tstzrange '[)'` with `&&`.
 */
export function rangesOverlap(a: TimeRange, b: TimeRange): boolean {
  assertValidRange(a);
  assertValidRange(b);
  return (
    a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime()
  );
}

function assertValidRange({ start, end }: TimeRange): void {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new RangeError('Invalid date in time range');
  }
  if (start.getTime() >= end.getTime()) {
    throw new RangeError('Time range must end after it starts');
  }
}

const emailFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: DISPLAY_TIMEZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZoneName: 'short',
});

/**
 * Formats an instant in `DISPLAY_TIMEZONE` for people to read:
 * `Tue, 24 Nov 2026, 3:30 pm IST`. For emails, reports and job logs only.
 * Built from parts so the punctuation doesn't change with the ICU version.
 */
export function formatForEmail(instant: Date): string {
  const part = Object.fromEntries(
    emailFormatter
      .formatToParts(instant)
      .map(({ type, value }) => [type, value]),
  ) as Record<Intl.DateTimeFormatPartTypes, string>;
  const dayPeriod = part.dayPeriod.toLowerCase();
  return `${part.weekday}, ${part.day} ${part.month} ${part.year}, ${part.hour}:${part.minute} ${dayPeriod} ${part.timeZoneName}`;
}
