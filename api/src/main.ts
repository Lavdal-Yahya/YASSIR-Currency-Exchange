import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './bootstrap.js';
import { getConfig } from './config/config.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  configureApp(app);

  const { API_PORT } = getConfig();
  await app.listen(API_PORT);
  // eslint-disable-next-line no-console
  console.log(`api listening on :${API_PORT}`);
}

void bootstrap();
