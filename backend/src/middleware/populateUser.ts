import { Request, Response, NextFunction } from "express";
import { pool } from "../db";

/**
 * Runs on every request. If the session has a userId, fetches the user from
 * the DB and attaches it to req.user. Non-blocking for unauthenticated routes.
 */
export async function populateUser(req: Request, _res: Response, next: NextFunction) {
  const userId = req.session?.userId;
  if (!userId) return next();

  try {
    const { rows } = await pool.query(
      `SELECT id, email FROM users WHERE id = $1`,
      [userId],
    );
    if (rows[0]) {
      req.user = { id: rows[0].id, email: rows[0].email };
    }
  } catch {
    // Non-fatal — just leave req.user undefined
  }
  next();
}
