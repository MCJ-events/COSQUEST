// cosquest://wale/weapon?id=<ladder weapon id>   Wale's weapon page (Figma "Speedshot mobile detail").
// Behind EXPO_PUBLIC_WALE_UI: off, this route goes home.
import { Redirect, useLocalSearchParams } from "expo-router";

import { WALE_UI } from "@/components/waleui/flag";
import { WeaponDetailScreen } from "@/components/waleui/WeaponsScreen";

export default function WaleWeapon() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  if (!WALE_UI) return <Redirect href="/" />;
  return <WeaponDetailScreen id={id ?? null} />;
}
