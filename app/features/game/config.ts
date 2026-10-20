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
 *   rn      the shared React Native game in components/game: Android, and iOS
 *           by default since the one-codebase work (docs/one-codebase.md)
 *   native  the costquest-ios SwiftUI game embedded by the native module.
 *           iOS only, kept compiling as the fallback: EXPO_PUBLIC_GAME_UI=native
 * Anything else (unset, a typo) is rn; Android is always rn.
 */
export type GameUi = "native" | "rn";

export function resolveGameUi(os: string, raw: string | undefined | null): GameUi {
  const value = (raw ?? "").trim();
  if (value === "native" && os === "ios") return "native";
  return "rn";
}

/**
 * The game's screens, one id each, for the parity table (docs/one-codebase.md)
 * and the per-screen native fallback below. The shared RN game draws all of
 * them; a few are drawn by a thin native view inside the RN screen where only
 * the platform can draw them (3D model, AR, Unity), see NATIVE_ISLANDS.
 */
export const GAME_SCREENS = [
  "map",
  "hud",
  "pointSheet",
  "encounter",
  "duel",
  "reward",
  "onboarding",
  "journal",
  "warden",
  "raids",
  "live",
  "steps",
  "relics",
  "forge",
  "friends",
  "rooms",
  "more",
] as const;
export type GameScreen = (typeof GAME_SCREENS)[number];

/**
 * Native views the shared RN screens embed on iOS (ios/Embed/NativeIslands.swift,
 * VenueEventsIsland.swift),
 * each with a 2D fallback the same screen draws when the island is off or absent:
 *   forgeModel  the Forge weapon's turning 3D model (RealityKit + GLBMesh)   -> 2D art
 *   unityDuel   the Guardian Duel drawn by Unity (DuelBridge)                -> 2D arena (same sim)
 *   venueEvents the paid venue games in AR (ARKit, VenueEventsIsland.swift)  -> no Events tile
 */
export const NATIVE_ISLANDS = ["forgeModel", "unityDuel", "unityBattle", "venueEvents"] as const;
export type NativeIsland = (typeof NATIVE_ISLANDS)[number];

/**
 * Which islands this build turns OFF: `EXPO_PUBLIC_GAME_2D=forgeModel,unityDuel`
 * (or `all`) draws those parts in 2D even where the native view exists, as a
 * fallback if one misbehaves on a phone. Unknown names are ignored.
 */
export function resolveIslandsOff(raw: string | undefined | null): ReadonlySet<NativeIsland> {
  const names = (raw ?? "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
  if (names.includes("all")) return new Set(NATIVE_ISLANDS);
  return new Set(NATIVE_ISLANDS.filter((n) => names.includes(n)));
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
