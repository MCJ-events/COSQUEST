// Where the game points, and which game UI this build shows.
// Pure: no React Native imports (tested in features/game/__tests__).
//
// One place, like costquest-ios Net/CQConfig.swift: the map's ground and the
// API must come from the same server or the app draws one venue's world
// around another's points.

/** The live game (costquest-ios CQConfig.productionURLString). */
export const PRODUCTION_GAME_SERVER = "https://costquest.204.168.162.79.sslip.io";
/** Staging (costquest-ios scripts/demo-install.sh --staging). Test builds point here. */
export const STAGING_GAME_SERVER = "https://costquest-staging.204.168.162.79.sslip.io";

/**
 * The server for this build. `EXPO_PUBLIC_GAME_SERVER` is inlined by Metro at
 * bundle time: "staging", "production", or an https URL. Unset: production,
 * as on iOS. Anything that is not https is refused (falls back to production).
 */
export function resolveGameServer(raw: string | undefined | null): string {
  const value = (raw ?? "").trim();
  if (!value || value === "production") return PRODUCTION_GAME_SERVER;
  if (value === "staging") return STAGING_GAME_SERVER;
  if (/^https:\/\/[^\s/?#]+(\/[^\s?#]*)?$/i.test(value)) return value.replace(/\/+$/, "");
  return PRODUCTION_GAME_SERVER;
}

/** Anything but production wears a badge, so a test build is never mistaken for the game. */
export function isProductionServer(url: string): boolean {
  return url === PRODUCTION_GAME_SERVER;
}

/**
 * The game's UI on this build:
 *   native  the costquest-ios SwiftUI game embedded by the native module (iOS only)
 *   rn      the shared React Native game in components/game (Android, and iOS behind the flag)
 * `EXPO_PUBLIC_GAME_UI` overrides; otherwise iOS stays native until the RN
 * screens are checked on a Mac, and everything else is rn.
 */
export type GameUi = "native" | "rn";

export function resolveGameUi(os: string, raw: string | undefined | null): GameUi {
  const value = (raw ?? "").trim();
  if (value === "rn") return "rn";
  if (value === "native" && os === "ios") return "native";
  return os === "ios" ? "native" : "rn";
}

/**
 * Where the duel is drawn:
 *   rn      the TypeScript port of costquest-duel, drawn in 2D (features/game/duel)
 *   unity   the Unity Duel scene (needs the Unity export in the build; Android: unityLibrary)
 * Unity is used only when the build has it AND the flag asks for it.
 */
export type DuelRenderer = "rn" | "unity";

export function resolveDuelRenderer(raw: string | undefined | null, hasUnity: boolean): DuelRenderer {
  return (raw ?? "").trim() === "unity" && hasUnity ? "unity" : "rn";
}
