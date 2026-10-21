// A Room's door: what it is, how long it has, who is in, your side (preset
// to your Roam faction) and your name (your Roam handle), then Enter.
// costquest-ios UI/EntryView.swift as a Room uses it (presetSide,
// presetHandle): a Room is free, so there are no prize terms to read.
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { isTerminal, presetSide, timeLeft } from "@/features/game/rooms";
import type { RoomSession, RoomSessionState } from "@/features/game/roomsSession";
import { gameStore, useGame } from "@/features/game/runtime";

import { Chip, GameButton, GameTitle } from "./kit";
import { GF, GP } from "./theme";
import { themedStyles, useThemedStyles } from "@/constants/chatTheme";

export default function RoomLobby({ session, state, onClose }: { session: RoomSession; state: RoomSessionState; onClose: () => void }) {
  const styles = useThemedStyles(STYLE_PAIR);
  const insets = useSafeAreaInsets();
  const me = useGame((s) => s.me);
  const { terms, problem, joining } = state;
  const [side, setSide] = useState<string | null>(null);
  const [handle, setHandle] = useState(() => gameStore.playerName());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // The side is the player's Roam faction, matched by id or display name.
  const sides = terms?.factions ?? [];
  const preset = presetSide(sides, [me?.faction, me?.faction_name]);
  const chosen = side ?? preset;
  const ended = terms ? isTerminal(terms.status) : false;
  const coins = terms?.entry_coins ?? 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <View style={styles.top}>
        <Pressable onPress={onClose} style={styles.back} accessibilityRole="button" accessibilityLabel="Back to the map" hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color="#FFF" />
        </Pressable>
        <Text style={styles.kicker}>ROOM</Text>
      </View>
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
        {!terms ? (
          problem ? (
            <View style={styles.panel}>
              <Text style={styles.problemText}>{problem}</Text>
              <GameButton title="Try again" small color={GP.skyDeep} onPress={() => session.load()} />
            </View>
          ) : (
            <ActivityIndicator color="#FFF" style={{ marginTop: 60 }} />
          )
        ) : (
          <>
            <GameTitle text={terms.title} size={30} />
            <View style={styles.chips}>
              <Chip text={ended ? "Ended" : timeLeft(terms.ends_at, now)} color={ended ? GP.mist : GP.berry} />
              <Chip text={`${terms.players_joined ?? 0} in`} color={GP.skyDeep} />
              <Chip text={coins ? `${coins} CosCoins to enter` : "Free"} color={coins ? GP.sunDeep : GP.mint} />
            </View>

            {ended ? (
              <View style={styles.panel}>
                <Text style={styles.panelTitle}>This Room has ended.</Text>
                <GameButton title="Back to the map" color={GP.skyDeep} onPress={onClose} />
              </View>
            ) : (
              <>
                <View style={styles.panel}>
                  <Text style={styles.panelTitle}>How it plays</Text>
                  <Line icon="hammer" text="Walk to a weapon and pick it up. One at a time." />
                  <Line icon="locate" text="Point your phone at a rival and fire. Each hit takes tokens from them to you." />
                  <Line icon="flag" text="Take the shrines for your side. Open the chests for a question." />
                  <Line icon="time" text="Down at zero tokens: respawn after a short wait. Most tokens for your side when time runs out wins." />
                  <Text style={styles.small}>
                    On this phone the arena is drawn as a map, and distances come from GPS (about 5 m), as they do on an iPhone without ultra wideband. The server judges every hit,
                    pickup and capture.
                  </Text>
                </View>

                <View style={styles.panel}>
                  <Text style={styles.panelTitle}>Your side</Text>
                  <View style={styles.sides}>
                    {sides.map((f) => {
                      const on = chosen === f.name;
                      return (
                        <Pressable
                          key={f.name}
                          onPress={() => setSide(f.name)}
                          style={[styles.side, { borderColor: on ? f.color ?? GP.navy : "transparent", backgroundColor: on ? "#FFF" : GP.ice }]}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: on }}
                          accessibilityLabel={`${f.name}, ${f.players ?? 0} players`}>
                          <View style={[styles.swatch, { backgroundColor: f.color ?? GP.skyDeep }]} />
                          <Text style={styles.sideName}>{f.name}</Text>
                          <Text style={styles.small}>{f.players ?? 0}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Text style={styles.label}>Your name</Text>
                  <TextInput
                    value={handle}
                    onChangeText={setHandle}
                    maxLength={40}
                    autoCorrect={false}
                    style={styles.input}
                    accessibilityLabel="Your name in this Room"
                    placeholder="Your name"
                    placeholderTextColor="rgba(30,58,76,0.35)"
                  />
                </View>

                {problem ? (
                  <View style={styles.problem} accessibilityLiveRegion="polite">
                    <Ionicons name="warning" size={16} color="#FFF" />
                    <Text style={styles.problemBanner}>{problem}</Text>
                  </View>
                ) : null}

                <GameButton
                  title={joining ? "Joining…" : "Enter the battle"}
                  color={GP.mint}
                  disabled={joining || handle.trim().length < 2}
                  onPress={() => session.join(handle, chosen)}
                  icon={joining ? <ActivityIndicator color="#FFF" /> : <Ionicons name="flash" size={18} color="#FFF" />}
                />
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Line({ icon, text }: { icon: "hammer" | "locate" | "flag" | "time"; text: string }) {
  const styles = useThemedStyles(STYLE_PAIR);
  return (
    <View style={styles.line}>
      <Ionicons name={icon} size={18} color={GP.berry} />
      <Text style={styles.lineText}>{text}</Text>
    </View>
  );
}

const STYLE_PAIR = themedStyles({
  root: { ...StyleSheet.absoluteFill, backgroundColor: GP.berry },
  top: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingBottom: 8 },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(30,58,76,0.35)", alignItems: "center", justifyContent: "center" },
  kicker: { fontFamily: GF.display, fontSize: 13, letterSpacing: 1.3, color: "#FFF" },
  body: { padding: 16, gap: 14 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  panel: { padding: 16, gap: 10, borderRadius: 20, backgroundColor: GP.cream },
  panelTitle: { fontFamily: GF.display, fontSize: 20, color: GP.ink },
  line: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  lineText: { flex: 1, fontFamily: GF.body, fontSize: 14, color: GP.ink },
  small: { fontFamily: GF.regular, fontSize: 12, color: GP.mist },
  sides: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  side: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, height: 40, borderRadius: 20, borderWidth: 3 },
  swatch: { width: 16, height: 16, borderRadius: 8 },
  sideName: { fontFamily: GF.bold, fontSize: 14, color: GP.ink },
  label: { fontFamily: GF.bold, fontSize: 14, color: GP.ink, marginTop: 4 },
  input: { height: 48, paddingHorizontal: 14, paddingVertical: 0, textAlignVertical: "center", borderRadius: 14, borderWidth: 2, borderColor: "rgba(30,58,76,0.2)", backgroundColor: "#FFF", fontFamily: GF.bold, fontSize: 17, color: GP.ink },
  problemText: { fontFamily: GF.body, fontSize: 15, color: GP.ink },
  problem: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start", paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18, backgroundColor: GP.navy },
  problemBanner: { fontFamily: GF.bold, fontSize: 14, color: "#FFF", flexShrink: 1 },
});
