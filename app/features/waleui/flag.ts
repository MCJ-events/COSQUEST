// One switch for every screen built from Wale's Figma file (11 Nov 2026):
// the hero homepage, Armory and weapon page, Wardrobe, the customiser tabs,
// the social lobby and his Settings sheet (app/app/wale/*).
//
// From build 23 (12 Nov 2026) Wale's screens are the app's look: the flag is
// ON unless it is set to `0`. `EXPO_PUBLIC_WALE_UI=0` builds the app as build
// 22 was (the team's Home dashboard, the old trivia, no /wale routes).
// app.config.js, eas.json and scripts/cosquest-beta-env.sh all set it to 1.
//
// Pure (tested in features/waleui/__tests__/waleui.test.ts). Metro only inlines
// process.env.EXPO_PUBLIC_* when it is read by its literal name, so the read
// itself lives in components/waleui/flag.ts.
export function waleUiFor(flag: string | undefined | null, _e2e?: string | undefined | null, _dev?: boolean): boolean {
  return (flag ?? "").trim() !== "0";
}
