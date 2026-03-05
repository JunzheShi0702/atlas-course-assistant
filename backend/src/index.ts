import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import searchRouter from "./routes/search";
import coursesRouter from "./routes/courses";

dotenv.config();

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", message: "Backend is running" });
});

app.use("/api/search", searchRouter);
app.use("/api/courses", coursesRouter);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
