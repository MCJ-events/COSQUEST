// cosquest://wale/weapons   Wale's Armory (Figma "weapons"), with the real ladder.
// Behind EXPO_PUBLIC_WALE_UI: off, this route goes home.
import { Redirect } from "expo-router";

import { WALE_UI } from "@/components/waleui/flag";
import { WeaponsScreen } from "@/components/waleui/WeaponsScreen";

export default function WaleWeapons() {
  if (!WALE_UI) return <Redirect href="/" />;
  return <WeaponsScreen />;
}
