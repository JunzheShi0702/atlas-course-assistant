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

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: databaseSslConfig(),
  connectionTimeoutMillis: Number(process.env.DATABASE_CONNECTION_TIMEOUT_MS ?? 5_000),
});
