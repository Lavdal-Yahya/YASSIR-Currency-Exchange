import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';
import { getConfig } from './config/config.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  app.use(cookieParser());
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // Trust the reverse proxy (Traefik in prod, docker-compose in dev) so
  // `req.ip` reflects the real client for rate limiting and audit rows.
  const httpAdapter = app.getHttpAdapter();
  const instance = httpAdapter.getInstance();
  if (typeof instance.set === 'function') {
    instance.set('trust proxy', 'loopback, linklocal, uniquelocal');
  }

  const { API_PORT } = getConfig();
  await app.listen(API_PORT);
  // eslint-disable-next-line no-console
  console.log(`api listening on :${API_PORT}`);
}

void bootstrap();
