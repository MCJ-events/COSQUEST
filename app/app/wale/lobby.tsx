// cosquest://wale/lobby   Wale's Social lobby (Figma "Social lobby · Mobile").
// Behind EXPO_PUBLIC_WALE_UI: off, this route goes home.
import { Redirect } from "expo-router";

import { WALE_UI } from "@/components/waleui/flag";
import LobbyScreen from "@/components/waleui/LobbyScreen";

export default function WaleLobby() {
  if (!WALE_UI) return <Redirect href="/" />;
  return <LobbyScreen />;
}
