import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(join(__dirname, "app.ts"), "utf8");
const indexSource = readFileSync(join(__dirname, "index.ts"), "utf8");

describe("backend app route composition", () => {
  it("keeps health, auth, program list, and schedule routes mounted", () => {
    expect(appSource).toContain('app.get("/api/health"');
    expect(appSource).toContain('app.get("/api/auth/me"');
    expect(appSource).toContain('app.use("/api", programListRouter)');
    expect(appSource).toContain('app.use("/auth", authRouter)');
    expect(appSource).toContain('app.use("/api/schedules", schedulesRouter)');
  });

  it("mounts the agent route behind requireAuth", () => {
    const protectedMount = appSource.indexOf('app.use("/api/agent", requireAuth, agentRouter)');
    const compatibilityMount = appSource.indexOf('app.use("/api/agent", agentRouter)');

    expect(protectedMount).toBeGreaterThan(-1);
    expect(compatibilityMount).toBe(-1);
  });

  it("keeps index.ts as the local server listener only", () => {
    expect(indexSource).toContain('import app from "./app"');
    expect(indexSource).toContain("app.listen(PORT");
    expect(indexSource).not.toContain('app.use("/api/');
  });
});
