import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  EMPLOYEE_PERMISSIONS,
  OWNER_PERMISSIONS,
  PERMISSIONS,
  ROLE_CODES,
} from '../../src/common/permissions.js';

describe('permissions registry', () => {
  it('exposes every value in PERMISSIONS via ALL_PERMISSIONS', () => {
    const values = Object.values(PERMISSIONS);
    expect(ALL_PERMISSIONS).toHaveLength(values.length);
    for (const v of values) {
      expect(ALL_PERMISSIONS).toContain(v);
    }
  });

  it('has no duplicate codes', () => {
    const seen = new Set<string>();
    for (const code of ALL_PERMISSIONS) {
      expect(seen.has(code), `duplicate permission: ${code}`).toBe(false);
      seen.add(code);
    }
  });

  it('uses <domain>:<action> shape for every code', () => {
    for (const code of ALL_PERMISSIONS) {
      expect(code, `bad shape: ${code}`).toMatch(/^[a-z][a-z_]*:[a-z][a-z_]*$/);
    }
  });

  it('gives OWNER every permission', () => {
    expect(new Set(OWNER_PERMISSIONS)).toEqual(new Set(ALL_PERMISSIONS));
  });

  it('withholds profit:view, reversal:*, audit:read and settings:* from EMPLOYEE', () => {
    const set = new Set<string>(EMPLOYEE_PERMISSIONS);
    expect(set.has(PERMISSIONS.PROFIT_VIEW)).toBe(false);
    expect(set.has(PERMISSIONS.REVERSAL_TRADE)).toBe(false);
    expect(set.has(PERMISSIONS.REVERSAL_PAYMENT)).toBe(false);
    expect(set.has(PERMISSIONS.REVERSAL_EXPENSE)).toBe(false);
    expect(set.has(PERMISSIONS.AUDIT_READ)).toBe(false);
    expect(set.has(PERMISSIONS.SETTINGS_MANAGE)).toBe(false);
    expect(set.has(PERMISSIONS.SETTINGS_GO_LIVE)).toBe(false);
    // ...and cannot manage users
    expect(set.has(PERMISSIONS.USER_MANAGE)).toBe(false);
    expect(set.has(PERMISSIONS.USER_CREATE)).toBe(false);
    // ...but can operate the till
    expect(set.has(PERMISSIONS.SALE_CREATE)).toBe(true);
    expect(set.has(PERMISSIONS.PAYMENT_RECEIVE)).toBe(true);
  });

  it('has exactly the two expected role codes', () => {
    expect(ROLE_CODES).toEqual({ OWNER: 'OWNER', EMPLOYEE: 'EMPLOYEE' });
  });
});
