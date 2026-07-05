import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import type { RequestHandler } from "express";
import { pool } from "../db";
import { isHttpsDeployment } from "../deployment-url";

// Augment express-session so req.session.userId is typed
declare module "express-session" {
  interface SessionData {
    userId: string;
    oauthState: string;
    userPicture: string;
  }
}

const PgStore = connectPgSimple(session);

const isProd = isHttpsDeployment();

const SESSION_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS "session" (
  "sid" varchar NOT NULL COLLATE "default",
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL,
  CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE
);

CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
`;

let sessionTablePromise: Promise<void> | null = null;

export async function ensureSessionTable(): Promise<void> {
  if (sessionTablePromise) return sessionTablePromise;
  const attempt = pool.query(SESSION_TABLE_SQL).then(() => undefined);
  sessionTablePromise = attempt;
  // If this attempt fails, clear the cache so the next request retries rather
  // than permanently re-using the rejected promise. Without this, any transient
  // DB error on cold start (e.g. Neon compute waking up) permanently poisons
  // sessionTablePromise and every subsequent auth request gets a 503 because
  // the session table is never created.
  attempt.catch(() => {
    if (sessionTablePromise === attempt) {
      sessionTablePromise = null;
    }
  });
  return attempt;
}

export const ensureSessionTableMiddleware: RequestHandler = (_req, _res, next) => {
  ensureSessionTable()
    .catch((error: unknown) => {
      console.error("[session] unable to ensure session table:", error);
    })
    .finally(() => next());
};

// This middleware will create a session cookie,
// and store the session in the DB.
// On each request, req.session.userId will be available if the user is logged in.
export const sessionMiddleware = session({
  store: new PgStore({
    pool,
    tableName: "session",
    // Belt-and-suspenders: let connect-pg-simple also create the table when
    // missing. Our ensureSessionTableMiddleware is the primary mechanism, but
    // if it silently fails this keeps the store functional.
    createTableIfMissing: true,
    // Disable the background pruning timer. In a serverless environment a
    // setTimeout that outlives the request can hold pool resources in an
    // unexpected state. Expired sessions are cheap to leave; they don't affect
    // correctness because the WHERE clause already filters on `expire`.
    pruneSessionInterval: false,
  }),
  secret: process.env.SESSION_SECRET ?? "dev-secret-change-me",
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    // SameSite=None + Secure required for cross-origin credentialed fetches.
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    maxAge: 2 * 60 * 60 * 1000, // 2 hours
  },
});
