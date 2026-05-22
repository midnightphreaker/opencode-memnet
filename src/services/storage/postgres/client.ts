/**
 * Postgres.js client singleton for the Postgres storage backend.
 *
 * The client is **not** instantiated until `getPostgresClient()` is called,
 * keeping the import side-effect-free when only SQLite is in use.
 *
 * All log output redacts the connection URL to avoid leaking credentials.
 */

import postgres from "postgres";
import { CONFIG } from "../../../config.js";
import { log } from "../../logger.js";
import { redactDatabaseUrl } from "./vector.js";

export type SqlClient = postgres.Sql;

// ── Lazy singleton ──

let sqlInstance: SqlClient | null = null;

/**
 * Return (or lazily create) the Postgres.js connection pool.
 *
 * The `postgres()` constructor is synchronous — it returns a connection-pool
 * proxy immediately, with actual connections established lazily.  Because
 * JS is single-threaded, two concurrent synchronous callers cannot both see
 * `sqlInstance === null`.  We assign to `sqlInstance` **before** any
 * potentially-throwing work to guarantee a single pool is ever created.
 *
 * @throws Error if `CONFIG.postgres.url` is not set.
 */
export function getPostgresClient(): SqlClient {
  if (sqlInstance) return sqlInstance;

  const url = CONFIG.postgres!.url;
  if (!url) {
    throw new Error(
      "Cannot create Postgres client: CONFIG.postgres.url is not set. " +
        "Set 'postgres.url' in your config (supports env:// or file:// secret references)."
    );
  }

  log("[postgres] Creating connection pool", { url: redactDatabaseUrl(url) });

  // Assign immediately — prevents any re-entrancy from creating a second pool.
  sqlInstance = postgres(url, {
    max: CONFIG.postgres!.maxConnections ?? 10,
    idle_timeout: (CONFIG.postgres!.idleTimeoutSeconds ?? 30) as number,
    connect_timeout: (CONFIG.postgres!.connectTimeoutSeconds ?? 10) as number,
    ssl: CONFIG.postgres!.ssl === false ? false : "require",
    onnotice: () => {
      /* suppress NOTICE messages */
    },
  });

  return sqlInstance;
}

/**
 * Gracefully close the connection pool. Idempotent.
 */
export async function closePostgresClient(): Promise<void> {
  if (sqlInstance) {
    log("[postgres] Closing connection pool");
    const instance = sqlInstance;
    sqlInstance = null;
    await instance.end();
  }
}

/**
 * Verify the Postgres connection is alive by issuing `SELECT 1`.
 *
 * @throws Error (with redacted details) if the connection fails.
 */
export async function checkPostgresHealth(): Promise<void> {
  const sql = getPostgresClient();
  try {
    await sql`SELECT 1`;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log("[postgres] Health check failed", { error: message });
    throw new Error(
      `Postgres health check failed: ${message}. ` +
        `URL: ${redactDatabaseUrl(CONFIG.postgres!.url ?? "")}`
    );
  }
}
