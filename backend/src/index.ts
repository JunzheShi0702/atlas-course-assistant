import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import agentRouter from "./routes/agent";
import coursesRouter from "./routes/courses";
import usersRouter from "./routes/users";
import schedulesRouter from "./routes/schedules";
import { devAuthMiddleware } from "./middleware/auth";

dotenv.config();

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors());
app.use(express.json());

// Dev-only: auto-populate req.user so schedule routes work without OAuth.
// Replaced by real session/OAuth middleware in production.
if (process.env.NODE_ENV !== "production") {
  app.use(devAuthMiddleware);
}

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", message: "Backend is running" });
});

app.use("/api/agent", agentRouter);
app.use("/api/courses", coursesRouter);
app.use("/api/user", usersRouter);
app.use("/api/schedules", schedulesRouter);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
