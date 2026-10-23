import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

// The database only backs the legacy Yahoo OAuth sessions, which the app does
// not need. Connect lazily so the server starts without DATABASE_URL; Yahoo
// routes then report storage as unavailable and everything else is unaffected.
export const databaseConfigured = Boolean(process.env.DATABASE_URL);

let poolInstance: pg.Pool | undefined;
let dbInstance: NodePgDatabase<typeof schema> | undefined;

function getPool(): pg.Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set; the Yahoo session database is unavailable.");
  }
  return (poolInstance ??= new Pool({ connectionString: process.env.DATABASE_URL }));
}

function lazy<T extends object>(get: () => T): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      const target = get();
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export const pool: pg.Pool = lazy(getPool);
export const db: NodePgDatabase<typeof schema> = lazy(
  () => (dbInstance ??= drizzle(getPool(), { schema })),
);

export * from "./schema";
