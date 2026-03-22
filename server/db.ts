import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

function buildConnectionString(): string | undefined {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  const { PGHOST, PGDATABASE, PGUSER, PGPASSWORD, PGPORT } = process.env;
  if (PGHOST && PGDATABASE && PGUSER && PGPASSWORD) {
    const port = PGPORT || "5432";
    const connStr = `postgresql://${PGUSER}:${encodeURIComponent(PGPASSWORD)}@${PGHOST}:${port}/${PGDATABASE}`;
    console.log("[DB] DATABASE_URL not set — constructed from PG* vars");
    return connStr;
  }
  console.error("[DB] FATAL: No database connection string available. Set DATABASE_URL or PG* vars.");
  return undefined;
}

const pool = new pg.Pool({
  connectionString: buildConnectionString(),
});

export const db = drizzle(pool, { schema });
