// Theme handling for a class-driven dark mode: "system" follows the OS and
// keeps following it, so a laptop that flips at sunset flips the UI too.

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "tools-ui-theme";
const DARK = "(prefers-color-scheme: dark)";

export function readTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

export function applyTheme(theme: Theme): void {
  const dark = theme === "dark" || (theme === "system" && matchMedia(DARK).matches);
  document.documentElement.classList.toggle("dark", dark);

  if (theme === "system") {
    localStorage.removeItem(STORAGE_KEY);
  } else {
    localStorage.setItem(STORAGE_KEY, theme);
  }
}

/** Re-applies on OS changes while the theme is "system". Returns an unsubscribe. */
export function watchSystemTheme(getTheme: () => Theme): () => void {
  const media = matchMedia(DARK);
  const onChange = (): void => {
    if (getTheme() === "system") applyTheme("system");
  };
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
