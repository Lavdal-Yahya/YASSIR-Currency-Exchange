// The DomainExceptionFilter is the one place any error becomes an HTTP
// response. Assert the wire shape and the absence of stack traces.

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
  await setupTestDb();
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

describe('DomainExceptionFilter', () => {
  it('DomainError becomes { code, i18nKey, message, requestId } with no stack', async () => {
    // A login for a non-existent user throws InvalidCredentialsError.
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ phone: '+22200000999', pin: '1234' })
      .expect(401);

    expect(res.body).toMatchObject({
      code: 'invalid_credentials',
      i18nKey: 'error.invalid_credentials',
    });
    expect(res.body.requestId).toMatch(/^[0-9a-f]{12}$/);
    expect(res.body.stack).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts/);
  });

  it('validation error becomes { code: "validation", data: { errors: [...] } }', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({}) // missing phone + pin
      .expect(400);
    expect(res.body.code).toBe('validation');
    expect(res.body.i18nKey).toBe('error.validation');
    expect(res.body.data?.errors).toBeDefined();
    expect(Array.isArray(res.body.data.errors)).toBe(true);
  });

  it('unauthenticated request becomes 401 with the domain shape', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
    expect(res.body).toMatchObject({ code: 'unauthorized', i18nKey: 'error.unauthorized' });
    expect(res.body.requestId).toBeDefined();
  });
});
