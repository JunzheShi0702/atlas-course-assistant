import { describe, expect, it } from "vitest";
import { apiUrl, resolveApiUrl } from "./apiUrl";

describe("apiUrl", () => {
  it("returns relative paths when VITE_API_URL is unset", () => {
    expect(apiUrl("/api/auth/me")).toBe("/api/auth/me");
  });

  it("uses same-origin API base and removes trailing slash", () => {
    expect(resolveApiUrl("/api/auth/me", "http://localhost:3000/", "http://localhost:3000")).toBe(
      "http://localhost:3000/api/auth/me",
    );
  });

  it("falls back to relative paths for cross-origin API bases", () => {
    expect(resolveApiUrl("/api/auth/me", "https://api.example.edu", "http://localhost:3000")).toBe(
      "/api/auth/me",
    );
  });

  it("falls back to relative paths for invalid API bases", () => {
    expect(resolveApiUrl("/api/auth/me", "http://[invalid", "http://localhost:3000")).toBe(
      "/api/auth/me",
    );
  });

  it("uses configured base outside the browser where same-origin cannot be checked", () => {
    expect(resolveApiUrl("/api/auth/me", "https://api.example.edu", undefined)).toBe(
      "https://api.example.edu/api/auth/me",
    );
  });
});
