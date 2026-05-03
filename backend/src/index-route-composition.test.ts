import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(__dirname, "index.ts"), "utf8");

describe("backend app route composition", () => {
  it("keeps health, auth, program list, and schedule routes mounted", () => {
    expect(source).toContain('app.get("/api/health"');
    expect(source).toContain('app.get("/api/auth/me"');
    expect(source).toContain('app.use("/api", programListRouter)');
    expect(source).toContain('app.use("/auth", authRouter)');
    expect(source).toContain('app.use("/api/schedules", schedulesRouter)');
  });

  it("mounts the agent route behind requireAuth before any compatibility mount", () => {
    const protectedMount = source.indexOf('app.use("/api/agent", requireAuth, agentRouter)');
    const compatibilityMount = source.indexOf('app.use("/api/agent", agentRouter)');

    expect(protectedMount).toBeGreaterThan(-1);
    expect(compatibilityMount).toBeGreaterThan(-1);
    expect(protectedMount).toBeLessThan(compatibilityMount);
  });

  it("documents duplicate legacy mounts that should be removed when index.ts can change", () => {
    expect(source.match(/app\.use\("\/api\/courses", coursesRouter\)/g)).toHaveLength(2);
    expect(source.match(/app\.use\("\/api\/user", usersRouter\)/g)).toHaveLength(2);
  });
});
