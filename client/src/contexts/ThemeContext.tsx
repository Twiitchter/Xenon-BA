import React, { createContext, useContext, useState, useEffect } from "react";

// ─── Types ──────────────────────────────────────────────────────────────

export type Theme =
  | "dark"
  | "light"
  | "high-contrast"
  | "colorblind-rg"
  | "colorblind-by";

export interface ThemeOption {
  id: Theme;
  label: string;
  description: string;
  /** Preview swatch colours */
  colors: { bg: string; accent: string; swatchBorder: string };
}

export const THEME_OPTIONS: ThemeOption[] = [
  {
    id: "dark",
    label: "Dark",
    description: "Default dark blue theme",
    colors: { bg: "#111b2b", accent: "#0ea5e9", swatchBorder: "#1e3050" },
  },
  {
    id: "light",
    label: "Light",
    description: "Light background theme",
    colors: { bg: "#f1f5f9", accent: "#0284c7", swatchBorder: "#e2e8f0" },
  },
  {
    id: "high-contrast",
    label: "High Contrast",
    description: "Maximum contrast for visual accessibility",
    colors: { bg: "#000000", accent: "#00e5ff", swatchBorder: "#555555" },
  },
  {
    id: "colorblind-rg",
    label: "Colour Blind: Red/Green",
    description:
      "Optimised for protanopia & deuteranopia – replaces red/green with amber/blue",
    colors: { bg: "#111b2b", accent: "#d97706", swatchBorder: "#1e3050" },
  },
  {
    id: "colorblind-by",
    label: "Colour Blind: Blue/Yellow",
    description: "Optimised for tritanopia – replaces blue accent with purple",
    colors: { bg: "#111b2b", accent: "#c084fc", swatchBorder: "#1e3050" },
  },
];

// ─── Context ────────────────────────────────────────────────────────────

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const STORAGE_KEY = "appTheme";

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as Theme | null;
    const initial: Theme =
      saved && THEME_OPTIONS.some((o) => o.id === saved) ? saved : "light";
    // Apply immediately so there is no flash of the wrong theme on load
    document.documentElement.setAttribute("data-theme", initial);
    return initial;
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a <ThemeProvider>");
  return ctx;
}
