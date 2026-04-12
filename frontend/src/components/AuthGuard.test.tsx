import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { Provider, createStore } from "jotai";
import { currentUserAtom } from "@/store/atoms";
import AuthGuard from "./AuthGuard";

// Mock useAuth
const mockCheckAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ checkAuth: mockCheckAuth, login: vi.fn(), logout: vi.fn() }),
}));

beforeEach(() => {
  mockCheckAuth.mockReset();
});

function renderWithRouter(atomOverrides: { user: typeof currentUserAtom extends import('jotai').Atom<infer T> ? T : never }) {
  const store = createStore();
  store.set(currentUserAtom, atomOverrides.user);

  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/schedules']}>
        <Routes>
          <Route path="/" element={<div>Landing Page</div>} />
          <Route path="/onboarding" element={<div>Onboarding Page</div>} />
          <Route
            path="/schedules"
            element={
              <AuthGuard>
                <div>Protected Content</div>
              </AuthGuard>
            }
          />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
}

function renderProtectedRoute(path: "/schedules" | "/schedules/schedule-1", user: typeof currentUserAtom extends import("jotai").Atom<infer T> ? T : never) {
  const store = createStore();
  store.set(currentUserAtom, user);

  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<div>Landing Page</div>} />
          <Route path="/onboarding" element={<div>Onboarding Page</div>} />
          <Route
            path="/schedules"
            element={(
              <AuthGuard>
                <div>Schedules Dashboard</div>
              </AuthGuard>
            )}
          />
          <Route
            path="/schedules/:id"
            element={(
              <AuthGuard>
                <div>Schedule Detail</div>
              </AuthGuard>
            )}
          />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
}

describe('AuthGuard', () => {
  it('redirects to / when unauthenticated', async () => {
    mockCheckAuth.mockResolvedValue(null);
    renderWithRouter({ user: null });
    await waitFor(() => {
      expect(screen.getByText('Landing Page')).toBeInTheDocument();
    });
  });

  it('redirects to /onboarding when authenticated but no profile', async () => {
    mockCheckAuth.mockResolvedValue('no_profile');
    renderWithRouter({ user: { id: '1', email: 'a@jhu.edu', name: 'Test User' } });
    await waitFor(() => {
      expect(screen.getByText('Onboarding Page')).toBeInTheDocument();
    });
  });

  it('renders children when authenticated with profile', async () => {
    mockCheckAuth.mockResolvedValue('has_profile');
    renderWithRouter({ user: { id: '1', email: 'a@jhu.edu', name: 'Test User' } });
    await waitFor(() => {
      expect(screen.getByText('Protected Content')).toBeInTheDocument();
    });
  });

  it('shows a loading state while checking', () => {
    mockCheckAuth.mockReturnValue(new Promise(() => {})); // never resolves
    renderWithRouter({ user: null });
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("protects /schedules/:id and redirects unauthenticated users to /", async () => {
    mockCheckAuth.mockResolvedValue(null);
    renderProtectedRoute("/schedules/schedule-1", null);

    await waitFor(() => {
      expect(screen.getByText("Landing Page")).toBeInTheDocument();
    });
  });

  it("renders the protected schedule-detail route for authenticated users", async () => {
    mockCheckAuth.mockResolvedValue("has_profile");
    renderProtectedRoute("/schedules/schedule-1", {
      id: "1",
      email: "a@jhu.edu",
      name: "Test User",
    });

    await waitFor(() => {
      expect(screen.getByText("Schedule Detail")).toBeInTheDocument();
    });
  });
});
