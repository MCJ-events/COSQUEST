// cosquest://wale/character   Pick the character you are (build 29). Behind EXPO_PUBLIC_WALE_UI: off, this route goes home.
import { Redirect } from "expo-router";

import CharacterScreen from "@/components/waleui/CharacterScreen";
import { WALE_UI } from "@/components/waleui/flag";

export default function WaleCharacter() {
  if (!WALE_UI) return <Redirect href="/" />;
  return <CharacterScreen />;
}
