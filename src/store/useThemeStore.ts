import { create } from "zustand";
import { platform } from "@platform";
import { darken, lighten } from "../lib/color";

export type ThemePreference = "system" | "light" | "dark" | "omarchy";

const STORAGE_KEY = "chronos.theme";
const OMARCHY_POLL_MS = 5000;

const OMARCHY_VARS = [
  "--color-bg",
  "--color-surface",
  "--color-surface-hover",
  "--color-border",
  "--color-text",
  "--color-text-muted",
  "--color-accent",
  "--color-accent-hover",
  "--color-danger",
] as const;

type OmarchyColors = Record<string, string>;

async function fetchOmarchyTheme(): Promise<OmarchyColors | null> {
  const colors = await platform.omarchyTheme();
  return colors && colors.background && colors.foreground && colors.accent ? colors : null;
}

function applyOmarchyColors(colors: OmarchyColors) {
  const root = document.documentElement;
  const isDark = colors.mode !== "light";
  const bg = colors.background;
  const accent = colors.accent;

  root.style.setProperty("--color-bg", bg);
  root.style.setProperty("--color-surface", colors.lighter_background ?? (isDark ? lighten(bg, 0.08) : darken(bg, 0.04)));
  root.style.setProperty("--color-surface-hover", colors.selection ?? (isDark ? lighten(bg, 0.15) : darken(bg, 0.08)));
  root.style.setProperty("--color-border", colors.muted ?? colors.dark_foreground ?? colors.foreground);
  root.style.setProperty("--color-text", colors.foreground);
  root.style.setProperty("--color-text-muted", colors.dark_foreground ?? colors.muted ?? colors.foreground);
  root.style.setProperty("--color-accent", accent);
  root.style.setProperty("--color-accent-hover", isDark ? lighten(accent, 0.18) : darken(accent, 0.18));
  root.style.setProperty("--color-danger", colors.red ?? "#ef4444");
  root.setAttribute("data-theme", isDark ? "dark" : "light");
}

function clearOmarchyOverrides() {
  const root = document.documentElement;
  OMARCHY_VARS.forEach((v) => root.style.removeProperty(v));
}

function applyStaticTheme(theme: "system" | "light" | "dark") {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

function readInitialPreference(): ThemePreference | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system" || stored === "omarchy") return stored;
  } catch {
    // ignore
  }
  return null;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

function stopPolling() {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(async () => {
    const colors = await fetchOmarchyTheme();
    if (colors) applyOmarchyColors(colors);
  }, OMARCHY_POLL_MS);
}

interface ThemeState {
  theme: ThemePreference;
  omarchyAvailable: boolean;
  ready: boolean;
  setTheme: (theme: ThemePreference) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: "system",
  omarchyAvailable: false,
  ready: false,

  setTheme: (theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // ignore
    }
    if (theme === "omarchy") {
      fetchOmarchyTheme().then((colors) => colors && applyOmarchyColors(colors));
      startPolling();
    } else {
      stopPolling();
      clearOmarchyOverrides();
      applyStaticTheme(theme);
    }
    set({ theme });
  },
}));

(async function init() {
  const stored = readInitialPreference();
  const omarchyColors = await fetchOmarchyTheme();
  const omarchyAvailable = omarchyColors !== null;

  const initial: ThemePreference = stored ?? (omarchyAvailable ? "omarchy" : "system");

  if (initial === "omarchy" && omarchyColors) {
    applyOmarchyColors(omarchyColors);
    startPolling();
  } else {
    applyStaticTheme(initial === "omarchy" ? "system" : initial);
  }

  useThemeStore.setState({ theme: initial, omarchyAvailable, ready: true });
})();
