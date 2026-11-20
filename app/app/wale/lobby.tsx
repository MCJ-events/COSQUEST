// cosquest://wale/lobby   Wale's Social lobby (Figma "Social lobby · Mobile").
// Behind EXPO_PUBLIC_WALE_UI: off, this route goes home. The lobby itself is not built yet (a mock-up
// with "opens in a later build"), so a store build (no EXPO_PUBLIC_SHOW_PLACEHOLDERS) sends it home too.
import { Redirect } from "expo-router";

import { WALE_UI } from "@/components/waleui/flag";
import { appConfig } from "@/services/appConfig";
import LobbyScreen from "@/components/waleui/LobbyScreen";

export default function WaleLobby() {
  if (!WALE_UI || !appConfig.showPlaceholders) return <Redirect href="/" />;
  return <LobbyScreen />;
}
