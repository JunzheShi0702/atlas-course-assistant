import { afterEach, describe, expect, it, vi } from "vitest";
import { backendUrl, frontendUrl, isHttpsDeployment } from "./deployment-url";

describe("deployment URL helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses local defaults when no deployment URLs are configured", () => {
    expect(frontendUrl()).toBe("http://localhost:5173");
    expect(backendUrl()).toBe("http://localhost:3001");
    expect(isHttpsDeployment()).toBe(false);
  });

  it("prefers explicit frontend and backend URLs", () => {
    vi.stubEnv("FRONTEND_URL", "https://atlas.example.com");
    vi.stubEnv("BACKEND_URL", "https://api.atlas.example.com");
    vi.stubEnv("VERCEL_URL", "preview.vercel.app");

    expect(frontendUrl()).toBe("https://atlas.example.com");
    expect(backendUrl()).toBe("https://api.atlas.example.com");
    expect(isHttpsDeployment()).toBe(true);
  });

  it("uses Vercel domains when explicit URLs are absent", () => {
    vi.stubEnv("VERCEL_URL", "atlas-preview.vercel.app");

    expect(frontendUrl()).toBe("https://atlas-preview.vercel.app");
    expect(backendUrl()).toBe("https://atlas-preview.vercel.app");
    expect(isHttpsDeployment()).toBe(true);
  });

  it("prefers the production Vercel domain over the preview URL", () => {
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "atlas.vercel.app");
    vi.stubEnv("VERCEL_URL", "atlas-git-feature.vercel.app");

    expect(frontendUrl()).toBe("https://atlas.vercel.app");
    expect(backendUrl()).toBe("https://atlas.vercel.app");
  });
});
