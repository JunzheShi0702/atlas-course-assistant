import dotenv from "dotenv";
dotenv.config(); // must run before any other import that reads process.env

import express, { Request, Response } from "express";
import cors from "cors";

import agentRouter from "./routes/agent";
import coursesRouter from "./routes/courses";
import usersRouter from "./routes/users";
import { requireAuth } from "./routes/users";
import authRouter from "./routes/auth";
import schedulesRouter from "./routes/schedules";

import { sessionMiddleware } from "./middleware/session";

import { populateUser } from "./middleware/populateUser";

const app = express();
const PORT = process.env.PORT ?? 3001;

app.set("trust proxy", 1);
app.use(cors({ origin: process.env.FRONTEND_URL ?? "http://localhost:5173", credentials: true }));
app.use(express.json());
app.use(sessionMiddleware); 
app.use(populateUser);  


app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", message: "Backend is running" });
});

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
app.use("/api/agent", agentRouter);
app.use("/api/courses", coursesRouter);
app.use("/api/user", usersRouter);
app.use("/api/schedules", schedulesRouter);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
