import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Provider } from 'jotai';
import LoginPage from './LoginPage';

const { mockLogin } = vi.hoisted(() => ({ mockLogin: vi.fn() }));

// Mock useAuth
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ login: mockLogin, logout: vi.fn(), checkAuth: vi.fn() }),
}));

beforeEach(() => {
  mockLogin.mockReset();
});

function renderLoginPage() {
  return render(
    <Provider>
      <LoginPage />
    </Provider>
  );
}

describe('LoginPage', () => {
  it('renders the Sign in with Google button', () => {
    renderLoginPage();
    expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument();
  });

  it('calls login() when the button is clicked', () => {
    renderLoginPage();
    fireEvent.click(screen.getByRole('button', { name: /sign in with google/i }));
    expect(mockLogin).toHaveBeenCalledTimes(1);
  });

  it('shows the Atlas branding', () => {
    renderLoginPage();
    expect(screen.getByText('Atlas')).toBeInTheDocument();
  });
});
