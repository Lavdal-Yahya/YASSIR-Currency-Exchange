import { loadEnv, type Env } from './env.schema.js';

// A thin, framework-free wrapper around loadEnv. The Nest wiring
// (@Global module registered from AppModule) arrives with the first Nest
// bootstrap in P1-05. Until then this is what tests and scripts import.
let cached: Env | null = null;

export function getConfig(): Env {
  if (!cached) {
    cached = loadEnv();
  }
  return cached;
}

// Test helper: rebuild the config from a fresh env snapshot.
export function resetConfigForTest(): void {
  cached = null;
}
