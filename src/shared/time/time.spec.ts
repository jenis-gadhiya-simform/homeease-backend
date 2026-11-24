import {
  DISPLAY_TIMEZONE,
  formatForEmail,
  isUtcIso,
  parseUtc,
  rangesOverlap,
  toUtcIso,
  utcInstantSchema,
} from './time.js';

const at = (iso: string) => new Date(iso);

describe('parseUtc / utcInstantSchema', () => {
  it.each(['2026-11-24T10:00:00Z', '2026-11-24T10:00:00.123Z'])(
    'accepts %s',
    (value) => {
      expect(parseUtc(value).toISOString()).toBe(new Date(value).toISOString());
      expect(utcInstantSchema.parse(value)).toBeInstanceOf(Date);
    },
  );

  it.each([
    '2026-11-24T15:30:00+05:30', // offsets are refused, even if equivalent
    '2026-11-24T10:00:00', // no zone
    '2026-11-24',
    '2026-13-01T00:00:00Z',
    'yesterday',
  ])('rejects %s', (value) => {
    expect(isUtcIso(value)).toBe(false);
    expect(() => parseUtc(value)).toThrow(/ending in "Z"/);
  });

  it('serializes back to UTC with Z', () => {
    expect(toUtcIso(parseUtc('2026-11-24T10:00:00Z'))).toBe(
      '2026-11-24T10:00:00.000Z',
    );
  });
});

describe('rangesOverlap', () => {
  const nineToTen = {
    start: at('2026-11-24T09:00:00Z'),
    end: at('2026-11-24T10:00:00Z'),
  };

  it('detects partial and full overlaps', () => {
    expect(
      rangesOverlap(nineToTen, {
        start: at('2026-11-24T09:30:00Z'),
        end: at('2026-11-24T10:30:00Z'),
      }),
    ).toBe(true);
    expect(
      rangesOverlap(nineToTen, {
        start: at('2026-11-24T08:00:00Z'),
        end: at('2026-11-24T11:00:00Z'),
      }),
    ).toBe(true);
  });

  it('treats touching ranges as not overlapping ([start, end))', () => {
    expect(
      rangesOverlap(nineToTen, {
        start: at('2026-11-24T10:00:00Z'),
        end: at('2026-11-24T11:00:00Z'),
      }),
    ).toBe(false);
  });

  it('works across UTC midnight', () => {
    const lateNight = {
      start: at('2026-11-24T23:00:00Z'),
      end: at('2026-11-25T01:00:00Z'),
    };
    expect(
      rangesOverlap(lateNight, {
        start: at('2026-11-25T00:30:00Z'),
        end: at('2026-11-25T00:45:00Z'),
      }),
    ).toBe(true);
  });

  it('rejects empty or inverted ranges', () => {
    expect(() =>
      rangesOverlap(nineToTen, { start: nineToTen.end, end: nineToTen.start }),
    ).toThrow(/end after it starts/);
  });
});

describe('formatForEmail', () => {
  it(`shows the instant in ${DISPLAY_TIMEZONE}`, () => {
    // 10:00 UTC = 15:30 IST
    expect(formatForEmail(at('2026-11-24T10:00:00Z'))).toBe(
      'Tue, 24 Nov 2026, 3:30 pm IST',
    );
  });

  it('rolls the date over when IST is past midnight', () => {
    // 20:00 UTC on the 24th = 01:30 IST on the 25th
    expect(formatForEmail(at('2026-11-24T20:00:00Z'))).toBe(
      'Wed, 25 Nov 2026, 1:30 am IST',
    );
  });
});
