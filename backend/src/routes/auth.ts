/**
 * Auth endpoints
 *
 * GET  /auth/google          — Redirect to Google OAuth consent screen
 * GET  /auth/google/callback — OAuth callback; upsert user, set session, redirect to app
 * POST /auth/logout          — Destroy session
 */

import { randomBytes } from "crypto";
import { Router, Request, Response } from "express";
import { OAuth2Client } from "google-auth-library";
import { upsertUserByGoogleSub } from "./users";

const router = Router();

const oauthClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${process.env.BACKEND_URL ?? "http://localhost:3001"}/auth/google/callback`,
);

const frontendUrl = () => process.env.FRONTEND_URL ?? "http://localhost:5173";
const loginRedirect = () => `${frontendUrl()}/login`;

// Frontend hits this when the user clicks "Sign in with Google".
// Generates a random state token (CSRF protection), stores it in the session,
// then builds the Google consent URL and redirects the browser there.
router.get("/google", (req: Request, res: Response) => {
  const state = randomBytes(16).toString("hex");
  req.session.oauthState = state;
  const url = oauthClient.generateAuthUrl({
    access_type: "online",
    scope: ["profile", "email"],
    state,
  });
  res.redirect(url);
});

// Google redirects here after the user approves (or cancels) on the consent screen.
// Exchanges the one-time code for an ID token, verifies it, upserts the user row,
// stores the UUID in the session cookie, then sends the browser back to the frontend.
router.get("/google/callback", async (req: Request, res: Response) => {
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;

  if (!code || !state || state !== req.session.oauthState) {
    res.redirect(loginRedirect());
    return;
  }

  // Clear state so it cannot be replayed
  delete req.session.oauthState;

  try {
    const { tokens } = await oauthClient.getToken(code);

    if (!tokens.id_token) {
      res.redirect(loginRedirect());
      return;
    }

    const ticket = await oauthClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();

    if (!payload?.sub || !payload?.email) {
      res.redirect(loginRedirect());
      return;
    }

    const user = await upsertUserByGoogleSub(payload.email, payload.sub);

    // Store only the UUID — email/name are fetched fresh from DB on each request.
    // Explicitly save before redirecting: express-session with resave:false saves
    // lazily, which creates a race condition where the frontend's immediate
    // /api/auth/me call arrives before the session is written to the DB.
    req.session.userId = user.id;
    req.session.save((saveErr) => {
      if (saveErr) {
        console.error("OAuth session save error:", saveErr);
        res.redirect(loginRedirect());
        return;
      }
      res.redirect(frontendUrl());
    });
  } catch (err) {
    console.error("OAuth callback error:", err);
    res.redirect(loginRedirect());
  }
});

// Frontend calls this when the user clicks "Log out".
// Destroys the server-side session so the cookie is no longer valid.
router.post("/logout", (req: Request, res: Response) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

export default router;
