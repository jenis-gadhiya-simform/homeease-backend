import type { Request } from 'express';
import { durationToMs, readCookie } from './auth-tokens.service.js';

const req = (cookie?: string) =>
  ({ headers: cookie === undefined ? {} : { cookie } }) as Request;

describe('durationToMs', () => {
  it.each([
    ['30s', 30_000],
    ['15m', 900_000],
    ['12h', 43_200_000],
    ['30d', 2_592_000_000],
  ])('%s → %d ms', (input, expected) => {
    expect(durationToMs(input)).toBe(expected);
  });

  it('rejects anything else', () => {
    expect(() => durationToMs('15 minutes')).toThrow(/Invalid duration/);
  });
});

describe('readCookie', () => {
  it('finds one cookie among several', () => {
    expect(readCookie(req('a=1; sw_refresh=abc-123; b=2'), 'sw_refresh')).toBe(
      'abc-123',
    );
  });

  it('is undefined when the cookie or the header is missing', () => {
    expect(readCookie(req('a=1'), 'sw_refresh')).toBeUndefined();
    expect(readCookie(req(), 'sw_refresh')).toBeUndefined();
  });

  it('does not match a cookie whose name only ends the same', () => {
    expect(readCookie(req('xsw_refresh=evil'), 'sw_refresh')).toBeUndefined();
  });

  it('ignores a malformed encoding', () => {
    expect(
      readCookie(req('sw_refresh=%E0%A4%A'), 'sw_refresh'),
    ).toBeUndefined();
  });
});
