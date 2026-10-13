// First time in the game: a name (the chat's, by default), a faction, and
// why the game wants the location, asked with the reason in front of the
// player rather than by a bare system prompt. costquest-ios Roam/OnboardingView.swift.
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { gameStore, startLocation, useGame } from "@/features/game/runtime";

import { GameButton, GameTitle } from "./kit";
import { GF, GP, realmColor, realmIcon } from "./theme";

const BLURB: Record<string, string> = {
  anime: "Heart, hype and never giving up.",
  marvel: "Heroes with a quip for every fight.",
  dc: "Legends, myths and old stone.",
  movies: "Every street is a scene.",
  gaming: "Player one, ready up.",
};

export default function Onboarding({ suggestedName }: { suggestedName: string }) {
  const insets = useSafeAreaInsets();
  const { config, profile } = useGame();
  const [name, setName] = useState(profile?.handle || suggestedName || "");
  const [faction, setFaction] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const go = async () => {
    if (!faction) return;
    setBusy(true);
    setProblem(null);
    try {
      await gameStore.saveProfile(name.trim().slice(0, 24) || "Seeker");
      await startLocation(true);
      await gameStore.chooseFaction(faction);
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 16 }]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
        <GameTitle text="Choose your side" size={34} />
        <Text style={styles.lead}>Quest Points wake up in the streets around you. Walk to one, win its challenge, and take it for your faction.</Text>

        <Text style={styles.label}>Your name in the game</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          maxLength={24}
          placeholder="Seeker"
          placeholderTextColor="rgba(255,255,255,0.5)"
          style={styles.input}
          accessibilityLabel="Your name in the game"
        />

        <Text style={styles.label}>Your faction</Text>
        {(config?.factions ?? []).map((f) => {
          const on = faction === f.id;
          return (
            <Pressable
              key={f.id}
              onPress={() => setFaction(f.id)}
              style={[styles.faction, { borderColor: on ? "#FFF" : "transparent", backgroundColor: realmColor(f.id) }]}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${f.name}. ${BLURB[f.id] ?? ""}`}>
              <Ionicons name={realmIcon(f.id)} size={26} color="#FFF" />
              <View style={{ flex: 1 }}>
                <Text style={styles.factionName}>{f.name}</Text>
                <Text style={styles.factionBlurb}>{BLURB[f.id] ?? ""}</Text>
              </View>
              {on ? <Ionicons name="checkmark-circle" size={26} color="#FFF" /> : null}
            </Pressable>
          );
        })}

        <View style={styles.why}>
          <Ionicons name="location" size={20} color={GP.sun} />
          <Text style={styles.whyText}>The game uses your location while it is on screen, to place Quest Points around you and to tell when you reach one. It stops when you swipe back to your chats.</Text>
        </View>
        {problem ? <Text style={styles.problem}>{problem}</Text> : null}
        <GameButton title={busy ? "Entering…" : "Let's go"} disabled={!faction || busy} onPress={go} color={GP.sun} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, backgroundColor: GP.navy },
  content: { padding: 20, gap: 12 },
  lead: { fontFamily: GF.body, fontSize: 15, color: "rgba(255,255,255,0.85)" },
  label: { fontFamily: GF.display, fontSize: 13, letterSpacing: 1, color: GP.ice, marginTop: 6 },
  input: { height: 50, borderRadius: 14, paddingHorizontal: 14, backgroundColor: "rgba(255,255,255,0.12)", color: "#FFF", fontFamily: GF.bold, fontSize: 17 },
  faction: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 18, borderWidth: 3 },
  factionName: { fontFamily: GF.display, fontSize: 18, color: "#FFF" },
  factionBlurb: { fontFamily: GF.body, fontSize: 13, color: "rgba(255,255,255,0.9)" },
  why: { flexDirection: "row", gap: 10, padding: 12, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.08)" },
  whyText: { flex: 1, fontFamily: GF.regular, fontSize: 13, color: "rgba(255,255,255,0.85)" },
  problem: { fontFamily: GF.body, fontSize: 14, color: GP.sun },
});
