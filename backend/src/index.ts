import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import agentRouter from "./routes/agent";
import coursesRouter from "./routes/courses";

dotenv.config();

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", message: "Backend is running" });
});

// Single agent entry point for all query-based interactions (search, summarize, etc.)
app.use("/api/agent", agentRouter);

// REST endpoints for on-demand UI actions (placeholders until Rachael + Junzhe implement)
// GET /api/courses/:id/eval-summary  — Rachael: getCourseEvalSummary (R4)
// GET /api/courses/:id/details       — Junzhe: fetchSisCourseDetails (R3)
app.use("/api/courses", coursesRouter);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
