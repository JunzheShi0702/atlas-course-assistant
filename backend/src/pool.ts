import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

type DatabaseSslConfig = false | { rejectUnauthorized: false };

function isDisabled(value: string | undefined): boolean {
  return ["0", "false", "disable", "disabled", "off", "no"].includes(
    value?.trim().toLowerCase() ?? "",
  );
}

function isEnabled(value: string | undefined): boolean {
  return ["1", "true", "require", "required", "on", "yes"].includes(
    value?.trim().toLowerCase() ?? "",
  );
}

export function databaseSslConfig(
  databaseUrl = process.env.DATABASE_URL,
  databaseSsl = process.env.DATABASE_SSL,
): DatabaseSslConfig {
  if (isDisabled(databaseSsl)) return false;
  if (isEnabled(databaseSsl)) return { rejectUnauthorized: false };
  if (!databaseUrl) return false;

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return false;
  }

  const sslMode = parsed.searchParams.get("sslmode")?.trim().toLowerCase();
  if (sslMode === "disable") return false;
  if (sslMode && sslMode !== "prefer") return { rejectUnauthorized: false };

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    return false;
  }

  if (
    hostname.includes("supabase.") ||
    hostname.includes("neon.tech") ||
    hostname.includes("railway.app") ||
    hostname.includes("render.com")
  ) {
    return { rejectUnauthorized: false };
  }

  return process.env.VERCEL === "1" ? { rejectUnauthorized: false } : false;
}

// Keep the pool small for serverless: each Vercel function instance should
// hold at most a few connections so we don't exhaust the database's limit
// across concurrent instances.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: databaseSslConfig(),
  connectionTimeoutMillis: Number(process.env.DATABASE_CONNECTION_TIMEOUT_MS ?? 5_000),
  // Serverless-friendly limits
  max: Number(process.env.DATABASE_POOL_MAX ?? 3),
  // Close idle connections after 30 s so the pool never holds stale TCP
  // connections that the database-side pooler (e.g. Neon/pgBouncer) has
  // already silently dropped. Without this the pool can hand out a dead
  // connection to the session-store on the very next request, causing an
  // immediate 503 "Authentication session storage is unavailable".
  idleTimeoutMillis: Number(process.env.DATABASE_IDLE_TIMEOUT_MS ?? 30_000),
  // Send TCP keepalive probes so the OS detects dropped connections quickly
  // rather than waiting for a query to fail.
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
});

// Attach an error handler so idle-client errors (e.g. connection terminated
// by the remote server while waiting in the pool) don't become unhandled
// Node.js exceptions that can destabilise the Vercel function instance.
pool.on("error", (err) => {
  console.error("[pool] idle client error — connection removed from pool:", err.message);
});
