# wale-fit-27: merge notes for build 27

Branch `wale-fit-27` from `build-26` (b8556b3). App only: no Godot, backend or native change, no new package.
Fixes two things Wale reported from build 26 on a real iPhone, plus demo quest wording.

## What changed

1. **Home fits the phone** (Wale: "this circled part is a lot of space in the app on iPhone, it does not fit the screen").
   - `components/waleui/kit.tsx`: `DesignCanvas` takes `fit="tabs" | "screen"`. A fitted canvas is as tall as the
     room between the status bar and the top of the floating tab bar ("tabs") or the home bar inset ("screen").
     The frame keeps the phone's width; the spare height is handed to the screen as extra frame px
     (`useCanvasExtra()`). On a phone too short for the frame at full width it is scaled to the height and centred
     instead, so nothing is cut off or has to scroll. The gradient runs edge to edge behind the bars. Without `fit`
     the canvas is exactly the build 26 scrolling canvas (`ScrollingCanvas`, unchanged code).
   - `features/waleui/fit.ts` (pure, tested): `fitFrame` and `homeStretch`.
   - `components/waleui/HomeScreen.tsx`: the spare height goes to the middle of his frame. Header, the left column,
     the rank badge and the menu stay where he put them; ENTER QUEST keeps his 13 px above the tab bar; the hero
     and the street web grow with the room (the hero never wider than the gap beside the right-hand panel) and the
     right-hand panel (WEAPON / WARDROBE / SHOP / map / OPEN MAP) moves with the hero's body. At his frame's size
     (403 x 575) every block is exactly where it was, so the build 23 placement measurements still hold.
   - `app/(tabs)/home.tsx`: the Home tab passes `inTabs`; `/wale/home` fills to the home bar.
2. **Cosquest tab icon** (Wale: "the original icon is supposed to be placed here"). Wale's Figma has no bottom tab
   bar and no tab bar icons (his four glyphs are the customiser's Faces / Hair / Headwear / Outfits tabs, already in
   use). The generic map pin is replaced by CosQuest's own Q pin, the team's art already in the app
   (`assets/images/dashboard/cosquest home pin icon.png` when the tab is open, `cosquest card pin icon - grey.png`
   when not), 20 x 27 pt in the icon slot. Live, Community and Profile are unchanged.
3. **Demo quests** (`constants/sampleQuests.ts`): "Anime Realm Showdown" is now "Ascendants Realm Showdown" and
   "Marvel Trivia Night" is "CosQuest Lore Trivia Night". A test fails if any demo title names Marvel, DC, anime or
   another franchise. (The onboarding interest called "anime" in `constants/interests.ts` was left alone: outside
   this brief.)

## Other Wale screens

Checked at iPhone SE, 15, 15 Pro Max and a 360 x 640 Android (sheets and numbers in
`cosquest-review/realism-20261111/experiments/wale-fit-27/`). None leaves an empty band: every other frame is taller
than these phones. But his Pro Max sized frames had the opposite fault: their bottom bar sat 93 pt (iPhone 15) to
166 pt (SE) below the fold. `DesignCanvas footer` now keeps that bar on screen above the home bar and the rest scrolls
above it: customiser DONE bar (`footer.y` 876, outfits 1386), weapon page action band and path line (809), lobby tabs
and chat bar (798), Faction pick button and notice (760, 120 tall). Settings, Armory and Wardrobe are long lists and
scroll as before. Trivia is a flowing layout and fits.

Measured: at each frame's own size the build 23 shooter finds 376 elements at 0.00 px from build 26 (the 572 px
"menu open" frame moves up to 3.0 px: it is 3 px shorter than the canvas, so the fitted canvas scales it by 0.995).
ENTER QUEST to the tab bar: build 26 135 pt on an iPhone 15, 163 pt on a Pro Max, and 10 pt under the tab bar on an
Android with a 3-button bar; this branch his 13 px on every phone.

Tooling note: the pinned bars have their own testID (`wale-custom-pinned`, `wale-weapon-pinned`, `wale-lobby-pinned`,
`wale-faction-pinned`). The simulator stitcher (experiments/build23-ui/tools/cap.py) will now see the bar at the
bottom of every scroll step; measure the bar from the first step only.

## Merge

- Commits: d5c39b3 demo quests, 4203dbc fit and pinned bars, 90a8305 Cosquest tab icon, then these notes.
- Files: `components/waleui/{kit,HomeScreen,CustomiserScreen,WeaponsScreen,LobbyScreen,FactionScreen}.tsx`,
  `features/waleui/fit.ts` (+ test), `app/(tabs)/home.tsx`, `app/(tabs)/_layout.tsx`, `constants/sampleQuests.ts`.
  The four screens only moved their bottom bar's JSX into a `footer` constant (no values changed). If another branch also changed HomeScreen, keep its blocks and move every block of the
  right-hand panel by `dy`, ENTER QUEST to `fit.questY`, and the hero / web to `fit.hero` / `fit.web`.
- Checks on this branch: `npx tsc --noEmit` clean, `npm test` 1148 of 1148 (8 new in
  `features/waleui/__tests__/fit.test.ts`).
- Not built, not uploaded. Before the archive: look at Home on a real phone with a faction set (the shots here are
  the Expo web build with the phone's insets, signed out, so the hero is Wale's own character; a faction hero is
  narrower and grows taller, up to the full room).
