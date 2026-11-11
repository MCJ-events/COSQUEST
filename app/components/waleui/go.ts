// Where the buttons on Wale's screens lead. A destination that exists in the
// app is used as it is; the ones that are sheets inside the game are asked
// for through features/waleui/intent.ts and the game is opened. A button with
// no destination yet (News) says so instead of doing nothing.
import { router } from "expo-router";
import { Alert, Platform } from "react-native";

import { sheetIntent, type WaleSheet } from "@/features/waleui/intent";
import { world } from "@/features/world/worldState";

/** Back to the tabs, where the game lives one swipe away (as app/play.tsx does). */
function toTabs() {
  if (router.canDismiss()) router.dismissAll();
  else router.replace("/home");
}

/** Open the game on one of its own sheets (Friends, Squad, Coins, Faction war, Ranks). */
export function openGameSheet(sheet: WaleSheet) {
  sheetIntent.request(sheet);
  world.openGame(null);
  toTabs();
}

export function openMap() {
  world.openGame(null);
  toTabs();
}

export function notBuiltYet(what: string) {
  const msg = `${what} is not in the app yet.`;
  if (Platform.OS === "web") console.log(`[wale-ui] ${msg}`);
  else Alert.alert(what, msg);
}

export function back(fallback: "/wale/home" | "/wale/wardrobe" | "/wale/weapons" = "/wale/home") {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
