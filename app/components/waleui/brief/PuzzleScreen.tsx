// The comic panel puzzle at a puzzle station (13 Nov 2026; feature `comic_puzzles`): 3 to 5 panels
// arrive shuffled; the player taps them in story order (a numbered badge on each; a second tap takes
// one off), against the clock. The server holds the answer and judges the order; a solved puzzle
// completes the station at once (the brief's 75 XP). After a miss the story order is shown, and the
// server says when the next try is.
import { Image } from "expo-image";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";

import {
  badgeFor,
  clockText,
  fetchMyStations,
  fetchStations,
  orderComplete,
  type Panel,
  panelsInOrder,
  type PuzzlePaper,
  type PuzzleVerdict,
  retryAtFrom,
  secondsUntil,
  showPuzzles,
  startPuzzle,
  type Station,
  stationErrorText,
  submitPuzzle,
  tapPanel,
  waitText,
} from "@/features/game/briefFeatures";
import { gameStore } from "@/features/game/runtime";

import { T, W, glass } from "../kit";
import { BriefScreen, Card, Chip, GhostButton, Label, Loading, NotOpen, P, PinkButton, Say, spotNow, useBriefFlags, useNow } from "./briefKit";

function PanelCard({ panel, badge, onPress, testID, dim }: { panel: Panel; badge: number | null; onPress?: () => void; testID?: string; dim?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${panel.alt || panel.caption}${badge ? `, placed ${badge}` : ""}`}
      disabled={!onPress}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [glass(12, "rgba(255,255,255,0.88)"), { width: "47%", padding: 10, gap: 8, borderWidth: badge ? 2 : 1, borderColor: badge ? W.pink : W.line, opacity: dim ? 0.6 : pressed ? 0.75 : 1 }]}
    >
      {panel.image_url ? (
        <Image source={{ uri: panel.image_url }} style={{ width: "100%", aspectRatio: 1, borderRadius: 8, backgroundColor: W.band }} contentFit="cover" accessibilityLabel={panel.alt ?? undefined} />
      ) : (
        <View style={{ width: "100%", aspectRatio: 1.4, borderRadius: 8, backgroundColor: W.band, padding: 8, justifyContent: "center" }}>
          <T size={11} weight={500} color={W.inkSoft} lines={0} italic align="center">
            {panel.alt || "Panel"}
          </T>
        </View>
      )}
      <T size={12} weight={600} lines={0}>
        {panel.caption}
      </T>
      {badge ? (
        <View style={{ position: "absolute", right: -6, top: -6, width: 28, height: 28, borderRadius: 14, backgroundColor: W.pink, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#FFFFFF" }}>
          <T size={13} weight={800} color="#FFFFFF">
            {badge}
          </T>
        </View>
      ) : null}
    </Pressable>
  );
}

export default function PuzzleScreen({ gameId, stationId }: { gameId: string; stationId: string }) {
  const flags = useBriefFlags();
  const on = showPuzzles(flags);
  const [station, setStation] = useState<Station | null>(null);
  const [done, setDone] = useState(false);
  const [paper, setPaper] = useState<PuzzlePaper | null>(null);
  const [order, setOrder] = useState<number[]>([]);
  const [verdict, setVerdict] = useState<PuzzleVerdict | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [retryAt, setRetryAt] = useState<string | null>(null);
  const now = useNow(!!paper && !verdict);

  useEffect(() => {
    if (!on) return;
    void (async () => {
      try {
        const all = await fetchStations(gameStore.client, gameId);
        setStation(all.find((s) => s.id === stationId) ?? null);
        const mine = await fetchMyStations(gameStore.client, gameId);
        setDone(mine.some((c) => c.station_id === stationId && c.status === "verified"));
      } catch {
        // the start answers for itself
      }
    })();
  }, [on, gameId, stationId]);

  const start = async () => {
    setBusy(true);
    setSaid(null);
    setVerdict(null);
    setOrder([]);
    try {
      const at = await spotNow();
      if (!at) throw new Error("location");
      setPaper(await startPuzzle(gameStore.client, gameId, stationId, at));
      setRetryAt(null);
    } catch (e) {
      setRetryAt(retryAtFrom(e));
      setSaid(e instanceof Error && e.message === "location" ? "Turn on location: the puzzle opens at its station." : stationErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const left = paper ? secondsUntil(paper.expires_at, now) : 0;
  const send = async () => {
    if (!paper) return;
    setBusy(true);
    setSaid(null);
    try {
      const v = await submitPuzzle(gameStore.client, gameId, stationId, paper.test_id, order);
      setVerdict(v);
      setRetryAt(v.retry_at ?? null);
      if (v.passed) setDone(true);
    } catch (e) {
      setSaid(stationErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const panels = paper?.puzzle.panels ?? [];
  const wait = waitText(retryAt, now);
  return (
    <BriefScreen title={station?.name ?? "Comic panel puzzle"} kicker="Comic panel puzzle" testID="brief-puzzle" icon={require("@/assets/images/waleui/icon_megaphone.png")}>
      {flags === null ? (
        <Loading />
      ) : !on ? (
        <NotOpen what="Comic panel puzzles" testID="brief-puzzle-off" />
      ) : done && !verdict ? (
        <Card tone="solid" testID="brief-puzzle-already">
          <Chip text="Done" tone="green" />
          <P>{"You've solved this station's puzzle."}</P>
          <GhostButton label="Back to the event" onPress={() => router.replace({ pathname: "/wale/event", params: { game: gameId } })} />
        </Card>
      ) : !paper ? (
        <Card testID="brief-puzzle-intro">
          <Label>{station ? `${station.xp} XP` : "Puzzle"}</Label>
          <P>Some comic panels are out of order. Tap them in the order the story happens, before the clock runs out.</P>
          <PinkButton label="Start" onPress={() => void start()} busy={busy} disabled={!!wait} testID="brief-puzzle-start" />
          <Say text={wait ?? said} />
        </Card>
      ) : verdict ? (
        <Card tone={verdict.passed ? "solid" : "glass"} testID="brief-puzzle-verdict">
          {verdict.passed ? (
            <>
              <Chip text="Solved" tone="green" />
              <P size={18} weight={700}>{`+${verdict.completion?.xp ?? station?.xp ?? 0} XP`}</P>
              <GhostButton label="Back to the event" onPress={() => router.replace({ pathname: "/wale/event", params: { game: gameId } })} testID="brief-puzzle-back" />
            </>
          ) : (
            <>
              <Chip text={verdict.outcome === "timeout" ? "Out of time" : "Not quite"} tone="purple" />
              <Label>The story goes</Label>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, justifyContent: "space-between" }}>
                {panelsInOrder(panels, verdict.solution).map((p, i) => (
                  <PanelCard key={p.idx} panel={p} badge={i + 1} dim testID={`brief-puzzle-solution-${i}`} />
                ))}
              </View>
              <PinkButton label="Try again" onPress={() => void start()} busy={busy} disabled={!!wait} testID="brief-puzzle-retry" />
              <Say text={wait} />
            </>
          )}
        </Card>
      ) : (
        <>
          <Card tone="solid" testID="brief-puzzle-board">
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Label>{paper.puzzle.title || "Put the panels in story order"}</Label>
              <T size={18} weight={800} color={left <= 10 ? W.pinkDeep : W.ink} testID="brief-puzzle-clock">
                {clockText(left)}
              </T>
            </View>
            {paper.puzzle.prompt ? <P color={W.inkSoft}>{paper.puzzle.prompt}</P> : null}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, justifyContent: "space-between" }}>
              {panels.map((p) => (
                <PanelCard key={p.idx} panel={p} badge={badgeFor(order, p.idx)} onPress={() => setOrder((o) => tapPanel(o, p.idx))} testID={`brief-puzzle-panel-${p.idx}`} />
              ))}
            </View>
          </Card>
          <PinkButton label={left > 0 ? "Submit" : "Time's up: submit"} onPress={() => void send()} busy={busy} disabled={!orderComplete(order, panels) && left > 0} testID="brief-puzzle-submit" />
          {order.length ? <GhostButton label="Clear" onPress={() => setOrder([])} /> : null}
          <Say text={said} />
        </>
      )}
    </BriefScreen>
  );
}
