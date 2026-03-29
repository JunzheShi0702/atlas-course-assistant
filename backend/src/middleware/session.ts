import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "../db";

// Augment express-session so req.session.userId is typed
declare module "express-session" {
  interface SessionData {
    userId: string;
    oauthState: string;
  }
}

const PgStore = connectPgSimple(session);

// Detect production via BACKEND_URL rather than NODE_ENV.
// NODE_ENV=production breaks npm install (skips devDependencies including esbuild),
// so we cannot rely on it being set in the Render environment.
const isProd = (process.env.BACKEND_URL ?? "").startsWith("https://");

// This middleware will create a session cookie,
// and store the session in the DB.
// On each request, req.session.userId will be available if the user is logged in.
export const sessionMiddleware = session({
  store: new PgStore({ pool, tableName: "session", createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET ?? "dev-secret-change-me",
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    // SameSite=None + Secure required for cross-origin credentialed fetches
    // (frontend and backend on separate Render domains).
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    maxAge: 2 * 60 * 60 * 1000, // 2 hours
  },
});
