import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { Provider } from "jotai";
import { useApi } from "./useApi";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function noContentResponse(status = 204): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({}),
  } as Response;
}

function wrapper({ children }: { children: React.ReactNode }) {
  return <Provider>{children}</Provider>;
}

describe("useApi memories", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("getUserMemories loads memories into state", async () => {
    const memories = [
      {
        id: "550e8400-e29b-41d4-a716-446655440000",
        text: "Prefer afternoons",
        type: "preference",
        source: "onboarding",
        confidence: 0.7,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ memories }));

    const { result } = renderHook(() => useApi(), { wrapper });

    await act(async () => {
      await result.current.getUserMemories();
    });

    expect(result.current.userMemories).toEqual(memories);
    expect(result.current.memoriesError).toBeNull();
    expect(result.current.memoriesLoading).toBe(false);
  });

  it("deleteUserMemory removes memory from state on 204", async () => {
    const a = {
      id: "550e8400-e29b-41d4-a716-446655440001",
      text: "a",
      type: "goal",
      source: "chat",
      confidence: 0.8,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const b = { ...a, id: "550e8400-e29b-41d4-a716-446655440002", text: "b" };
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ memories: [a, b] }))
      .mockResolvedValueOnce(noContentResponse(204));

    const { result } = renderHook(() => useApi(), { wrapper });

    await act(async () => {
      await result.current.getUserMemories();
    });

    await act(async () => {
      await result.current.deleteUserMemory(a.id);
    });

    expect(result.current.userMemories?.map((m) => m.id)).toEqual([b.id]);
    expect(result.current.memoryDeleteId).toBeNull();
  });

  it("deleteUserAccount sends DELETE with confirm true and clears profile/memories on 204", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(noContentResponse(204));

    const { result } = renderHook(() => useApi(), { wrapper });

    await act(async () => {
      await result.current.deleteUserAccount();
    });

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/user"),
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ confirm: true }),
      }),
    );
    expect(result.current.userProfile).toBeNull();
    expect(result.current.userMemories).toBeNull();
    expect(result.current.accountDeleteLoading).toBe(false);
  });

  it("deleteUserMemory rejects with server message on 409 and sets memoriesError", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        { message: "Edit profile preferences to change this memory." },
        409,
      ),
    );

    const { result } = renderHook(() => useApi(), { wrapper });

    await act(async () => {
      try {
        await result.current.deleteUserMemory("550e8400-e29b-41d4-a716-446655440003");
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
        expect((e as Error).message).toBe(
          "Edit profile preferences to change this memory.",
        );
      }
    });

    expect(result.current.memoriesError).toBe(
      "Edit profile preferences to change this memory.",
    );
  });

  it("deleteUserMemory rejects on 404 and sets memoriesError", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: "Memory not found" }, 404));

    const { result } = renderHook(() => useApi(), { wrapper });

    await act(async () => {
      try {
        await result.current.deleteUserMemory("550e8400-e29b-41d4-a716-446655440004");
      } catch {
        /* expected */
      }
    });

    expect(result.current.memoriesError).toBe("Memory not found");
  });

  it("clearErrors clears memoriesError", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: "fail" }, 500));

    const { result } = renderHook(() => useApi(), { wrapper });

    await act(async () => {
      try {
        await result.current.getUserMemories();
      } catch {
        /* expected */
      }
    });

    expect(result.current.memoriesError).toBeTruthy();

    act(() => {
      result.current.clearErrors();
    });

    expect(result.current.memoriesError).toBeNull();
  });
});
