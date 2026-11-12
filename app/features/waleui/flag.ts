// One switch for every screen built from Wale's Figma file (11 Nov 2026):
// the hero homepage, Armory and weapon page, Wardrobe, the customiser tabs,
// the social lobby and his Settings sheet (app/app/wale/*).
//
// `EXPO_PUBLIC_WALE_UI=1` turns them on, `0` off. Unset follows the build: on
// in a dev build and in the test build (EXPO_PUBLIC_E2E=1), off everywhere
// else. scripts/cosquest-beta-env.sh sets it to 0, so a beta build behaves
// exactly as build 21 did. Same shape as arShrineDevFor (features/game/config.ts).
//
// Pure (tested in features/waleui/__tests__/flag.test.ts). Metro only inlines
// process.env.EXPO_PUBLIC_* when it is read by its literal name, so the read
// itself lives in components/waleui/flag.ts.
export function waleUiFor(flag: string | undefined | null, e2e: string | undefined | null, dev: boolean): boolean {
  const f = (flag ?? "").trim();
  if (f === "1") return true;
  if (f === "0") return false;
  return e2e === "1" || dev;
}
