import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './bootstrap.js';
import { getConfig } from './config/config.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  configureApp(app);

  const { API_PORT } = getConfig();
  // Explicit 0.0.0.0 — on Alpine/Node under Docker, omitting the host
  // arg can bind to ::1 (IPv6 loopback) and become unreachable from
  // sibling containers. Belt-and-braces even though Express defaults
  // to all interfaces today.
  await app.listen(API_PORT, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`api listening on :${API_PORT}`);
}

void bootstrap();
