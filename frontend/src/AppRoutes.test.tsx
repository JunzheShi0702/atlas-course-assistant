import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { Provider, createStore } from "jotai";
import AppRoutes from "./AppRoutes";
import { currentUserAtom } from "@/store/atoms";

vi.mock("./App", () => ({
  default: () => <div>Onboarding App</div>,
}));

vi.mock("./components/RootRoute", () => ({
  default: () => <div>Root Route</div>,
}));

vi.mock("./components/AuthGuard", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("./pages/SchedulesDashboard", () => ({
  default: () => <div>Schedules Dashboard</div>,
}));

vi.mock("./pages/SchedulePage", () => ({
  default: () => <div>Schedule Page</div>,
}));

vi.mock("./pages/MemoriesPage", () => ({
  default: () => <div>Memories Page</div>,
}));

describe("AppRoutes", () => {
  function renderRoutes(path: string, user: typeof currentUserAtom extends import("jotai").Atom<infer T> ? T : never = null) {
    const store = createStore();
    store.set(currentUserAtom, user);

    return render(
      <Provider store={store}>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
        </MemoryRouter>
      </Provider>,
    );
  }

  it("renders the root route on the landing path", () => {
    renderRoutes("/");

    expect(screen.getByText("Root Route")).toBeInTheDocument();
  });

  it("renders the not found page with a shared Atlas link for logged-out users", () => {
    renderRoutes("/does-not-exist", null);

    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Atlas" })).toHaveAttribute("href", "/");
  });

  it("renders the not found page with the same Atlas link for logged-in users", () => {
    renderRoutes("/does-not-exist", { id: "user-1", email: "user@jhu.edu", name: "Test User" });

    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Atlas" })).toHaveAttribute("href", "/");
  });
});
