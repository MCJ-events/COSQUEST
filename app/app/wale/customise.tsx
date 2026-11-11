// cosquest://wale/customise?tab=faces|hair|headwear|outfits   Wale's customiser tabs (Figma).
// Behind EXPO_PUBLIC_WALE_UI: off, this route goes home.
import { Redirect, useLocalSearchParams } from "expo-router";

import CustomiserScreen, { CUSTOM_TABS, type CustomTab } from "@/components/waleui/CustomiserScreen";
import { WALE_UI } from "@/components/waleui/flag";

export default function WaleCustomise() {
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  if (!WALE_UI) return <Redirect href="/" />;
  const initial = CUSTOM_TABS.includes(tab as CustomTab) ? (tab as CustomTab) : "faces";
  return <CustomiserScreen key={initial} initialTab={initial} />;
}
