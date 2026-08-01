import { describe, expect, it } from 'vitest';
import { Decimal, assertNotNumber, fromWire, roundTo, toWire } from '../../src/common/money.js';

describe('roundTo', () => {
  it('half-up on positive amounts', () => {
    expect(roundTo('1.125', 2).toString()).toBe('1.13');
    expect(roundTo('1.124', 2).toString()).toBe('1.12');
    expect(roundTo('2.005', 2).toString()).toBe('2.01');
  });

  it('half-up on negative amounts rounds AWAY from zero at ties', () => {
    // decimal.js ROUND_HALF_UP rounds ties away from zero: -1.125 → -1.13.
    // This is the standard financial semantic and matches Postgres
    // NUMERIC ROUND — a settlement that is exactly on the half rounds
    // in favour of the larger absolute magnitude.
    expect(roundTo('-1.125', 2).toString()).toBe('-1.13');
    expect(roundTo('-1.124', 2).toString()).toBe('-1.12');
    expect(roundTo('-1.126', 2).toString()).toBe('-1.13');
  });

  it('accepts a Decimal input', () => {
    expect(roundTo(new Decimal('3.14159'), 2).toString()).toBe('3.14');
  });

  it('respects per-currency decimal places (JPY=0, USD=2, high=8)', () => {
    expect(roundTo('1234.99', 0).toString()).toBe('1235');
    expect(roundTo('1234.99', 2).toString()).toBe('1234.99');
    expect(roundTo('1234.999999999', 8).toString()).toBe('1235');
  });

  it('rejects a JavaScript number at runtime (D-002)', () => {
    expect(() => roundTo(1.125 as unknown as string, 2)).toThrow(/number/);
  });
});

describe('assertNotNumber', () => {
  it('throws on number', () => {
    expect(() => assertNotNumber(3.14)).toThrow();
  });
  it('does not throw on string, Decimal, undefined, null', () => {
    expect(() => assertNotNumber('3.14')).not.toThrow();
    expect(() => assertNotNumber(new Decimal('3.14'))).not.toThrow();
    expect(() => assertNotNumber(undefined)).not.toThrow();
    expect(() => assertNotNumber(null)).not.toThrow();
  });
});

describe('toWire / fromWire', () => {
  it('renders fixed-length strings, no scientific notation, no dropped zeros', () => {
    expect(toWire('1234', 2)).toBe('1234.00');
    expect(toWire('0.1', 4)).toBe('0.1000');
    expect(toWire('1e-6', 2)).toBe('0.00');
  });
  it('fromWire round-trips', () => {
    expect(fromWire(toWire('39.4200', 4)).toString()).toBe('39.42');
  });
});
