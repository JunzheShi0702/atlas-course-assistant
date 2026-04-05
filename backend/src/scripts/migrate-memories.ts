import { pool } from "../pool";
import fs from "fs";
import path from "path";

async function run() {
  const initSql = fs.readFileSync(
    path.resolve(__dirname, "../../../database/init.sql"),
    "utf-8",
  );

  const migrateSql = fs.readFileSync(
    path.resolve(__dirname, "../../../database/migrate-derived-memories.sql"),
    "utf-8",
  );

  console.log("Creating user_memories table (if not exists)...");
  await pool.query(initSql);

  console.log("Backfilling from user_profiles.derived_memories...");
  await pool.query(migrateSql);

  const { rows } = await pool.query("SELECT count(*) AS n FROM user_memories");
  console.log(`Done — ${rows[0].n} rows now in user_memories.`);

  await pool.end();
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
