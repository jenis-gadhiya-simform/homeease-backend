import { z } from 'zod';

/**
 * Money rules (see docs/architecture.md, "Time and money"):
 * - Amounts are integer **paise** everywhere: API, database (`Int`) and code.
 *   ₹499.00 is `49900`. Never floats, never rupees.
 * - The currency is always INR, so it is not stored or sent.
 * - `formatInr()` is for server-rendered text only (emails, reports).
 */
export type Paise = number;

/** Zod schema for an amount in paise: a non-negative safe integer. */
export const paiseSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

function assertPaise(paise: number): void {
  if (!Number.isSafeInteger(paise)) {
    throw new RangeError(
      `Amount must be an integer number of paise, got ${paise}`,
    );
  }
}

const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** `123456` → `₹1,234.56` (Indian digit grouping: `₹1,00,000.00`). */
export function formatInr(paise: Paise): string {
  assertPaise(paise);
  return inrFormatter.format(paise / 100);
}
