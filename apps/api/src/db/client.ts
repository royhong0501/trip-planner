import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import { env } from '../config/env.js';
import * as schema from './schema/index.js';

const poolConfig: PoolConfig = {
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
};

export const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  console.error('[pg] unexpected idle client error', err);
});

export const db = drizzle(pool, { schema });
export type Db = typeof db;
export { schema };
