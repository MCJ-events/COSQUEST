// ==========================================
// CHAT DARK MODE (Figma M06 · Option D · Dark mode)
// ==========================================
// The chat screens follow the phone's appearance (or the Appearance
// setting when it's set to Light or Dark).
//
// Instead of writing every chat style twice, each stylesheet is written
// once in light colours and `themedStyles` builds the dark copy from it by
// mapping each colour by its role:
//   text colours      dark ink -> near-white, greys -> lighter greys
//   surfaces/borders  white and pale tints -> deep navy surfaces (hue kept)
//   accents           the pinks and teal stay, slightly lifted
// Both copies are built once, when the file loads, so switching costs
// nothing at render time.
import { useMemo } from "react";
import { StyleSheet, useColorScheme } from "react-native";

import { useAppSelector } from "@/store/hooks";
import { darkSurface, darkText, mapStyle } from "@/theme/dark";
import { C } from "@/theme/tokens";

export type ChatScheme = "light" | "dark";

// The chat background in dark mode (M06): a deep navy.
export const DARK_CHAT_BG = "#171823";
export const DARK_CHAT_BG_2 = "#1D1F2C";

export function useChatScheme(): ChatScheme {
  const system = useColorScheme();
  const mode = useAppSelector(
    (state) =>
      (state.settings as any)?.appearance?.themeMode ??
      (state.auth.user as any)?.appearance?.themeMode,
  ) as string | undefined;

  if (mode === "light" || mode === "dark") {
    return mode;
  }

  return system === "dark" ? "dark" : "light";
}

// The colour maths lives in theme/dark.ts (shared with the game).
export { darkSurface, darkText };

// Build both stylesheets once. `overrides` patches the dark copy where the
// automatic mapping isn't right.
export function themedStyles<T extends StyleSheet.NamedStyles<T>>(
  light: T,
  overrides: Partial<{ [K in keyof T]: Record<string, any> }> = {},
): { light: T; dark: T } {
  const dark: Record<string, any> = {};
  for (const [name, style] of Object.entries(light)) {
    dark[name] = { ...mapStyle(style as any), ...((overrides as any)[name] || {}) };
  }
  return {
    light: StyleSheet.create(light),
    dark: StyleSheet.create(dark as T),
  };
}

export function useThemedStyles<T>(pair: { light: T; dark: T }): T {
  return useChatScheme() === "dark" ? pair.dark : pair.light;
}

// For colours passed straight to icons and inputs (not in a stylesheet).
export function useInk() {
  const dark = useChatScheme() === "dark";
  return useMemo(
    () => ({
      dark,
      text: (color: string) => (dark ? darkText(color) : color),
      surface: (color: string) => (dark ? darkSurface(color) : color),
    }),
    [dark],
  );
}

// The pale sheet / screen gradient used by the chat's full-screen pickers,
// and its dark twin.
export const LIGHT_SCREEN_GRADIENT = [C.skyPale, C.skyPale2] as const;
export const DARK_SCREEN_GRADIENT = [DARK_CHAT_BG_2, DARK_CHAT_BG] as const;
