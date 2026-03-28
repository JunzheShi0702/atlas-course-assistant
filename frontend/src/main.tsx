import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App";
import SchedulesDashboard from "./pages/SchedulesDashboard";
import SchedulePage from "./pages/SchedulePage";
import LoginPage from "./pages/LoginPage";
import AuthGuard from "./components/AuthGuard";
import { ThemeProvider } from "./contexts/ThemeContext";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<AuthGuard><App /></AuthGuard>} />
          <Route path="/onboarding" element={<App />} />
          <Route path="/schedules" element={<AuthGuard><SchedulesDashboard /></AuthGuard>} />
          <Route path="/schedules/:id" element={<AuthGuard><SchedulePage /></AuthGuard>} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>
);
