// Guardian Trials (costquest-ios Features/DuelFeature.swift TrialsSheet):
// five ladders of faction bosses, playable anywhere. Each rung pays the first
// time it is cleared; a cleared rung can be replayed.
import { Ionicons } from "@expo/vector-icons";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { type TrialRequest, trialsOrder } from "@/features/game/duelFlow";
import { gameStore, useGame } from "@/features/game/runtime";
import type { TrialLadder } from "@/features/game/wire";

import { GameButton, MAX_FONT_SCALE, withAlpha } from "./kit";
import { SheetHost } from "./Sheet";
import { SheetFrame } from "./SheetFrame";
import { SheetHeader } from "./SheetHeader";
import { GF, GP, realmColor, realmIcon } from "./theme";

/** A tile of the track the pips sit on (GamePalette.track). */
const TRACK = "rgba(31,59,77,0.12)";

export default function TrialsSheet({ onClose, onFight }: { onClose: () => void; onFight: (t: TrialRequest) => void }) {
  const insets = useSafeAreaInsets();
  return (
    <SheetHost band={{ top: insets.top + 40, height: 90 }} scrimLabel="Close Guardian Trials" onClose={onClose}>
      {(close) => <TrialsBody close={close} onFight={onFight} />}
    </SheetHost>
  );
}

function TrialsBody({ close, onFight }: { close: () => void; onFight: (t: TrialRequest) => void }) {
  const insets = useSafeAreaInsets();
  const me = useGame((s) => s.me);
  const config = useGame((s) => s.config);
  const trials = me?.features?.duel?.trials ?? {};
  const order = trialsOrder(trials, (config?.factions ?? []).map((f) => f.id));
  // After the sheet has gone, so the fight is not drawn under it.
  const fight = (t: TrialRequest) => {
    close();
    setTimeout(() => onFight(t), 350);
  };
  return (
    <SheetFrame top={insets.top + 40}>
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false}>
        <SheetHeader title="Guardian Trials" onClose={close} />
        <Text style={styles.lead} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {"Beat each faction's Guardians in a real fight, one rung at a time. Each rung pays the first time you clear it."}
        </Text>
        {order.length === 0 ? (
          <Text style={styles.closed} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {"The Trials aren't open on this server yet."}
          </Text>
        ) : null}
        {order.map((f) => (
          <Ladder key={f} faction={f} ladder={trials[f]} onFight={fight} />
        ))}
      </ScrollView>
    </SheetFrame>
  );
}

function Ladder({ faction, ladder: t, onFight }: { faction: string; ladder: TrialLadder; onFight: (t: TrialRequest) => void }) {
  const tint = realmColor(faction);
  const name = gameStore.factionName(faction);
  const rungs = Math.max(1, t.rungs);
  return (
    <View style={styles.cardWrap}>
      <View style={styles.cardEdge} />
      <View style={styles.card}>
        <View style={styles.head} accessible accessibilityLabel={`${name}, ${t.cleared} of ${t.rungs} cleared`}>
          <View style={[styles.badge, { backgroundColor: tint }]}>
            <Ionicons name={realmIcon(faction)} size={16} color="#FFF" />
          </View>
          <View style={{ flex: 1, gap: 1 }}>
            <Text style={styles.name} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {name}
            </Text>
            <Text style={styles.count} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {`${t.cleared} of ${t.rungs} cleared`.toUpperCase()}
            </Text>
          </View>
        </View>
        {/* One pip per rung: the ladder at a glance. */}
        <View style={styles.pips} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          {Array.from({ length: rungs }, (_, i) => (
            <View key={i} style={[styles.pip, { backgroundColor: i + 1 <= t.cleared ? tint : TRACK }]} />
          ))}
        </View>
        <View style={styles.foot}>
          {t.next ? (
            <>
              <View style={{ flex: 1, gap: 1 }} accessible accessibilityLabel={`Next, rung ${t.next.rung}: ${t.next.name}, level ${t.next.level}`}>
                <Text style={styles.nextKicker}>{`NEXT · RUNG ${t.next.rung}`}</Text>
                <Text style={styles.nextName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                  {t.next.name}
                </Text>
                <Text style={styles.nextLevel}>Level {t.next.level}</Text>
              </View>
              {t.cleared > 0 ? (
                <GameButton title="Replay" size="small" color={GP.skyDeep} onPress={() => onFight({ faction, rung: t.cleared })} accessibilityLabel={`Replay rung ${t.cleared}`} />
              ) : null}
              <GameButton title="Fight" size="small" color={tint} onPress={() => onFight({ faction, rung: null })} accessibilityLabel={`Fight ${t.next.name}`} />
            </>
          ) : (
            <>
              <Text style={[styles.nextName, { flex: 1 }]}>Every Guardian beaten.</Text>
              <GameButton title="Replay" size="small" color={GP.skyDeep} onPress={() => onFight({ faction, rung: t.rungs })} accessibilityLabel={`Replay rung ${t.rungs}`} />
            </>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 18, gap: 14 },
  lead: { fontFamily: GF.bold, fontSize: 14, color: withAlpha(GP.ink, 0.65) },
  closed: { paddingTop: 20, fontFamily: GF.bold, fontSize: 15, color: GP.mist },
  cardWrap: { paddingBottom: 4 },
  cardEdge: { position: "absolute", left: 0, right: 0, top: 4, bottom: 0, borderRadius: 16, backgroundColor: GP.slate },
  card: { gap: 12, padding: 14, borderRadius: 16, backgroundColor: GP.cream },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  badge: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  name: { fontFamily: GF.display, fontSize: 19, color: GP.ink },
  count: { fontFamily: GF.bold, fontSize: 11, letterSpacing: 0.4, color: withAlpha(GP.ink, 0.5) },
  pips: { flexDirection: "row", gap: 5 },
  pip: { flex: 1, height: 8, borderRadius: 3 },
  foot: { flexDirection: "row", alignItems: "center", gap: 10 },
  nextKicker: { fontFamily: GF.bold, fontSize: 10, letterSpacing: 0.5, color: GP.mist },
  nextName: { fontFamily: GF.display, fontSize: 16, color: GP.ink },
  nextLevel: { fontFamily: GF.bold, fontSize: 12, color: withAlpha(GP.ink, 0.6) },
});
