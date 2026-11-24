import { formatInr, paiseSchema } from './money.js';

describe('formatInr', () => {
  it.each([
    [0, '₹0.00'],
    [5, '₹0.05'],
    [49_900, '₹499.00'],
    [123_456, '₹1,234.56'],
    [10_000_000, '₹1,00,000.00'], // Indian grouping
  ])('%i paise → %s', (paise, expected) => {
    expect(formatInr(paise)).toBe(expected);
  });

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses %s (not integer paise)',
    (value) => {
      expect(() => formatInr(value)).toThrow(/integer number of paise/);
    },
  );
});

describe('paiseSchema', () => {
  it('accepts non-negative integers only', () => {
    expect(paiseSchema.safeParse(49_900).success).toBe(true);
    expect(paiseSchema.safeParse(0).success).toBe(true);
    expect(paiseSchema.safeParse(499.5).success).toBe(false);
    expect(paiseSchema.safeParse(-1).success).toBe(false);
    expect(paiseSchema.safeParse('49900').success).toBe(false);
  });
});
