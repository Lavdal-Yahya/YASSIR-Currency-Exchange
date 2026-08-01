import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { loadEnv, type Env } from './env.schema.js';

// Nest wraps @nestjs/config's ConfigModule and installs our zod schema
// as the validator. A malformed env stops the app at boot, before any
// controller accepts a request.
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: (raw) => loadEnv(raw as NodeJS.ProcessEnv),
    }),
  ],
  exports: [ConfigModule],
})
export class AppConfigModule {}

// Standalone helper for scripts and tests that don't boot Nest.
let cached: Env | null = null;
export function getConfig(): Env {
  if (!cached) cached = loadEnv();
  return cached;
}
export function resetConfigForTest(): void {
  cached = null;
}
