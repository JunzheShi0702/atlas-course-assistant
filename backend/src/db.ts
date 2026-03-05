import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Supabase requires SSL; local Docker does not
  ssl:
    process.env.DATABASE_URL?.includes("supabase.co") ||
    process.env.DATABASE_URL?.includes("supabase.com")
      ? { rejectUnauthorized: false }
      : false,
});
