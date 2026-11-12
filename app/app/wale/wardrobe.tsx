// cosquest://wale/wardrobe   Wale's Wardrobe (Figma "Wardrobe mobile").
// Behind EXPO_PUBLIC_WALE_UI: off, this route goes home.
import { Redirect } from "expo-router";

import { WALE_UI } from "@/components/waleui/flag";
import WardrobeScreen from "@/components/waleui/WardrobeScreen";

export default function WaleWardrobe() {
  if (!WALE_UI) return <Redirect href="/" />;
  return <WardrobeScreen />;
}
