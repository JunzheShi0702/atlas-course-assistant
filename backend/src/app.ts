import dotenv from "dotenv";
dotenv.config(); // must run before any other import that reads process.env

import express, { NextFunction, Request, Response } from "express";
import cors from "cors";

import agentRouter from "./routes/agent";
import coursesRouter from "./routes/courses";
import usersRouter from "./routes/users";
import { requireAuth } from "./routes/users";
import authRouter from "./routes/auth";
import schedulesRouter from "./routes/schedules";
import programListRouter from "./routes/program-list";
import { ensureSessionTableMiddleware, sessionMiddleware } from "./middleware/session";
import { populateUser } from "./middleware/populateUser";
import { frontendUrl } from "./deployment-url";
import { pool } from "./pool";

const app = express();

app.set("trust proxy", 1);
app.use(cors({ origin: frontendUrl(), credentials: true }));
app.use(express.json());
app.use(ensureSessionTableMiddleware);
app.use(sessionMiddleware);
app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
  if (!req.path.startsWith("/auth")) {
    next(err);
    return;
  }

  console.error("[auth] session middleware error:", err);
  res.status(503).json({
    error: "Authentication session storage is unavailable.",
  });
});
app.use(populateUser);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", message: "Backend is running" });
});

app.get("/api/keepalive", async (_req, res) => {
  await pool.query("SELECT 1");
  res.json({ status: "ok", database: "ok" });
});

app.use("/api", programListRouter);
app.use("/auth", authRouter);

// Returns the authenticated user's info, or 401 if not authenticated
app.get("/api/auth/me", (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.json(req.user);
});

app.use("/api/courses", coursesRouter);
app.use("/api/user", usersRouter);
app.use("/api/agent", requireAuth, agentRouter);
app.use("/api/schedules", schedulesRouter);

export default app;
