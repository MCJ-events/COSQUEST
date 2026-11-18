// TEST BUILDS ONLY (EXPO_PUBLIC_E2E=1, or a dev build): the Ranks sheet
// (faction entry test, rank gates, rank test, weapon ladder, season, event
// friends) on this device's own key, without the chat's sign-in, against
// whichever game server the build points at. For walkthrough recordings.
//   cosquest://dev/ranks-preview[?t=<anything>]  (a new t reloads the sheet)
//   cosquest://dev/ranks-preview?badges=1        build 21: the ten rank badges (I to X) first
// Every other build sends this route home.
import { useFonts } from "expo-font";
import { Redirect, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { LogBox, Pressable, Text, View } from "react-native";

import { GAME_FONTS } from "@/components/game/fonts";
import { GameSchemeProvider } from "@/components/game/look";
import ProgressionSheet from "@/components/game/ProgressionSheet";
import { RankBadge } from "@/components/game/RankBadge";
import { GF } from "@/components/game/theme";

const RANKS = ["Initiate", "Disciple", "Awakened", "Elite", "Champion", "Commander", "Sovereign", "Transcendent", "Omega", "Eternal"];
import { gameStore } from "@/features/game/runtime";

const ON = process.env.EXPO_PUBLIC_E2E === "1" || __DEV__;

export default function RanksPreview() {
  const [fontsReady, fontsError] = useFonts(GAME_FONTS);
  const [ready, setReady] = useState(false);
  const [round, setRound] = useState(0);
  const { t, badges } = useLocalSearchParams<{ t?: string; badges?: string }>();
  const [showBadges, setShowBadges] = useState(badges === "1");
  useEffect(() => {
    if (!ON) return;
    LogBox.ignoreAllLogs(true);
    // The player must exist on the game server before progression can join it.
    void gameStore
      .playOnThisPhone()
      .then(() => gameStore.refreshMe())
      .finally(() => setReady(true));
  }, []);
  if (!ON) return <Redirect href="/" />;
  if ((!fontsReady && !fontsError) || !ready) return <View style={{ flex: 1, backgroundColor: "#E9E2D2" }} />;
  if (showBadges)
    return (
      <Pressable style={{ flex: 1, backgroundColor: "#1E2A3A", paddingTop: 90, alignItems: "center" }} onPress={() => setShowBadges(false)} testID="dev-badges">
        <Text style={{ fontFamily: GF.display, fontSize: 24, color: "#FFF", marginBottom: 24 }}>Rank badges</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 18, paddingHorizontal: 16 }}>
          {RANKS.map((name, i) => (
            <View key={name} style={{ alignItems: "center", width: 96, gap: 6 }}>
              <RankBadge rank={i + 1} total={10} size={72} />
              <Text style={{ fontFamily: GF.body, fontSize: 13, color: "#FFF" }}>{name}</Text>
            </View>
          ))}
        </View>
        <Text style={{ fontFamily: GF.body, fontSize: 13, color: "rgba(255,255,255,0.6)", marginTop: 28 }}>Tap to open Ranks</Text>
      </Pressable>
    );
  return (
    <GameSchemeProvider>
      <View style={{ flex: 1, backgroundColor: "#E9E2D2" }}>
        {/* Closing reopens it, so a recording can start over without relaunching. */}
        <ProgressionSheet key={`${t ?? ""}-${round}`} onClose={() => setRound((r) => r + 1)} />
      </View>
    </GameSchemeProvider>
  );
}
