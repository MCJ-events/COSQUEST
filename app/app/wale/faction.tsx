// cosquest://wale/faction   Pick the faction you play for (build 24; no Warden onboarding any more).
// Behind EXPO_PUBLIC_WALE_UI: off, this route goes home.
import { Redirect } from "expo-router";

import FactionScreen from "@/components/waleui/FactionScreen";
import { WALE_UI } from "@/components/waleui/flag";

export default function WaleFaction() {
  if (!WALE_UI) return <Redirect href="/" />;
  return <FactionScreen />;
}
