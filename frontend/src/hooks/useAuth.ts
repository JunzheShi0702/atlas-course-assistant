import { useCallback } from 'react';
import { useAtom } from 'jotai';
import { currentUserAtom, CurrentUser } from '../store/atoms';

const API_BASE = ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_URL ?? '').replace(/\/$/, '');

function apiUrl(path: string) {
  return API_BASE ? `${API_BASE}${path}` : path;
}

export type ProfileState = 'has_profile' | 'no_profile';

export function useAuth() {
  const [currentUser, setCurrentUser] = useAtom(currentUserAtom);

  /**
   * Check session and populate currentUserAtom.
   * Returns 'has_profile' | 'no_profile' if authenticated, null if not.
   */
  const checkAuth = useCallback(async (): Promise<ProfileState | null> => {
    try {
      const meRes = await fetch(apiUrl('/api/auth/me'), {
        credentials: 'include',
      });

      if (meRes.status === 401) {
        setCurrentUser(null);
        return null;
      }

      if (!meRes.ok) {
        setCurrentUser(null);
        return null;
      }

      const user = (await meRes.json()) as CurrentUser;
      setCurrentUser(user);

      const profileRes = await fetch(apiUrl('/api/user/profile'), {
        credentials: 'include',
      });

      if (profileRes.status === 404) return 'no_profile';
      if (profileRes.ok) return 'has_profile';

      return null;
    } catch {
      setCurrentUser(null);
      return null;
    }
  }, [setCurrentUser]);

  const login = useCallback(() => {
    window.location.href = apiUrl('/auth/google');
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch(apiUrl('/auth/logout'), {
        method: 'POST',
        credentials: 'include',
      });
    } finally {
      setCurrentUser(null);
      window.location.href = '/login';
    }
  }, [setCurrentUser]);

  return { currentUser, checkAuth, login, logout };
}
