import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MemoriesPage from "./MemoriesPage";
import type { MemoryItem } from "@/hooks/useApi";

const { mockNavigate, mockUseApi } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockUseApi: vi.fn(),
}));

vi.mock("@/components/Header", () => ({
  default: () => <header>Header</header>,
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("@/hooks/useApi", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useApi")>("@/hooks/useApi");
  return {
    ...actual,
    useApi: mockUseApi,
  };
});

const memories: MemoryItem[] = [
  {
    id: "manual-1",
    text: "Prefers morning classes",
    type: "preference",
    source: "manual",
    confidence: 1,
    createdAt: "2026-04-01T00:00:00.000Z",
  },
  {
    id: "onboarding-1",
    text: "Interested in systems",
    type: "goal",
    source: "onboarding",
    confidence: 0.8,
    createdAt: "2026-04-02T00:00:00.000Z",
  },
  {
    id: "course-1",
    text: "EN.601.226",
    type: "course_history",
    source: "course_history",
    confidence: 1,
    createdAt: "2026-04-03T00:00:00.000Z",
  },
];

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/memories"]}>
      <MemoriesPage />
    </MemoryRouter>,
  );
}

function makeApi(overrides: Partial<ReturnType<typeof baseApi>> = {}) {
  return {
    ...baseApi(),
    ...overrides,
  };
}

function baseApi() {
  return {
    getUserMemories: vi.fn().mockResolvedValue(memories),
    userMemories: memories,
    memoriesLoading: false,
    memoriesError: null,
    deleteUserMemory: vi.fn().mockResolvedValue(undefined),
    memoryDeleteId: null,
    addCourseHistoryMemory: vi.fn().mockResolvedValue({ id: "course-2", courseCode: "EN.601.220" }),
    clearConversationMemories: vi.fn().mockResolvedValue({ deleted: 1 }),
    addManualMemory: vi.fn().mockResolvedValue(memories[0]),
    processTranscriptCourseCodes: vi.fn(),
    saveTranscriptReview: vi.fn(),
    deleteUserAccount: vi.fn(),
    accountDeleteLoading: false,
    searchSisCourses: vi.fn().mockResolvedValue([]),
  };
}

describe("MemoriesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.confirm = vi.fn(() => true);
  });

  it("loads memories and separates conversation, onboarding, and course-history sections", async () => {
    const api = makeApi();
    mockUseApi.mockReturnValue(api);

    renderPage();

    expect(api.getUserMemories).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /Conversations1 memory/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /Onboarding Survey1 memory/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /Course History1 course/i })).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: /Conversations1 memory/i }));
    expect(screen.getByText("Prefers morning classes")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: /Onboarding Survey1 memory/i }));
    expect(screen.getByText("Interested in systems")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: /Course History1 course/i }));
    expect(screen.getByText("EN.601.226")).toBeVisible();
  });

  it("adds a manual memory from the conversations section", async () => {
    const user = userEvent.setup();
    const api = makeApi();
    mockUseApi.mockReturnValue(api);

    renderPage();
    await user.click(screen.getByRole("button", { name: /Conversations1 memory/i }));
    await user.click(screen.getByRole("button", { name: "Add manual memory" }));
    await user.selectOptions(screen.getByLabelText("Type"), "constraint");
    await user.type(screen.getByLabelText("Text"), "Must avoid Friday classes");
    await user.click(screen.getByRole("button", { name: "Save memory" }));

    await waitFor(() => {
      expect(api.addManualMemory).toHaveBeenCalledWith("Must avoid Friday classes", "constraint");
    });
  });

  it("clears conversation memories only after confirmation", async () => {
    const user = userEvent.setup();
    const api = makeApi();
    mockUseApi.mockReturnValue(api);

    renderPage();
    await user.click(screen.getByRole("button", { name: /Conversations1 memory/i }));
    await user.click(screen.getByRole("button", { name: "Clear all conversations" }));

    expect(window.confirm).toHaveBeenCalled();
    expect(api.clearConversationMemories).toHaveBeenCalledTimes(1);
  });

  it("navigates back to onboarding for profile edits", async () => {
    const user = userEvent.setup();
    mockUseApi.mockReturnValue(makeApi());

    renderPage();
    await user.click(screen.getByRole("button", { name: /Onboarding Survey1 memory/i }));
    await user.click(screen.getByRole("button", { name: "Modify preference survey" }));

    expect(mockNavigate).toHaveBeenCalledWith("/onboarding", {
      state: { returnTo: "/memories" },
    });
  });
});
