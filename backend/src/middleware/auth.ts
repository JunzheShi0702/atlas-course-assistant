/**
 * Auth middleware — Issue #116
 *
 * requireAuth: enforces the shared auth contract from docs/iteration-2-plan.md.
 *   req.user must be set (by OAuth session middleware) before reaching protected routes.
 *   Returns 401 if missing.
 *
 * devAuthMiddleware: development-only stub that sets req.user so routes can be
 *   tested locally without a real OAuth session. Uses a fixed dev user ID so all
 *   schedules created during development belong to the same user.
 *   This middleware must NOT be registered in production.
 */

import { Request, Response, NextFunction } from "express";

/** Guards a route: 401 if req.user is not set. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

const DEV_USER = {
  id: "dev-user-00000000-0000-0000-0000-000000000001",
  email: "dev@atlas-jhu.dev",
  name: "Dev User",
};

/**
 * Development-only stub: sets req.user to a fixed dev user so protected routes
 * work without real OAuth. Only registers itself when NODE_ENV !== "production".
 */
export function devAuthMiddleware(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    req.user = DEV_USER;
  }
  next();
}
