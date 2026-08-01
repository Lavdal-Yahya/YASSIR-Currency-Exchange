import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env.schema.js';

const validEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  JWT_SECRET: 'x'.repeat(48),
};

describe('loadEnv', () => {
  it('accepts a minimal valid environment', () => {
    const env = loadEnv(validEnv);
    expect(env.NODE_ENV).toBe('test');
    expect(env.API_PORT).toBe(3000);
    expect(env.JWT_TTL).toBe('12h');
    expect(env.BUSINESS_TZ).toBe('Africa/Nouakchott');
    expect(env.COOKIE_NAME).toBe('cx_session');
  });

  it('rejects a JWT_SECRET shorter than 32 chars', () => {
    expect(() => loadEnv({ ...validEnv, JWT_SECRET: 'too-short' })).toThrow(/JWT_SECRET/);
  });

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() => loadEnv({ ...validEnv, DATABASE_URL: 'mysql://x/y' })).toThrow(/DATABASE_URL/);
  });

  it('rejects a JWT_TTL that does not match the duration shape', () => {
    expect(() => loadEnv({ ...validEnv, JWT_TTL: 'forever' })).toThrow(/JWT_TTL/);
  });

  it('coerces API_PORT from a string', () => {
    const env = loadEnv({ ...validEnv, API_PORT: '4000' });
    expect(env.API_PORT).toBe(4000);
  });
});
