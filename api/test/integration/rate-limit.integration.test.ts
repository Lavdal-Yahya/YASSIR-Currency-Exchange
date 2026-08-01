// Rate limiting on POST /auth/login (P1-06).
//
// Both throttlers are in-process, so we hit them through the real HTTP
// stack. supertest against a real NestApplication instance is the only
// way to exercise the ThrottlerGuard — the guard reads `req.ip` and
// `req.body`, neither of which exist when a service is called directly.
//
// The window is short (60s for IP, 1h for phone) so the test uses fresh
// values per test to isolate them. The AppModule sits inside a describe
// block that boots + tears down between suites.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/bootstrap.js';
import { PrismaService } from '../../src/common/prisma.service.js';
import { setupTestDb } from '../setup.js';

let app: INestApplication;
let prisma: PrismaService;

beforeAll(async () => {
  await setupTestDb(); // resets DB via prisma migrate reset

  app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  await app.init();
  prisma = app.get(PrismaService);
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "audit_log", "user_role", "role_permission", "user", "role", "permission" RESTART IDENTITY CASCADE;',
  );
});

async function attemptLogin(phone: string, xff?: string): Promise<number> {
  const req = request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ phone, pin: '9999' });
  if (xff) req.set('X-Forwarded-For', xff);
  const res = await req;
  return res.status;
}

describe('POST /auth/login rate limiting', () => {
  it('IP limiter rejects the 6th attempt within 60s (different phones)', async () => {
    // Fresh IP so we don't collide with other tests. supertest defaults
    // to 127.0.0.1; a different XFF exercises the trust-proxy path.
    const ip = '10.99.0.1';
    for (let i = 0; i < 5; i++) {
      const status = await attemptLogin(`+22299999${100 + i}`, ip);
      expect(status).toBe(401);
    }
    const sixth = await attemptLogin('+22299999200', ip);
    expect(sixth).toBe(429);
  });

  it('phone limiter rejects the 11th attempt within 1h (different IPs)', async () => {
    const phone = '+22288887777';
    for (let i = 0; i < 10; i++) {
      const status = await attemptLogin(phone, `10.88.0.${i + 1}`);
      // The IP limiter allows 5/min/IP so 10 attempts each from a new IP
      // land under it — the phone counter is the one climbing.
      expect(status).toBe(401);
    }
    const eleventh = await attemptLogin(phone, '10.88.0.99');
    expect(eleventh).toBe(429);
  });
});
