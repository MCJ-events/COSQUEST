// TEST BUILDS ONLY (EXPO_PUBLIC_E2E=1, or a dev build): the Collection sheet
// (Relics and Forge) over a plain map backdrop, on either tab, for
// screenshots without a signed-in player.
//   cosquest://dev/collection-preview?tab=relics|forge
// Every other build sends this route home.
import { Redirect, useLocalSearchParams } from "expo-router";
import { View } from "react-native";

import CollectionSheet from "@/components/game/CollectionSheet";

const ON = process.env.EXPO_PUBLIC_E2E === "1" || __DEV__;

export default function CollectionPreview() {
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  if (!ON) return <Redirect href="/" />;
  return (
    <View style={{ flex: 1, backgroundColor: "#DCE8D2" }}>
      <CollectionSheet initial={tab === "forge" ? "forge" : "relics"} tabs={["relics", "forge"]} onClose={() => {}} />
    </View>
  );
}
