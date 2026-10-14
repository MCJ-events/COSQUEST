// The React Native game (gameUi: 'rn'): page 1 of the world on Android, and
// on iOS behind the flag. The home map with its HUD, the point sheet, and
// the screens a point opens (a quiz, a Guardian Duel, the reward), plus the
// journal (dailies, codex, faction war) and first-time onboarding.
// costquest-ios Roam/RoamHomeView.swift is the reference for the loop.
import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { bearingDeg, distanceText } from "@/features/game/geo";
import { gameStore, GAME_SERVER, GAME_SERVER_IS_PRODUCTION, useGame, useLocationPermission, startLocation } from "@/features/game/runtime";
import { nearestFirst } from "@/features/game/store";
import { noteStepsOnPhone } from "@/features/game/stepsDevice";
import { unlocked } from "@/features/game/unlocks";
import { arriveMoment, nudgeMoment } from "@/features/game/warden";
import type { QuestPoint } from "@/features/game/wire";
import { factionVeilColor } from "@/features/world/worldState";
import { emitGameEvent } from "@/modules/costquest-game/src/rnGame";
import { useAppSelector } from "@/store/hooks";

import DuelScreen from "./DuelScreen";
import Encounter from "./Encounter";
import FriendsButton from "./FriendsButton";
import FriendsSheet from "./FriendsSheet";
import { NearbyTray, PlayerChip, Rail, StagingBadge, WardenBubble } from "./Hud";
import Journal from "./Journal";
import { GameButton } from "./kit";
import LiveBanner from "./LiveBanner";
import LiveCalendarSheet from "./LiveCalendarSheet";
import MoreSheet, { type MoreTile } from "./MoreSheet";
import Onboarding from "./Onboarding";
import PointSheet from "./PointSheet";
import Reward, { type RewardSummary } from "./Reward";
import { GF, GP } from "./theme";
import { useWardenSaid, wardenVoice } from "./wardenVoice";
import WorldMap from "./WorldMap";

type Screen =
  | { kind: "home" }
  | { kind: "encounter"; point: QuestPoint }
  | { kind: "duel"; point: QuestPoint }
  | { kind: "reward"; reward: RewardSummary };

/** What is open over the map (one at a time, closed by Android Back). */
type Sheet = "journal" | "more" | "events" | "friends";

const NUDGE_EVERY_MS = 150000;

export default function GameRoot({ parked }: { parked: boolean }) {
  const insets = useSafeAreaInsets();
  const state = useGame();
  const permission = useLocationPermission();
  const said = useWardenSaid();
  const chatName = useAppSelector((s) => s.auth.user?.profile?.username || s.auth.user?.profile?.firstName || "");
  const chatFaction = useAppSelector((s) => s.auth.user?.faction ?? null);
  const [screen, setScreen] = useState<Screen>({ kind: "home" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [, recentre] = useState(0);
  const greeted = useRef(new Set<string>());

  const { me, points, fix, focus } = state;
  const color = factionVeilColor(me?.faction, chatFaction);
  const ctx = useCallback(() => ({ me: gameStore.get().me, playerName: gameStore.playerName() }), []);
  // Computed from the points and the fix themselves: the React Compiler
  // memoises on what the callback reads, so reading the store here would
  // freeze the list at its first (empty) value.
  const nearby = useMemo(() => nearestFirst(points, fix), [points, fix]);
  // An invite or a link asked for a spot: it is selected once its point is here.
  // Any invite target (shrine, duel or raid) is a point id, as on iOS
  // (GameHostOpenHook.resolve): open that point's sheet once it is loaded.
  const focusId = focus ? focus.pointId ?? focus.duelId ?? focus.raidId ?? null : null;
  const focusPoint = focusId ? points.find((p) => p.id === focusId) ?? null : null;
  const selected = points.find((p) => p.id === selectedId) ?? (screen.kind === "home" ? focusPoint : null);
  const closeSheet = () => {
    setSelectedId(null);
    gameStore.setFocus(null);
  };

  // The Warden greets a point the first time it comes into reach (and starts
  // writing the greeting while the player walks up, when the model is on).
  useEffect(() => {
    if (__DEV__ || process.env.EXPO_PUBLIC_WORLD_TIMING === "1") {
      console.log(`[warden] effect: parked=${parked} screen=${screen.kind} faction=${me?.faction ?? "-"} points=${nearby.length}`);
    }
    if (parked || screen.kind !== "home" || !me?.faction) return;
    const approaching = nearby.find((x) => !gameStore.isCooling(x) && (gameStore.distanceTo(x) ?? 1e9) < gameStore.reach() + 60);
    if (approaching) wardenVoice.prepare(arriveMoment(ctx(), approaching));
    const p = nearby.find((x) => gameStore.inReach(x) && !gameStore.isCooling(x));
    if (__DEV__ || process.env.EXPO_PUBLIC_WORLD_TIMING === "1") {
      console.log(`[warden] check: ${nearby.length} nearby, in reach ${p ? p.name : "none"}${p && greeted.current.has(p.id) ? " (greeted)" : ""}`);
    }
    if (p && !greeted.current.has(p.id)) {
      greeted.current.add(p.id);
      wardenVoice.speak(arriveMoment(ctx(), p)).catch(() => {});
    }
  }, [nearby, parked, screen.kind, me?.faction, ctx]);

  // A quiet step-counter reading each time the game comes to the front (no
  // prompt, no network), so the week's walking is split between weeks well.
  useEffect(() => {
    if (!parked) void noteStepsOnPhone();
  }, [parked]);

  // Now and then, the best next move.
  useEffect(() => {
    if (parked || screen.kind !== "home" || !me?.tutorial_done) return;
    const t = setInterval(() => {
      if (wardenVoice.get()) return;
      const s = gameStore.get();
      const m = nudgeMoment(ctx(), s.fix, s.points, gameStore.reach(), s.war);
      if (m) wardenVoice.speak(m).catch(() => {});
    }, NUDGE_EVERY_MS);
    return () => clearInterval(t);
  }, [parked, screen.kind, me?.tutorial_done, ctx]);

  // Android Back inside the game: close what is open first; on the map, the
  // pager's own handler takes it (back to the chat).
  useEffect(() => {
    if (parked) return;
    const open = screen.kind !== "home" || sheet !== null || selected !== null;
    if (!open) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (sheet) setSheet(null);
      else if (screen.kind === "reward" || screen.kind === "encounter" || screen.kind === "duel") setScreen({ kind: "home" });
      else closeSheet();
      return true;
    });
    return () => sub.remove();
  }, [parked, screen.kind, sheet, selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const play = (p: QuestPoint) => {
    setSelectedId(null);
    gameStore.setFocus(null);
    setScreen(gameStore.playsAsDuel(p) ? { kind: "duel", point: p } : { kind: "encounter", point: p });
  };

  const share = (p: QuestPoint) => {
    emitGameEvent("onShareToChat", {
      type: gameStore.playsAsDuel(p) ? "duel" : "shrine",
      targetId: p.id,
      place: p.name,
      lat: p.lat,
      lng: p.lng,
    });
  };

  if (!state.session) {
    return <View style={styles.root} />;
  }
  if (gameStore.needsOnboarding) {
    return <Onboarding suggestedName={chatName} />;
  }

  const dailiesLeft = me?.dailies.filter((d) => !d.done).length ?? 0;
  // The rest of the game, under More (RoamHomeView.swift moreTiles), as levels unlock it.
  const moreTiles: MoreTile[] = [];
  if (unlocked(me, "friends")) {
    moreTiles.push({ id: "friends", icon: "people", color: GP.berry, title: "Friends", embed: <FriendsButton size={58} onPress={() => setSheet("friends")} />, onPress: () => setSheet("friends") });
  }
  moreTiles.push({ id: "events", icon: "calendar", color: GP.navy, title: "Quest Hours", onPress: () => setSheet("events") });
  const focusAway = focus && !focusId && focus.lat !== undefined && focus.lng !== undefined ? focus : null;
  const focusMissing = focus && focusId && !focusPoint ? focus : null;

  return (
    <View style={styles.root}>
      <WorldMap
        ground={state.ground}
        centre={state.centre}
        fix={fix}
        points={points}
        reachM={gameStore.reach()}
        selectedId={selected?.id ?? null}
        inReach={gameStore.inReach}
        cooling={gameStore.isCooling}
        factionColor={color}
        onSelect={(p) => setSelectedId(p.id)}
      />

      <PlayerChip me={me} name={gameStore.playerName()} color={color} onPress={() => setSheet("journal")} />
      {!GAME_SERVER_IS_PRODUCTION ? <StagingBadge label={GAME_SERVER.includes("staging") ? "STAGING" : "TEST SERVER"} /> : null}
      <Rail
        onJournal={() => setSheet("journal")}
        onMore={() => setSheet("more")}
        onRecentre={() => {
          recentre((n) => n + 1);
          void gameStore.refreshPoints(true);
        }}
        dailiesLeft={dailiesLeft}
      />

      {/* Under the top bar, left of the rail: one column, as iOS's worldBanners. */}
      <View style={[styles.banners, { top: insets.top + 84 }]} pointerEvents="box-none">
      {permission === "denied" ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>{"Location is off, so Quest Points can't find you. Turn it on in Settings to play."}</Text>
          <GameButton title="Try again" small color={GP.skyDeep} onPress={() => startLocation(true)} />
        </View>
      ) : !fix ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>Finding you…</Text>
        </View>
      ) : state.problem ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>{state.problem}</Text>
          <GameButton title="Try again" small color={GP.skyDeep} onPress={() => gameStore.loadBasics()} />
        </View>
      ) : null}

      {screen.kind === "home" ? <LiveBanner parked={parked} onOpen={() => setSheet("events")} /> : null}

      {focusAway || focusMissing ? (
        <FocusBanner
          place={(focusAway ?? focusMissing)?.place ?? "the invited spot"}
          lat={(focusAway ?? focusMissing)?.lat}
          lng={(focusAway ?? focusMissing)?.lng}
          onClose={() => gameStore.setFocus(null)}
        />
      ) : null}
      </View>

      {!selected ? (
        <NearbyTray
          points={nearby}
          distanceOf={(p) => gameStore.distanceTo(p)}
          inReach={gameStore.inReach}
          cooling={gameStore.isCooling}
          onSelect={(p) => setSelectedId(p.id)}
        />
      ) : null}

      {screen.kind === "home" && !selected ? <WardenBubble said={said} color={color} /> : null}

      {selected ? (
        <PointSheet
          point={selected}
          distance={gameStore.distanceTo(selected)}
          inReach={gameStore.inReach(selected)}
          cooling={gameStore.isCooling(selected)}
          asDuel={gameStore.playsAsDuel(selected)}
          factionName={gameStore.factionName}
          onPlay={() => play(selected)}
          onShare={() => share(selected)}
          onClose={closeSheet}
        />
      ) : null}

      {sheet === "journal" ? <Journal onClose={() => setSheet(null)} /> : null}
      {sheet === "more" ? <MoreSheet tiles={moreTiles} onClose={() => setSheet(null)} /> : null}
      {sheet === "events" ? <LiveCalendarSheet onClose={() => setSheet(null)} /> : null}
      {sheet === "friends" ? <FriendsSheet onClose={() => setSheet(null)} /> : null}

      {screen.kind === "encounter" ? (
        <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(160)} style={StyleSheet.absoluteFill}>
          <Encounter point={screen.point} onReward={(reward) => setScreen({ kind: "reward", reward })} onClose={() => setScreen({ kind: "home" })} />
        </Animated.View>
      ) : null}
      {screen.kind === "duel" ? (
        <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(160)} style={StyleSheet.absoluteFill}>
          <DuelScreen point={screen.point} parked={parked} onReward={(reward) => setScreen({ kind: "reward", reward })} onClose={() => setScreen({ kind: "home" })} />
        </Animated.View>
      ) : null}
      {screen.kind === "reward" ? (
        <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(160)} style={StyleSheet.absoluteFill}>
          <Reward reward={screen.reward} onDone={() => setScreen({ kind: "home" })} />
        </Animated.View>
      ) : null}
    </View>
  );
}

function FocusBanner({ place, lat, lng, onClose }: { place: string; lat?: number; lng?: number; onClose: () => void }) {
  const { fix } = useGame();
  const there = lat !== undefined && lng !== undefined ? { lat, lng } : null;
  const d = there ? gameStore.distanceTo(there) : null;
  const heading = fix && there ? bearingDeg(fix, there) : null;
  return (
    <Animated.View entering={FadeIn} style={styles.focus} accessibilityLiveRegion="polite">
      {heading !== null ? (
        <Ionicons name="navigate" size={22} color={GP.sun} style={{ transform: [{ rotate: `${heading - 45}deg` }] }} />
      ) : (
        <Ionicons name="flag" size={22} color={GP.sun} />
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.focusTitle} numberOfLines={1}>
          Head to {place}
        </Text>
        <Text style={styles.focusSub}>
          {d === null
            ? "It opens when you're close."
            : d <= gameStore.reach()
              ? "You're here. It opens as soon as it wakes."
              : `${distanceText(d)} away. It opens when you're close.`}
        </Text>
      </View>
      <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Dismiss">
        <Ionicons name="close" size={20} color="#FFF" />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#E6EFDF" },
  banners: { position: "absolute", left: 76, right: 70, gap: 8 },
  notice: {
    padding: 12,
    gap: 8,
    borderRadius: 16,
    backgroundColor: "rgba(30,58,76,0.92)",
  },
  noticeText: { fontFamily: GF.body, fontSize: 14, color: "#FFF" },
  focus: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 16,
    backgroundColor: GP.navy,
    elevation: 6,
  },
  focusTitle: { fontFamily: GF.display, fontSize: 15, color: "#FFF" },
  focusSub: { fontFamily: GF.regular, fontSize: 12, color: "rgba(255,255,255,0.8)" },
});
