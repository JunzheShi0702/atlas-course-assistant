import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { Provider, createStore } from 'jotai';
import { currentUserAtom } from '@/store/atoms';
import AuthGuard from './AuthGuard';

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
          <Route path="/login" element={<div>Login Page</div>} />
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

describe('AuthGuard', () => {
  it('redirects to /login when unauthenticated', async () => {
    mockCheckAuth.mockResolvedValue(null);
    renderWithRouter({ user: null });
    await waitFor(() => {
      expect(screen.getByText('Login Page')).toBeInTheDocument();
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
});
