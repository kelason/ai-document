import { describe, expect, it } from 'vitest';
import { guestExpiresAt, nextDemoReset } from '../../lib/temporary/expiry';

describe('temporary deadline display calculations', () => {
  it('fixes guest expiry at creation plus five hours without mutating creation', () => {
    const created = new Date('2026-10-27T02:00:00Z');
    expect(guestExpiresAt(created).toISOString()).toBe('2026-10-27T07:00:00.000Z');
    expect(created.toISOString()).toBe('2026-10-27T02:00:00.000Z');
  });
  it.each([
    ['2026-10-27T15:59:59Z', '2026-10-27T16:00:00.000Z'],
    ['2026-10-27T16:00:00Z', '2026-10-28T16:00:00.000Z'],
    ['2026-10-27T16:00:01Z', '2026-10-28T16:00:00.000Z'],
    ['2026-01-31T16:00:00Z', '2026-02-01T16:00:00.000Z'],
    ['2026-12-31T16:00:00Z', '2027-01-01T16:00:00.000Z'],
    ['2028-02-28T16:00:00Z', '2028-02-29T16:00:00.000Z'],
  ])('calculates the strictly next Philippine midnight for %s', (now, expected) => {
    expect(nextDemoReset(new Date(now)).toISOString()).toBe(expected);
  });
});
