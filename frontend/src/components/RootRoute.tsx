import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import LandingPage from "@/pages/LandingPage";
import { useAuth, type ProfileState } from "@/hooks/useAuth";

export default function RootRoute() {
  const { checkAuth } = useAuth();
  const [profileState, setProfileState] = useState<ProfileState | null | "checking">("checking");

  useEffect(() => {
    checkAuth().then((result) => {
      setProfileState(result);
    });
  }, [checkAuth]);

  if (profileState === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <span className="text-sm text-slate-500">Loading…</span>
      </div>
    );
  }

  if (profileState === "has_profile") {
    return <Navigate to="/schedules" replace />;
  }

  if (profileState === "no_profile") {
    return <Navigate to="/onboarding" replace />;
  }

  return <LandingPage />;
}
