import { Routes, Route } from "react-router-dom";
import App from "./App";
import SchedulesDashboard from "./pages/SchedulesDashboard";
import SchedulePage from "./pages/SchedulePage";
import MemoriesPage from "./pages/MemoriesPage";
import LoginPage from "./pages/LoginPage";
import AuthGuard from "./components/AuthGuard";
import RootRoute from "./components/RootRoute";

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<RootRoute />} />
      <Route path="/onboarding" element={<App />} />
      <Route
        path="/schedules"
        element={(
          <AuthGuard>
            <SchedulesDashboard />
          </AuthGuard>
        )}
      />
      <Route
        path="/schedules/:id"
        element={(
          <AuthGuard>
            <SchedulePage />
          </AuthGuard>
        )}
      />
      <Route
        path="/memories"
        element={(
          <AuthGuard>
            <MemoriesPage />
          </AuthGuard>
        )}
      />
    </Routes>
  );
}
