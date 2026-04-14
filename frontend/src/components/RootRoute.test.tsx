import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Provider } from "jotai";
import RootRoute from "./RootRoute";

const { mockCheckAuth } = vi.hoisted(() => ({
  mockCheckAuth: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    checkAuth: mockCheckAuth,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock("@/pages/LandingPage", () => ({
  default: () => <div>Atlas Landing</div>,
}));

beforeEach(() => {
  mockCheckAuth.mockReset();
});

function renderRootRoute() {
  return render(
    <Provider>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<RootRoute />} />
          <Route path="/onboarding" element={<div>Onboarding Page</div>} />
          <Route path="/schedules" element={<div>Schedules Dashboard</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
}

describe("RootRoute", () => {
  it("shows the public landing page for unauthenticated visitors", async () => {
    mockCheckAuth.mockResolvedValue(null);
    renderRootRoute();

    await waitFor(() => {
      expect(screen.getByText("Atlas Landing")).toBeInTheDocument();
    });
  });

  it("redirects authenticated users at / to /schedules", async () => {
    mockCheckAuth.mockResolvedValue("has_profile");
    renderRootRoute();

    await waitFor(() => {
      expect(screen.getByText("Schedules Dashboard")).toBeInTheDocument();
    });
  });

  it("redirects authenticated users without a profile to /onboarding", async () => {
    mockCheckAuth.mockResolvedValue("no_profile");
    renderRootRoute();

    await waitFor(() => {
      expect(screen.getByText("Onboarding Page")).toBeInTheDocument();
    });
  });
});
