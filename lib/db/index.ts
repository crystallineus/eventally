import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

// The WebSocket driver (not neon-http) so ledger writes can run in transactions.
let cached: ReturnType<typeof create> | undefined;

function create() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return drizzle({ client: new Pool({ connectionString: url }), schema });
}

/** Lazily connect so importing this module (e.g. during `next build`) doesn't need a database. */
export function db() {
  cached ??= create();
  return cached;
}

export { schema };
