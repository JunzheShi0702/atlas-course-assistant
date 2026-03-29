import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAtomValue } from 'jotai';
import { currentUserAtom } from '@/store/atoms';
import { useAuth } from '@/hooks/useAuth';
import type { ProfileState } from '@/hooks/useAuth';

interface AuthGuardProps {
  children: React.ReactNode;
}

export default function AuthGuard({ children }: AuthGuardProps) {
  const currentUser = useAtomValue(currentUserAtom);
  const { checkAuth } = useAuth();
  const [profileState, setProfileState] = useState<ProfileState | null | 'checking'>('checking');

  useEffect(() => {
    checkAuth().then((result) => {
      setProfileState(result);
    });
  }, [checkAuth]);

  // Still checking session
  if (profileState === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="text-muted-foreground text-sm">Loading…</span>
      </div>
    );
  }

  // Not authenticated
  if (currentUser === null) {
    return <Navigate to="/login" replace />;
  }

  // Authenticated but no profile yet
  if (profileState === 'no_profile') {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}
