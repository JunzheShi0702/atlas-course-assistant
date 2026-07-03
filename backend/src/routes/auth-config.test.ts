import { afterEach, describe, expect, it, vi } from "vitest";
import { googleCallbackUrl } from "./auth-config";

describe("googleCallbackUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the explicit Google callback URL when configured", () => {
    vi.stubEnv("GOOGLE_CALLBACK_URL", "https://atlas.example.com/auth/google/callback");
    vi.stubEnv("BACKEND_URL", "https://api.atlas.example.com");

    expect(googleCallbackUrl()).toBe("https://atlas.example.com/auth/google/callback");
  });

  it("falls back to BACKEND_URL for existing deployments", () => {
    vi.stubEnv("BACKEND_URL", "https://api.atlas.example.com");

    expect(googleCallbackUrl()).toBe("https://api.atlas.example.com/auth/google/callback");
  });

  it("falls back to the Vercel deployment URL when BACKEND_URL is absent", () => {
    vi.stubEnv("VERCEL_URL", "atlas-preview.vercel.app");

    expect(googleCallbackUrl()).toBe("https://atlas-preview.vercel.app/auth/google/callback");
  });
});
