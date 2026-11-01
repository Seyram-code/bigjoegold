"use client";

import { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark";
type ThemeContextValue = { theme: Theme; toggleTheme: () => void };

const ThemeContext = createContext<ThemeContextValue | null>(null);
const THEME_STORAGE_KEY = "big-joe-gold-theme";

export function ThemeProvider({ children, initialTheme = "light" }: { children: React.ReactNode; initialTheme?: Theme }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    let savedTheme: string | null = null;
    try {
      savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
      // Keep the default theme when browser storage is unavailable.
    }
    const restoredTheme = savedTheme === "dark" || savedTheme === "light" ? savedTheme : initialTheme;
    document.documentElement.dataset.theme = restoredTheme;
    setTheme(restoredTheme);
    setInitialized(true);
  }, [initialTheme]);

  useEffect(() => {
    if (!initialized) return;
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // The selected theme remains active for this page when storage is unavailable.
    }
    document.cookie = `${THEME_STORAGE_KEY}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }, [initialized, theme]);

  function toggleTheme() {
    setTheme((current) => current === "dark" ? "light" : "dark");
  }

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider.");
  return context;
}
