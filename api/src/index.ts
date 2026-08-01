// Real bootstrap arrives in P1-05 with the NestJS AppModule. This entry
// point exists so `tsc` and `eslint` have a root, and re-exports the pieces
// already in place so consumers can wire against them.
export { getConfig, resetConfigForTest } from './config/config.module.js';
export type { Env } from './config/env.schema.js';
