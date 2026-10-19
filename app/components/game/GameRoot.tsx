// The React Native game (gameUi: 'rn'): page 1 of the world on Android, and
// on iOS behind the flag. The home map with its HUD, the point sheet, and
// the screens a point opens (a quiz, a Guardian Duel, the reward), plus the
// journal (dailies, codex, faction war) and first-time onboarding.
// costquest-ios Roam/RoamHomeView.swift is the reference for the loop.
import { Ionicons } from "@expo/vector-icons";
import { useFonts } from "expo-font";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getPref, setPref } from "@/utils/prefsStorage";
import { COACH_DONE_KEY, coachStepFor, type CoachStep, parseIdList, UNLOCKS_INTRODUCED_KEY, unlockOfStep } from "@/features/game/coach";
import { bearingDeg, distanceM, distanceText } from "@/features/game/geo";
import { relativeBearing, suggestedId } from "@/features/game/guide";
import { gameStore, GAME_SERVER, GAME_SERVER_IS_PRODUCTION, useGame, useLocationPermission, startLocation } from "@/features/game/runtime";
import { nearestFirst } from "@/features/game/store";
import { raidPlaysAsDuel } from "@/features/game/raids";
import { useRoomBeacons, useRooms } from "@/features/game/roomsRuntime";
import { isSiege, siegePlaysAsDuel } from "@/features/game/siege";
import { noteStepsOnPhone } from "@/features/game/stepsDevice";
import { unlocked, visiblePoints } from "@/features/game/unlocks";
import { arriveMoment, legendMoment, nudgeMoment } from "@/features/game/warden";
import type { QuestPoint } from "@/features/game/wire";
import { factionVeilColor } from "@/features/world/worldState";
import { openVenueEvents, venueEventsAvailable } from "@/modules/costquest-game/src";
import { emitGameEvent } from "@/modules/costquest-game/src/rnGame";
import { useAppSelector } from "@/store/hooks";

import { GameBannerHost, showBanner } from "./Banner";
import CoachOverlay from "./Coach";
import CoinsSheet from "./CoinsSheet";
import DuelScreen from "./DuelScreen";
import Encounter, { encounterGuard } from "./Encounter";
import FriendsButton from "./FriendsButton";
import { GAME_FONTS } from "./fonts";
import FriendsSheet from "./FriendsSheet";
import { NearbyTray, Rail, StagingBadge, TopBar, WardenBubble } from "./Hud";
import Journal from "./Journal";
import { GameButton } from "./kit";
import LiveBanner from "./LiveBanner";
import LiveCalendarSheet from "./LiveCalendarSheet";
import MoreSheet, { type MoreTile } from "./MoreSheet";
import NearbyRadar from "./NearbyRadar";
import Onboarding from "./Onboarding";
import PointSheet from "./PointSheet";
import ProfileSheet from "./ProfileSheet";
import RaidBanner from "./RaidBanner";
import RaidScreen from "./RaidScreen";
import RoomScreen from "./RoomScreen";
import RoomSheet from "./RoomSheet";
import RelicsButton from "./RelicsButton";
import RelicsSheet from "./RelicsSheet";
import Reward, { type RewardSummary } from "./Reward";
import SiegeScreen, { siegeGuard } from "./SiegeScreen";
import { GF, GP, realmColor } from "./theme";
import { useHeading } from "./useHeading";
import { useOnScreen } from "./useOnScreen";
import { useWardenSaid, wardenVoice } from "./wardenVoice";
import WorldMap from "./WorldMap";

type Screen =
  | { kind: "home" }
  | { kind: "encounter"; point: QuestPoint }
  | { kind: "duel"; point: QuestPoint; mode: "point" | "raid" | "siege" }
  | { kind: "raid"; point: QuestPoint }
  | { kind: "siege"; point: QuestPoint }
  | { kind: "room"; gameId: string }
  | { kind: "reward"; reward: RewardSummary };

/** What is open over the map (one at a time, closed by Android Back). */
type Sheet = "dailies" | "codex" | "war" | "more" | "events" | "friends" | "relics" | "battle" | "profile" | "coins";

const NUDGE_EVERY_MS = 150000;
/** The first nudge waits for the map to settle (RoamHomeView.nudgeLoop: 25 s). */
const FIRST_NUDGE_MS = 25000;
/** A nudge is put away after 12 s if nothing else has spoken since. */
const NUDGE_SHOWN_MS = 12000;

export default function GameRoot({ parked }: { parked: boolean }) {
  const insets = useSafeAreaInsets();
  // The game's own type (Lilita One, Fredoka); bundled, so this is one frame or two.
  const [fontsReady, fontsError] = useFonts(GAME_FONTS);
  const state = useGame();
  const permission = useLocationPermission();
  const said = useWardenSaid();
  const chatName = useAppSelector((s) => s.auth.user?.profile?.username || s.auth.user?.profile?.firstName || "");
  const chatFaction = useAppSelector((s) => s.auth.user?.faction ?? null);
  const [screen, setScreen] = useState<Screen>({ kind: "home" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const onScreen = useOnScreen();
  /** A Room beacon tapped on the map: the Battle sheet opens on that room. */
  const [roomFocus, setRoomFocus] = useState<string | null>(null);
  const [, recentre] = useState(0);
  const [legendOf, setLegendOf] = useState<{ id: string; text: string } | null>(null);
  const greeted = useRef(new Set<string>());
  // What the coach has said (cq.coach.done, cq.unlocks.introduced), read once.
  const [coachDone, setCoachDone] = useState<Set<string> | null>(null);
  const [introduced, setIntroduced] = useState<Set<string>>(() => new Set());

  const { me, fix, focus } = state;
  // Bosses wait for level 5 (RoamGuide.swift visiblePoints).
  const points = useMemo(() => visiblePoints(state.points, me), [state.points, me]);
  const color = factionVeilColor(me?.faction, chatFaction);
  const ctx = useCallback(() => ({ me: gameStore.get().me, playerName: gameStore.playerName() }), []);
  // Computed from the points and the fix themselves: the React Compiler
  // memoises on what the callback reads, so reading the store here would
  // freeze the list at its first (empty) value.
  const nearby = useMemo(() => nearestFirst(points, fix), [points, fix]);
  const battleOpen = unlocked(me, "battle");
  const rooms = useRooms();
  useRoomBeacons(!parked && battleOpen && screen.kind !== "room");
  const openBattle = (focus: string | null) => {
    // A point sheet left open under the Room would take its first Back.
    setSelectedId(null);
    gameStore.setFocus(null);
    setRoomFocus(focus);
    setSheet("battle");
  };
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

  // The compass, only while the tray is up (the arrows on its cards).
  const heading = useHeading(!parked && onScreen && screen.kind === "home" && !selected);
  const suggested = useMemo(
    () => suggestedId({ points, me, distanceOf: (p) => (fix ? distanceM(fix, p) : null) }),
    [points, me, fix],
  );

  useEffect(() => {
    let alive = true;
    void Promise.all([getPref(COACH_DONE_KEY), getPref(UNLOCKS_INTRODUCED_KEY)]).then(([done, intro]) => {
      if (!alive) return;
      setCoachDone(new Set(parseIdList(done)));
      setIntroduced(new Set(parseIdList(intro)));
    });
    return () => {
      alive = false;
    };
  }, []);

  // What the Warden has to show next. Nothing while a card, a sheet or a
  // challenge is up: one voice at a time (RoamHomeView.coachStep).
  const coachStep: CoachStep | null =
    coachDone && !parked && screen.kind === "home" && !selected && sheet === null && fix
      ? coachStepFor({
          me,
          playerName: gameStore.playerName(),
          hasStarter: points.some((p) => p.source === "starter"),
          hasSiege: points.some((p) => isSiege(p, me)),
          done: coachDone,
          introduced,
        })
      : null;
  const markCoach = (step: CoachStep) => {
    const u = unlockOfStep(step.id);
    if (u) {
      const next = new Set(introduced).add(u);
      setIntroduced(next);
      void setPref(UNLOCKS_INTRODUCED_KEY, JSON.stringify([...next]));
    }
    const done = new Set(coachDone ?? []).add(step.id);
    setCoachDone(done);
    void setPref(COACH_DONE_KEY, JSON.stringify([...done]));
  };
  const coachAct = (step: CoachStep) => {
    if (step.id === "first-shrine") {
      const starter = points.find((p) => p.source === "starter");
      if (starter) setSelectedId(starter.id);
      return;
    }
    markCoach(step);
    const u = unlockOfStep(step.id);
    if (u === "war") setSheet("war");
    else if (u === "relics") setSheet("relics");
    else if (u === "battle") openBattle(null);
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

  // The legend is written while they read the card (RoamHomeView .onChange(of: selected)).
  const selectedKey = selected?.id ?? null;
  useEffect(() => {
    if (!selected) return;
    let alive = true;
    const id = selected.id;
    void wardenVoice.line(legendMoment(ctx(), selected), 8000).then((text) => {
      if (alive) setLegendOf({ id, text });
    });
    return () => {
      alive = false;
    };
  }, [selectedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // A quiet step-counter reading each time the game comes to the front (no
  // prompt, no network), so the week's walking is split between weeks well.
  useEffect(() => {
    if (!parked) void noteStepsOnPhone();
  }, [parked]);

  // Cooldowns run out and the war moves while the phone sits still: a map
  // that only updates on a step goes stale on a bench (every 60 s).
  useEffect(() => {
    if (parked) return;
    const t = setInterval(() => void gameStore.refreshPoints(true), 60000);
    return () => clearInterval(t);
  }, [parked]);

  // Now and then, the best next move: shown, and put away after 12 s.
  const quietNudge = !parked && screen.kind === "home" && !selected && !coachStep && me?.tutorial_done === true;
  useEffect(() => {
    if (!quietNudge) return;
    let hide: ReturnType<typeof setTimeout> | null = null;
    const nudge = () => {
      if (wardenVoice.get()) return;
      const s = gameStore.get();
      const m = nudgeMoment(ctx(), s.fix, s.points, gameStore.reach(), s.war);
      if (!m) return;
      wardenVoice
        .speak(m, NUDGE_SHOWN_MS)
        .then(() => {
          hide = setTimeout(() => {
            if (wardenVoice.get()?.moment === "nudge") wardenVoice.quiet();
          }, NUDGE_SHOWN_MS);
        })
        .catch(() => {});
    };
    const first = setTimeout(nudge, FIRST_NUDGE_MS);
    const t = setInterval(nudge, NUDGE_EVERY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(t);
      if (hide) clearTimeout(hide);
    };
  }, [quietNudge, ctx]);

  // Android Back inside the game: close what is open first; on the map, the
  // pager's own handler takes it (back to the chat).
  useEffect(() => {
    // Only while the game is the page showing: the game stays mounted (warm)
    // behind the chat, and Back there is the chat's. RoomScreen takes Back
    // itself (it asks before leaving a fight); a sheet's own card or editor
    // takes it before this (the last handler added runs first).
    if (parked || !onScreen || screen.kind === "room") return;
    const open = screen.kind !== "home" || sheet !== null || selected !== null;
    if (!open) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (sheet) setSheet(null);
      // A challenge in progress asks before it is left.
      else if (screen.kind === "encounter" && encounterGuard.current) return encounterGuard.current();
      else if (screen.kind === "siege" && siegeGuard.current) return siegeGuard.current();
      else if (screen.kind !== "home") setScreen({ kind: "home" });
      else closeSheet();
      return true;
    });
    return () => sub.remove();
  }, [parked, onScreen, screen.kind, sheet, selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const home = () => {
    setSelectedId(null);
    setScreen({ kind: "home" });
  };

  const play = (p: QuestPoint) => {
    setSelectedId(null);
    gameStore.setFocus(null);
    // A boss first: the server would refuse it as a point duel (RoamHomeView.swift 239-255).
    if (p.source === "raid") setScreen(raidPlaysAsDuel(p, me) ? { kind: "duel", point: p, mode: "raid" } : { kind: "raid", point: p });
    // A rival's hold: a fight with its Guardian when the server says so, the quiz Siege otherwise.
    else if (isSiege(p, me)) setScreen(siegePlaysAsDuel(me) ? { kind: "duel", point: p, mode: "siege" } : { kind: "siege", point: p });
    else setScreen(gameStore.playsAsDuel(p) ? { kind: "duel", point: p, mode: "point" } : { kind: "encounter", point: p });
  };

  const share = (p: QuestPoint) => {
    emitGameEvent("onShareToChat", {
      type: p.source === "raid" ? "raid" : gameStore.playsAsDuel(p) ? "duel" : "shrine",
      targetId: p.id,
      place: p.name,
      lat: p.lat,
      lng: p.lng,
    });
  };

  if (!state.session || (!fontsReady && !fontsError)) {
    return <View style={styles.root} />;
  }
  if (gameStore.needsOnboarding) {
    return <Onboarding suggestedName={chatName} />;
  }

  const dailiesLeft = me?.dailies.filter((d) => !d.done).length ?? 0;
  const codexOpen = unlocked(me, "codex");
  const codexCount = state.codex?.counts.total ?? null;
  // The rest of the game, under More (RoamHomeView.swift moreTiles), as levels unlock it.
  const moreTiles: MoreTile[] = [];
  if (unlocked(me, "war")) {
    moreTiles.push({ id: "war", icon: "flag", color, title: "Faction war", onPress: () => setSheet("war") });
  }
  if (battleOpen) {
    moreTiles.push({ id: "battle", icon: "people-circle", color: GP.berry, title: "Rooms", badge: rooms.nearby.length || null, onPress: () => openBattle(null) });
  }
  if (unlocked(me, "friends")) {
    moreTiles.push({
      id: "friends",
      icon: "people",
      color: GP.berry,
      title: "Friends",
      onPress: () => setSheet("friends"),
      custom: (press) => <FriendsButton size={58} onPress={press} />,
    });
  }
  moreTiles.push({ id: "live", icon: "calendar", color: GP.navy, title: "Quest Hours", onPress: () => setSheet("events") });
  // The paid venue games in AR stay native on iOS (VenueEventsIsland.swift).
  if (venueEventsAvailable) {
    moreTiles.push({ id: "events", icon: "ticket", color: GP.navy, title: "Events", onPress: () => void openVenueEvents({ handle: gameStore.playerName() }) });
  }
  moreTiles.push({ id: "profile", icon: "person-circle", color: GP.skyDeep, title: "Profile", onPress: () => setSheet("profile") });
  const focusAway = focus && !focusId && focus.lat !== undefined && focus.lng !== undefined ? focus : null;
  const focusMissing = focus && focusId && !focusPoint ? focus : null;
  const showsRail = fix !== null && !selected && screen.kind === "home";
  const showBubble = said !== null && !coachStep && screen.kind === "home";

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
        rooms={battleOpen && screen.kind === "home" ? rooms.nearby : []}
        onRoom={(r) => openBattle(r.game_id)}
      />

      <TopBar me={me} profile={state.profile} name={gameStore.playerName()} color={color} onProfile={() => setSheet("profile")} onCoins={() => setSheet("coins")} />
      {!GAME_SERVER_IS_PRODUCTION ? <StagingBadge label={GAME_SERVER.includes("staging") ? "STAGING" : "TEST SERVER"} /> : null}
      {showsRail ? (
        <Rail
          dailiesLeft={dailiesLeft}
          codexCount={codexCount}
          showCodex={codexOpen}
          relics={unlocked(me, "relics") ? <RelicsButton onPress={() => setSheet("relics")} /> : undefined}
          onDailies={() => setSheet("dailies")}
          onCodex={() => setSheet("codex")}
          onMore={() => setSheet("more")}
          onRecentre={() => {
            recentre((n) => n + 1);
            void gameStore.refreshPoints(true);
          }}
        />
      ) : null}

      {/* Under the top bar, left of the rail: one column, as iOS's worldBanners. */}
      <View style={[styles.banners, { top: insets.top + 72, right: showsRail ? 84 : 14 }]} pointerEvents="box-none">
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
        {fix && screen.kind === "home" && unlocked(me, "raids") ? <RaidBanner points={nearby} fix={fix} onFight={(boss) => setSelectedId(boss.id)} /> : null}

        {focusAway || focusMissing ? (
          <FocusBanner
            place={(focusAway ?? focusMissing)?.place ?? "the invited spot"}
            lat={(focusAway ?? focusMissing)?.lat}
            lng={(focusAway ?? focusMissing)?.lng}
            onClose={() => gameStore.setFocus(null)}
          />
        ) : null}
      </View>

      {/* The lower half: the Warden's line, the radar and the Nearby tray (RoamHomeView.bottom). */}
      {!selected && screen.kind === "home" ? (
        <View style={[styles.bottom, { bottom: insets.bottom + 10 }]} pointerEvents="box-none">
          {showBubble ? <WardenBubble text={said.text} color={color} onClose={() => wardenVoice.quiet()} /> : null}
          {me?.tutorial_done && fix ? (
            <View style={{ paddingRight: 62 }}>
              <NearbyRadar points={nearby} fix={fix} inReach={gameStore.inReach} />
            </View>
          ) : null}
          <NearbyTray
            points={nearby}
            suggested={suggested}
            distanceOf={(p) => gameStore.distanceTo(p)}
            bearingOf={(p) => (fix ? relativeBearing(bearingDeg(fix, p), heading) : null)}
            inReach={gameStore.inReach}
            cooling={gameStore.isCooling}
            newCard={(p) => codexOpen && p.extra?.codex !== "owned"}
            onSelect={(p) => setSelectedId(p.id)}
          />
        </View>
      ) : null}

      {selected ? (
        <PointSheet
          point={selected}
          distance={gameStore.distanceTo(selected)}
          inReach={gameStore.inReach(selected)}
          cooling={gameStore.isCooling(selected)}
          factionName={gameStore.factionName}
          legend={legendOf?.id === selected.id ? legendOf.text : null}
          onPlay={() => play(selected)}
          onShare={() => share(selected)}
          onClose={closeSheet}
        />
      ) : null}

      {coachStep ? <CoachOverlay key={coachStep.id} step={coachStep} tint={color} onAction={() => coachAct(coachStep)} onLater={() => markCoach(coachStep)} /> : null}

      {sheet === "dailies" || sheet === "codex" || sheet === "war" ? (
        <Journal initial={sheet === "dailies" ? "today" : sheet} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === "more" ? <MoreSheet tiles={moreTiles} onClose={() => setSheet(null)} /> : null}
      {sheet === "events" ? <LiveCalendarSheet onClose={() => setSheet(null)} /> : null}
      {sheet === "friends" ? <FriendsSheet onClose={() => setSheet(null)} /> : null}
      {sheet === "relics" ? <RelicsSheet onClose={() => setSheet(null)} /> : null}
      {sheet === "coins" ? <CoinsSheet onClose={() => setSheet(null)} /> : null}
      {sheet === "profile" ? <ProfileSheet onClose={() => setSheet(null)} onCoins={() => setSheet("coins")} /> : null}
      {sheet === "battle" ? (
        <RoomSheet
          focusGameId={roomFocus}
          onClose={() => setSheet(null)}
          onEnter={(gameId) => {
            setSheet(null);
            setScreen({ kind: "room", gameId });
          }}
        />
      ) : null}

      {screen.kind === "encounter" ? (
        <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(160)} style={StyleSheet.absoluteFill}>
          <Encounter point={screen.point} onReward={(reward) => setScreen({ kind: "reward", reward })} onClose={home} />
        </Animated.View>
      ) : null}
      {screen.kind === "duel" ? (
        <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(160)} style={StyleSheet.absoluteFill}>
          <DuelScreen point={screen.point} mode={screen.mode} parked={parked} onClose={home} />
        </Animated.View>
      ) : null}
      {screen.kind === "raid" ? (
        <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(160)} style={StyleSheet.absoluteFill}>
          <RaidScreen point={screen.point} parked={parked} onClose={home} />
        </Animated.View>
      ) : null}
      {screen.kind === "siege" ? (
        <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(160)} style={StyleSheet.absoluteFill}>
          <SiegeScreen
            point={screen.point}
            parked={parked}
            onClose={home}
            onDone={(won) => {
              if (won) showBanner("Taken!", { subtitle: screen.point.name, color: realmColor(me?.faction), sound: "fanfare" });
            }}
          />
        </Animated.View>
      ) : null}
      {screen.kind === "room" ? (
        <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(160)} style={StyleSheet.absoluteFill}>
          <RoomScreen gameId={screen.gameId} onClose={home} />
        </Animated.View>
      ) : null}
      {screen.kind === "reward" ? (
        <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(160)} style={StyleSheet.absoluteFill}>
          <Reward reward={screen.reward} onDone={home} />
        </Animated.View>
      ) : null}

      {/* The big moments ("Guardian beaten!", "Quest done!"), over everything. */}
      <GameBannerHost top={insets.top + 150} />
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
  banners: { position: "absolute", left: 14, gap: 6, maxWidth: 560 },
  bottom: { position: "absolute", left: 0, right: 0, gap: 8 },
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
