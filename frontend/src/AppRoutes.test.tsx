import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import AppRoutes from "./AppRoutes";

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
  it("renders the root route on the landing path", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppRoutes />
      </MemoryRouter>,
    );

    expect(screen.getByText("Root Route")).toBeInTheDocument();
  });

  it("renders the not found page for unknown routes", () => {
    render(
      <MemoryRouter initialEntries={["/does-not-exist"]}>
        <AppRoutes />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to landing page" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Go to schedules" })).toHaveAttribute("href", "/schedules");
  });
});
