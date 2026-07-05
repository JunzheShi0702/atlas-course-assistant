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
  sessionTablePromise ??= pool.query(SESSION_TABLE_SQL).then(() => undefined);
  return sessionTablePromise;
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
    createTableIfMissing: false,
    // Disable the background pruning timer. In a serverless environment a
    // setInterval/setTimeout that outlives the request can hold pool connections
    // in an unexpected state. Expired sessions are cheap to leave; they don't
    // affect correctness because the WHERE clause already filters on `expire`.
    pruneSessionInterval: false,
    // Don't UPDATE the session row on every request just to extend the expiry.
    // The session is re-saved on writes (e.g. after login) which is sufficient.
    disableTouch: true,
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
