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
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 2 * 60 * 60 * 1000, // 2 hours in milliseconds
  },
});
