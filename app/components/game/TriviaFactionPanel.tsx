// Trivia for your faction (17 Nov 2026, Mark TG 47999), in the app only (never the web /play page): the faction
// board for today, this week or the season, your share of it, a 9:16 card of it to post, and the online
// psychoanimus meter for your faction with its rewards. A player with no faction is asked to pick one of the six.
// Everything comes from the server (features/game/triviaFaction.ts); a server with the flags off answers 404 and
// the panel draws nothing. Drawn on the trivia front door (light) and on the results (onDark, over the picture).
import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { FONTS } from "@/constants/fonts";
import { GameError } from "@/features/game/client";
import { gameStore, useGame } from "@/features/game/runtime";
import {
  claimLabel,
  claimPsychoanimus,
  FACTION_PERIODS,
  factionLine,
  factionShareCard,
  factionTriviaShown,
  type FactionBoard,
  type FactionPeriod,
  meterLine,
  myMeter,
  type Psychoanimus,
  triviaFactions,
  triviaPsychoanimus,
  weightLine,
  youLine,
} from "@/features/game/triviaFaction";
import { TRIVIA } from "@/features/game/triviaLook";

import { Glass, Kicker } from "./TriviaKit";
import { shareCard } from "./triviaShareDevice";

const T = TRIVIA;
const off = (e: unknown) => e instanceof GameError && e.status === 404;

export function TriviaFactionPanel({ onDark = false, refreshKey = 0 }: { onDark?: boolean; refreshKey?: number }) {
  const shown = factionTriviaShown(Platform.OS);
  const config = useGame((g) => g.config);
  const [period, setPeriod] = useState<FactionPeriod>("today");
  const [board, setBoard] = useState<FactionBoard | null>(null);
  const [psycho, setPsycho] = useState<Psychoanimus | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "off">("loading");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(
    async (p: FactionPeriod) => {
      const key = gameStore.get().session?.playerKey ?? null;
      try {
        setBoard(await triviaFactions(gameStore.client, p, key));
        setState("ready");
      } catch (e) {
        setState(off(e) ? "off" : "ready");
        if (!off(e)) setNote("Couldn't load the faction board.");
      }
      try {
        setPsycho(await triviaPsychoanimus(gameStore.client, key));
      } catch {
        setPsycho(null);
      }
    },
    [],
  );

  useEffect(() => {
    if (shown) void load(period);
  }, [shown, load, period, refreshKey]);

  if (!shown || state === "off") return null;
  const ink = onDark ? "#FFFFFF" : T.ink;
  const muted = onDark ? "rgba(255,255,255,0.78)" : T.muted;
  const needs = !!board?.you?.needs_faction;
  const mine = psycho ? myMeter(psycho) : null;
  const claim = psycho ? claimLabel(psycho) : null;
  const card = board ? factionShareCard(board, `${gameStore.client.baseUrl}/trivia`) : null;

  const pick = async (id: string) => {
    setBusy(`pick:${id}`);
    try {
      await gameStore.chooseFaction(id);
      await load(period);
    } catch (e) {
      setNote(e instanceof Error && e.message ? e.message : "Couldn't join that faction.");
    } finally {
      setBusy(null);
    }
  };
  const share = async () => {
    if (!card) return;
    setBusy("share");
    try {
      const out = await shareCard(card, "board");
      if (out === "failed") setNote("Couldn't open the share sheet.");
    } finally {
      setBusy(null);
    }
  };
  const doClaim = async () => {
    setBusy("claim");
    try {
      const got = await claimPsychoanimus(gameStore.client);
      setPsycho(got);
      const story = got.paid.find((x) => x.story_slot);
      setNote(got.xp > 0 ? `+${got.xp} XP for ${board?.you?.name ?? "your faction"}${story ? ". Your early story piece is saved for you." : "."}` : "Nothing new to claim yet.");
    } catch (e) {
      setNote(e instanceof Error && e.message ? e.message : "Couldn't claim right now.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={{ gap: 12 }} testID="trivia-faction-panel">
      <View style={styles.head}>
        <Text style={[styles.title, { color: ink }]} accessibilityRole="header">
          Faction board
        </Text>
        {card ? (
          <Pressable onPress={() => void share()} disabled={busy === "share"} hitSlop={10} accessibilityRole="button" accessibilityLabel="Share the faction board" testID="trivia-share-factions" style={styles.shareRow}>
            {busy === "share" ? <ActivityIndicator size="small" color={onDark ? "#FFFFFF" : T.accentText} /> : <Ionicons name="share-social-outline" size={16} color={onDark ? "#FFFFFF" : T.accentText} />}
            <Text style={[styles.small, { color: onDark ? "#FFFFFF" : T.accentText }]}>Share</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.tabs} accessibilityRole="tablist">
        {FACTION_PERIODS.map((p) => {
          const on = p.id === period;
          return (
            <Pressable key={p.id} onPress={() => setPeriod(p.id)} accessibilityRole="tab" accessibilityState={{ selected: on }} testID={`trivia-faction-${p.id}`} style={[styles.tab, on && { backgroundColor: T.accent }]}>
              <Text style={[styles.tabText, { color: on ? "#FFFFFF" : ink }]}>{p.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <Glass style={[{ paddingVertical: 6 }, onDark && styles.darkGlass]}>
        {state === "loading" || !board ? (
          <ActivityIndicator style={{ margin: 16 }} color={T.accent} />
        ) : board.note && board.factions.every((f) => f.total === 0) ? (
          <Text style={[styles.body, { color: muted, padding: 14 }]}>{board.note}</Text>
        ) : (
          board.factions.map((f, i) => {
            const me = f.faction === board.you?.faction;
            return (
              <View key={f.faction} style={[styles.row, i > 0 && styles.rule, me && { backgroundColor: T.accentSoft }]} accessible accessibilityLabel={`${f.place}. ${f.name}${me ? ", your faction" : ""}, ${factionLine(f)}`}>
                <Text style={[styles.place, { color: f.place === 1 ? T.accentText : muted }, onDark && f.place === 1 && { color: "#FFD3EE" }]}>{f.place}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.name, { color: ink }]} numberOfLines={1}>
                    {f.name}
                    {me ? "  ·  you" : ""}
                  </Text>
                  <Text style={[styles.small, { color: muted }]}>{factionLine(f)}</Text>
                </View>
                <Text style={[styles.total, { color: ink }]}>{f.total.toLocaleString("en-US")}</Text>
              </View>
            );
          })
        )}
      </Glass>
      {board ? <Text style={[styles.body, { color: muted }]}>{youLine(board)}</Text> : null}

      {needs ? (
        <View style={{ gap: 8 }}>
          <Kicker>PICK YOUR FACTION</Kicker>
          <View style={styles.pickWrap}>
            {(config?.factions?.length ? config.factions : board?.factions.map((f) => ({ id: f.faction, name: f.name })) ?? []).map((f) => (
              <Pressable key={f.id} onPress={() => void pick(f.id)} disabled={!!busy} accessibilityRole="button" accessibilityLabel={`Join ${f.name}`} testID={`trivia-pick-${f.id}`} style={[styles.pick, onDark && styles.darkGlass]}>
                {busy === `pick:${f.id}` ? <ActivityIndicator size="small" color={T.accent} /> : <Text style={[styles.pickText, { color: ink }]}>{f.name}</Text>}
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {psycho && mine ? (
        <Glass style={[{ padding: 14, gap: 10 }, onDark && styles.darkGlass]}>
          <View style={styles.head}>
            <Kicker>PSYCHOANIMUS · {mine.name.toUpperCase()}</Kicker>
            <Text style={[styles.small, { color: muted }]}>{Math.round(mine.fill * 100)}%</Text>
          </View>
          <View style={styles.track} accessible accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(mine.fill * 100) }} testID="trivia-psychoanimus">
            <View style={[styles.fill, { width: `${Math.max(2, Math.round(mine.fill * 100))}%` }]} />
            {mine.tiers.map((t) => (
              <View key={t.id} style={[styles.tick, { left: `${Math.min(99, (t.at / mine.max) * 100)}%` }, t.unlocked && { backgroundColor: "#FFFFFF" }]} />
            ))}
          </View>
          <Text style={[styles.body, { color: ink }]}>{meterLine(mine)}</Text>
          {mine.tiers.map((t) => (
            <View key={t.id} style={styles.tierRow}>
              <Ionicons name={t.unlocked ? "lock-open" : "lock-closed-outline"} size={15} color={t.unlocked ? T.accentText : muted} />
              <Text style={[styles.small, { color: t.unlocked ? ink : muted, flex: 1 }]}>
                {t.label}
                {t.xp ? ` · +${t.xp} XP` : ""}
                {psycho.you?.claimed.includes(t.id) ? " · claimed" : ""}
              </Text>
            </View>
          ))}
          <Text style={[styles.small, { color: muted }]}>{weightLine(psycho)}</Text>
          {claim ? (
            <Pressable onPress={() => void doClaim()} disabled={busy === "claim"} accessibilityRole="button" testID="trivia-psychoanimus-claim" style={styles.claim}>
              {busy === "claim" ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.claimText}>{claim}</Text>}
            </Pressable>
          ) : null}
        </Glass>
      ) : null}
      {note ? <Text style={[styles.small, { color: muted }]}>{note}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  title: { fontFamily: FONTS.bold, fontSize: 16, lineHeight: 22 },
  shareRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  tabs: { flexDirection: "row", gap: 8 },
  tab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.55)" },
  tabText: { fontFamily: FONTS.semibold, fontSize: 13 },
  darkGlass: { backgroundColor: "rgba(10,14,22,0.55)", borderColor: "rgba(255,255,255,0.18)" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 10 },
  rule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(31,58,74,0.14)" },
  place: { width: 22, fontFamily: FONTS.bold, fontSize: 15, fontVariant: ["tabular-nums"] },
  name: { fontFamily: FONTS.semibold, fontSize: 15, lineHeight: 20 },
  total: { fontFamily: FONTS.bold, fontSize: 15, fontVariant: ["tabular-nums"] },
  body: { fontFamily: FONTS.regular, fontSize: 13.5, lineHeight: 19 },
  small: { fontFamily: FONTS.regular, fontSize: 12, lineHeight: 17 },
  pickWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pick: { minWidth: 104, minHeight: 44, paddingHorizontal: 14, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.75)", borderWidth: 1, borderColor: "rgba(255,255,255,0.9)" },
  pickText: { fontFamily: FONTS.semibold, fontSize: 14 },
  track: { height: 12, borderRadius: 6, backgroundColor: "rgba(184,65,143,0.18)", overflow: "hidden", justifyContent: "center" },
  fill: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 6, backgroundColor: T.accent },
  tick: { position: "absolute", top: 2, bottom: 2, width: 2, marginLeft: -1, backgroundColor: "rgba(31,58,74,0.35)" },
  tierRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  claim: { alignSelf: "flex-start", minHeight: 44, paddingHorizontal: 18, borderRadius: 999, backgroundColor: T.accent, alignItems: "center", justifyContent: "center" },
  claimText: { color: "#FFFFFF", fontFamily: FONTS.semibold, fontSize: 14 },
});
