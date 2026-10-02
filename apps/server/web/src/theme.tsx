import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";

export type ColorTheme = "light" | "dark";

const THEME_STORAGE_KEY = "dsh.remote.theme";

interface ThemeContextValue {
  colorTheme: ColorTheme;
  toggleColorTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isColorTheme(value: string | null): value is ColorTheme {
  return value === "light" || value === "dark";
}

function savedColorTheme(): ColorTheme | null {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isColorTheme(value) ? value : null;
  } catch {
    return null;
  }
}

function systemColorTheme(): ColorTheme {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyColorTheme(colorTheme: ColorTheme) {
  document.documentElement.dataset.theme = colorTheme;
  document.documentElement.style.colorScheme = colorTheme;
}

function initialColorTheme(): ColorTheme {
  const colorTheme = savedColorTheme() ?? systemColorTheme();
  applyColorTheme(colorTheme);
  return colorTheme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [colorTheme, setColorTheme] = useState<ColorTheme>(initialColorTheme);

  useEffect(() => {
    applyColorTheme(colorTheme);
  }, [colorTheme]);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;
    const handleChange = (event: MediaQueryListEvent) => {
      if (!savedColorTheme()) setColorTheme(event.matches ? "dark" : "light");
    };
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      setColorTheme(isColorTheme(event.newValue) ? event.newValue : systemColorTheme());
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const toggleColorTheme = useCallback(() => {
    setColorTheme((current) => {
      const next = current === "light" ? "dark" : "light";
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // Theme switching still works when storage is unavailable.
      }
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ colorTheme, toggleColorTheme }),
    [colorTheme, toggleColorTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useColorTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useColorTheme must be used within ThemeProvider");
  return context;
}
