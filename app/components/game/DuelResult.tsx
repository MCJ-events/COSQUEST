// The verdict (costquest-ios Features/DuelFeature.swift DuelResultView):
// VICTORY / DEFEAT / CHECKING, the mode's line, the HP card, a run's points or
// a raid's damage, what it paid, a Relic, and the way back.
import { Ionicons } from "@expo/vector-icons";
import { useEffect } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, useReducedMotion, ZoomIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  asFull,
  type DuelOutcomeFull,
  backLabel,
  dropOf,
  extraLines,
  fightersOf,
  hpShare,
  payIsEmpty,
  payOf,
  resultSubtitle,
  resultTitle,
  verdictAnnouncement,
} from "@/features/game/duelFlow";
import { gameStore } from "@/features/game/runtime";
import type { DuelFighterPeek, DuelOutcome, DuelPay, DuelResult as DuelResultData, DuelStart } from "@/features/game/wire";

import { announce, GameButton, MAX_FONT_SCALE } from "./kit";
import { RaidHPBar } from "./RaidParts";
import { RelicArt } from "./RelicArt";
import { GF, GP, realmColor } from "./theme";

const GOLD = "#FFC83D";

export default function DuelResult({ outcome, start, onDone }: { outcome: DuelOutcome; start: DuelStart | null; onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const reduce = useReducedMotion();
  const o = asFull(outcome);
  const won = o.status === "won";
  const held = o.status === "held";
  const factionName = (id: string) => gameStore.factionName(id);
  const subtitle = resultSubtitle(o, start, factionName);
  const fighters = start ? fightersOf(start) : null;
  const pay = payOf(o);
  const drop = dropOf(o);
  const extras = extraLines(o);

  useEffect(() => {
    announce(verdictAnnouncement(o, start, factionName));
    // The verdict is announced once, when it appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View
      entering={reduce ? FadeIn.duration(200) : ZoomIn.springify().stiffness(195).damping(22).withInitialValues({ transform: [{ scale: 0.92 }] })}
      style={StyleSheet.absoluteFill}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 50, paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}>
        <Text accessibilityRole="header" style={[styles.title, { color: won ? GP.sun : "#FFF" }]} maxFontSizeMultiplier={1.2}>
          {resultTitle(o.status)}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {subtitle}
          </Text>
        ) : null}

        {o.result && fighters ? <HpCard r={o.result} p1={fighters.p1} p2={fighters.p2} /> : null}

        {o.run && !held ? <RunPanel run={o.run} /> : null}
        {o.raid && !held ? <RaidPanel raid={o.raid} bossMax={start ? raidMax(start) : null} /> : null}
        {pay && !held && !payIsEmpty(pay) ? <PayRow pay={pay} /> : null}

        {extras.map((line) => (
          <View key={line} style={styles.extra} accessible accessibilityLabel={line}>
            <Ionicons name="ribbon" size={16} color="#FFF" />
            <Text style={styles.extraText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {line}
            </Text>
          </View>
        ))}

        {drop?.relic ? (
          <View style={styles.relic} accessible accessibilityLabel={`${drop.new === true ? "New relic" : "Relic"}: ${drop.relic.name}`}>
            <RelicArt kind={drop.relic.kind} rarity={drop.relic.rarity} size={48} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.relicKicker} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {drop.new === true ? "NEW RELIC" : "RELIC"}
              </Text>
              <Text style={styles.relicName} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {drop.relic.name}
              </Text>
            </View>
          </View>
        ) : null}

        <GameButton title={backLabel(o)} color={GP.sun} onPress={onDone} style={styles.back} />
      </ScrollView>
    </Animated.View>
  );
}

function raidMax(start: DuelStart): number | null {
  const top = (start as unknown as { raid?: { hp_max?: number | null } | null }).raid;
  const inner = (start.setup as { raid?: { hp_max?: number | null } | null }).raid;
  return top?.hp_max ?? inner?.hp_max ?? null;
}

function HpCard({ r, p1, p2 }: { r: DuelResultData; p1: DuelFighterPeek; p2: DuelFighterPeek }) {
  return (
    <View style={styles.card}>
      <HpRow name={p1.name} hp={r.p1_hp} max={p1.max_hp ?? Math.max(1, r.p1_hp)} faction={p1.faction} />
      <HpRow name={p2.name} hp={r.p2_hp} max={p2.max_hp ?? Math.max(1, r.p2_hp)} faction={p2.faction} />
      <Text style={styles.seconds} maxFontSizeMultiplier={MAX_FONT_SCALE}>{`${Math.floor(r.ticks / 60)} s`}</Text>
    </View>
  );
}

function HpRow({ name, hp, max, faction }: { name: string; hp: number; max: number; faction?: string | null }) {
  const { share, percent } = hpShare(hp, max);
  return (
    <View style={{ gap: 4 }} accessible accessibilityLabel={`${name}, ${percent} percent health left`}>
      <View style={styles.hpHead}>
        <Text style={styles.hpName} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {name}
        </Text>
        <Text style={styles.hpPct} maxFontSizeMultiplier={MAX_FONT_SCALE}>{`${percent}%`}</Text>
      </View>
      <View style={styles.track}>
        <View style={{ width: `${Math.min(1, share) * 100}%`, height: 10, borderRadius: 5, backgroundColor: realmColor(faction) }} />
      </View>
    </View>
  );
}

function RunPanel({ run }: { run: NonNullable<DuelOutcomeFull["run"]> }) {
  const earned = run.earned ?? 0;
  const s = run.stake_result;
  const label = [`${earned} points`, run.speed_mult && run.speed_mult > 1.01 ? `Speed times ${run.speed_mult.toFixed(2)}` : null, run.surged ? "Surge times 1.5" : null, s ? (s.won ? `Stake won, plus ${s.stake}` : `Stake lost, minus ${s.stake}`) : null]
    .filter(Boolean)
    .join(". ");
  return (
    <View style={{ alignItems: "center", gap: 8 }} accessible accessibilityLabel={label}>
      <Text style={[styles.runPoints, { color: earned > 0 ? GP.mint : "#FFF" }]} maxFontSizeMultiplier={1.2}>{`+${earned}`}</Text>
      <Text style={styles.runUnit} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        POINTS
      </Text>
      <View style={{ flexDirection: "row", gap: 10 }}>
        {run.speed_mult && run.speed_mult > 1.01 ? <MiniChip text={`Speed ×${run.speed_mult.toFixed(2)}`} /> : null}
        {run.surged ? <MiniChip text="Surge ×1.5" /> : null}
      </View>
      {s ? (
        <Text style={[styles.stake, { color: s.won ? GOLD : GP.berry }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {s.won ? `Stake won: +${s.stake}` : `Stake lost: −${s.stake}`}
        </Text>
      ) : null}
    </View>
  );
}

function MiniChip({ text }: { text: string }) {
  return (
    <Text style={styles.miniChip} maxFontSizeMultiplier={MAX_FONT_SCALE}>
      {text}
    </Text>
  );
}

function RaidPanel({ raid, bossMax }: { raid: NonNullable<DuelOutcomeFull["raid"]>; bossMax: number | null }) {
  const left = raid.hp_left ?? 0;
  const max = raid.hp_max ?? bossMax ?? Math.max(1, left);
  return (
    <View style={styles.raid} accessible accessibilityLabel={`You dealt ${raid.damage ?? 0} damage. Boss ${Math.max(0, left)} of ${max} health left.${raid.defeated ? " Boss defeated." : ""}`}>
      <Text style={styles.raidDamage} maxFontSizeMultiplier={MAX_FONT_SCALE}>{`You dealt ${raid.damage ?? 0} damage`}</Text>
      <RaidHPBar hp={left} maxHp={max} />
      {raid.defeated ? (
        <View style={styles.defeated}>
          <Ionicons name="trophy" size={18} color={GP.sun} />
          <Text style={styles.defeatedText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            Boss defeated
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function PayRow({ pay }: { pay: DuelPay }) {
  const stats: { n: number; label: string }[] = [];
  if ((pay.xp ?? 0) > 0) stats.push({ n: pay.xp ?? 0, label: "XP" });
  if ((pay.faction_points ?? 0) > 0) stats.push({ n: pay.faction_points ?? 0, label: "Faction" });
  return (
    <View style={styles.pay}>
      {stats.map((s) => (
        <View key={s.label} style={{ alignItems: "center", gap: 2 }} accessible accessibilityLabel={`${s.n} ${s.label}`}>
          <Text style={styles.payN} maxFontSizeMultiplier={MAX_FONT_SCALE}>{`+${s.n}`}</Text>
          <Text style={styles.payLabel} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {s.label.toUpperCase()}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { alignItems: "center", gap: 16, paddingHorizontal: 20 },
  title: { fontFamily: GF.display, fontSize: 56, textShadowColor: "rgba(0,0,0,0.3)", textShadowOffset: { width: 0, height: 4 }, textShadowRadius: 0.1 },
  subtitle: { fontFamily: GF.body, fontSize: 16, color: "rgba(255,255,255,0.8)", textAlign: "center" },
  card: { width: "100%", maxWidth: 460, gap: 10, padding: 14, borderRadius: 16, backgroundColor: GP.cream },
  hpHead: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  hpName: { flex: 1, fontFamily: GF.display, fontSize: 15, color: GP.ink },
  hpPct: { fontFamily: GF.display, fontSize: 15, color: GP.ink },
  track: { height: 10, borderRadius: 5, backgroundColor: GP.track, overflow: "hidden" },
  seconds: { alignSelf: "flex-end", fontFamily: GF.bold, fontSize: 12, color: GP.mist },
  runPoints: { fontFamily: GF.display, fontSize: 46 },
  runUnit: { fontFamily: GF.bold, fontSize: 12, letterSpacing: 1.2, color: "rgba(255,255,255,0.7)" },
  miniChip: { fontFamily: GF.bold, fontSize: 13, color: "#FFF", paddingHorizontal: 9, paddingVertical: 4, borderRadius: 12, overflow: "hidden", backgroundColor: "rgba(255,255,255,0.16)" },
  stake: { fontFamily: GF.display, fontSize: 18 },
  raid: { width: "100%", maxWidth: 460, gap: 10, padding: 14, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.10)" },
  raidDamage: { fontFamily: GF.display, fontSize: 22, color: "#FFF" },
  defeated: { flexDirection: "row", alignItems: "center", gap: 6 },
  defeatedText: { fontFamily: GF.display, fontSize: 18, color: GP.sun },
  pay: { flexDirection: "row", gap: 18, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.12)" },
  payN: { fontFamily: GF.display, fontSize: 24, color: "#FFF" },
  payLabel: { fontFamily: GF.bold, fontSize: 11, color: "rgba(255,255,255,0.7)" },
  extra: { flexDirection: "row", alignItems: "center", gap: 6 },
  extraText: { fontFamily: GF.bold, fontSize: 15, color: "#FFF" },
  relic: { width: "100%", maxWidth: 460, flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 16, backgroundColor: GP.cream },
  relicKicker: { fontFamily: GF.display, fontSize: 12, letterSpacing: 1, color: GP.sunDeep },
  relicName: { fontFamily: GF.display, fontSize: 18, color: GP.ink },
  back: { alignSelf: "stretch", maxWidth: 460, width: "100%" },
});
