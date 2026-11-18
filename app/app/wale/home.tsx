// cosquest://wale/home[?menu=1]   Wale's Homepage (Figma, 11 Nov 2026).
// Behind EXPO_PUBLIC_WALE_UI (features/waleui/flag.ts): off, this route goes home.
import { Redirect, useLocalSearchParams } from "expo-router";

import { WALE_UI } from "@/components/waleui/flag";
import HomeScreen from "@/components/waleui/HomeScreen";

export default function WaleHome() {
  const { menu } = useLocalSearchParams<{ menu?: string }>();
  if (!WALE_UI) return <Redirect href="/" />;
  // keyed, so a link to the same route with the other menu state opens it that way
  return <HomeScreen key={menu === "1" ? "open" : "closed"} menuOpen={menu === "1"} />;
}
