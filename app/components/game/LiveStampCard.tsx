// The stamp card in the journal's dailies: the streak for people with lives.
// Every day played lays one stamp (the server lays it with the day's first
// answer, right or wrong); a full card pays, whenever that is, and never
// expires. Read from GET v1/roam/me (me.features.live), which the store
// refreshes with every verdict, so a new stamp shows as soon as it is laid.
// costquest-ios Features/LiveFeature.swift (StampCard, LiveStamp).
//
// Always drawn, as on iOS: 0 of 7 when the server says nothing about stamps,
// a "Loading stamps" placeholder until the first read, and "Couldn't load your
// stamps." with Retry when that read failed.
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { stampRow, stampsFrom } from "@/features/game/live";
import { gameStore } from "@/features/game/runtime";
import type { RoamMe } from "@/features/game/wire";

import { Chip, GameButton, MAX_FONT_SCALE, withAlpha } from "./kit";
import { GF, GP } from "./theme";
import { themedStyles, useThemedStyles } from "@/constants/chatTheme";

const NO_STAMPS = { stamps: 0, cards_done: 0, card_size: 7 };

export default function LiveStampCard({ me }: { me: RoamMe | null }) {
  const styles = useThemedStyles(STYLE_PAIR);
  const stamps = me ? (stampsFrom(me) ?? NO_STAMPS) : null;
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const loaded = me !== null;

  // Nothing read yet: read it, and say so when that fails (the store keeps quiet about it).
  useEffect(() => {
    if (loaded) return;
    let live = true;
    void gameStore.refreshMe().then(() => {
      if (live) setFailed(gameStore.get().me === null);
    });
    return () => {
      live = false;
    };
  }, [loaded, attempt]);

  const showFailed = failed && !loaded;
  const { size, have } = stampRow(stamps ?? NO_STAMPS);
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Stamp card
        </Text>
        {stamps && stamps.cards_done > 0 ? <Chip text={stamps.cards_done === 1 ? "1 card done" : `${stamps.cards_done} cards done`} color={GP.mint} /> : null}
      </View>
      {showFailed ? (
        <View style={styles.fail}>
          <Text style={styles.failText}>Couldn&apos;t load your stamps.</Text>
          <GameButton
            title="Try again"
            size="small"
            color={GP.sky}
            onPress={() => {
              setFailed(false);
              setAttempt((n) => n + 1);
            }}
          />
        </View>
      ) : (
        <View style={styles.row} accessible accessibilityLabel={stamps ? `${have} of ${size} stamps collected` : "Loading stamps"}>
          {Array.from({ length: size }, (_, i) => (
            <Stamp key={i} filled={i < have} n={i + 1} placeholder={!stamps} />
          ))}
        </View>
      )}
      <Text style={styles.note} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        Play any day to stamp it. 7 stamps = 300 XP
      </Text>
    </View>
  );
}

function Stamp({ filled, n, placeholder }: { filled: boolean; n: number; placeholder: boolean }) {
  const styles = useThemedStyles(STYLE_PAIR);
  if (placeholder) {
    // `.redacted(reason: .placeholder)`: grey discs where the stamps will be.
    return (
      <View style={styles.slot}>
        <View style={styles.redacted} />
      </View>
    );
  }
  return (
    <View style={styles.slot}>
      {filled ? (
        <View style={styles.filledEdge}>
          <View style={styles.filled}>
            <MaterialCommunityIcons name="seal" size={22} color={GP.sunDeep} />
          </View>
        </View>
      ) : (
        <View style={styles.empty}>
          <Text style={styles.number} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {n}
          </Text>
        </View>
      )}
    </View>
  );
}

const STYLE_PAIR = themedStyles({
  card: { gap: 12, padding: 14, borderRadius: 18, backgroundColor: "#FFF" },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  title: { fontFamily: GF.display, fontSize: 24, color: GP.ink },
  row: { flexDirection: "row", gap: 6 },
  fail: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  failText: { flex: 1, fontFamily: GF.body, fontSize: 14, color: withAlpha(GP.ink, 0.7) },
  slot: { flex: 1, alignItems: "center" },
  redacted: { width: "100%", maxWidth: 44, aspectRatio: 1, borderRadius: 22, backgroundColor: withAlpha(GP.ink, 0.12) },
  filledEdge: { width: "100%", maxWidth: 44, aspectRatio: 1, borderRadius: 22, backgroundColor: GP.sunDeep, paddingBottom: 3 },
  filled: {
    flex: 1,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.7)",
    backgroundColor: GP.sun,
    alignItems: "center",
    justifyContent: "center",
  },
  empty: {
    width: "100%",
    maxWidth: 44,
    aspectRatio: 1,
    borderRadius: 22,
    borderWidth: 2.5,
    borderStyle: "dashed",
    borderColor: withAlpha(GP.ink, 0.25),
    alignItems: "center",
    justifyContent: "center",
  },
  number: { fontFamily: GF.display, fontSize: 16, color: withAlpha(GP.ink, 0.35) },
  note: { fontFamily: GF.body, fontSize: 14, color: withAlpha(GP.ink, 0.7) },
});
