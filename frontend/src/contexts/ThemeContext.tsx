import { createContext, useCallback, useContext, useEffect } from "react";

const STORAGE_KEY = "atlas-theme";

type Theme = "light";

function applyLightTheme() {
  const root = document.documentElement;
  root.classList.remove("dark");
  root.dataset.theme = "light";
  root.style.colorScheme = "light";
  localStorage.setItem(STORAGE_KEY, "light");
}

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    applyLightTheme();
  }, []);

  const setTheme = useCallback((next: Theme) => {
    if (next === "light") applyLightTheme();
  }, []);

  const toggleTheme = useCallback(() => {
    applyLightTheme();
  }, []);

  const value: ThemeContextValue = { theme: "light", setTheme, toggleTheme };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
