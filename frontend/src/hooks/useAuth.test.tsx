import { Provider } from "jotai";
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "./useAuth";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const wrapper = ({ children }: { children: ReactNode }) => <Provider>{children}</Provider>;

describe("useAuth", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("sets current user and returns has_profile when session and profile exist", async () => {
    const user = {
      id: "00000000-0000-0000-0000-000000000001",
      email: "student@jhu.edu",
      name: "Student",
    };
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(user))
      .mockResolvedValueOnce(jsonResponse({ school: "WSE" }));

    const { result } = renderHook(() => useAuth(), { wrapper });

    let state;
    await act(async () => {
      state = await result.current.checkAuth();
    });

    expect(state).toBe("has_profile");
    expect(result.current.currentUser).toEqual(user);
  });

  it("returns no_profile when the authenticated user has no profile", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          id: "00000000-0000-0000-0000-000000000001",
          email: "student@jhu.edu",
          name: "Student",
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ error: "Profile not found" }, 404));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await expect(result.current.checkAuth()).resolves.toBe("no_profile");
  });

  it("clears current user and returns null on unauthenticated sessions", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: "Unauthorized" }, 401));
    const { result } = renderHook(() => useAuth(), { wrapper });

    await expect(result.current.checkAuth()).resolves.toBeNull();

    expect(result.current.currentUser).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("posts logout and clears user even when the request fails", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network down"));
    const originalHref = window.location.href;
    const { result } = renderHook(() => useAuth(), { wrapper });

    await expect(result.current.logout()).rejects.toThrow("network down");

    expect(fetch).toHaveBeenCalledWith(
      "/auth/logout",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    expect(result.current.currentUser).toBeNull();
    expect(window.location.href).toBe(originalHref);
  });
});
