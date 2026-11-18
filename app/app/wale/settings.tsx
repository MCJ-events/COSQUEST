// cosquest://wale/settings   Wale's Settings (Figma "CosQuest · Settings mobile").
// Behind EXPO_PUBLIC_WALE_UI: off, this route goes home.
import { Redirect } from "expo-router";

import { WALE_UI } from "@/components/waleui/flag";
import SettingsScreen from "@/components/waleui/SettingsScreen";

export default function WaleSettings() {
  if (!WALE_UI) return <Redirect href="/" />;
  return <SettingsScreen />;
}
