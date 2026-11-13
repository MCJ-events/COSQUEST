// A CosQuest event in the app (13 Nov 2026; feature `stations_v2`, with `venue_challenges` and
// `comic_puzzles` for the booth and puzzle stations). The app had no screen for a city event's
// stations: Rooms are the only Events games it showed. This is the minimal one:
//   no game:   events near you (GET /v1/games), and the events you are staff at
//   a game:    join and check in at the venue, then its stations with your status at each:
//              a check-in point completes here, a booth opens the challenge, a puzzle opens the puzzle.
// Reached from Wale's Home menu (EVENTS), cosquest://event?game=<id> and a booth's QR.
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";

import {
  completeStation,
  eventWhenText,
  fetchMyStations,
  fetchNearbyEvents,
  fetchStaffEvents,
  fetchStations,
  isPuzzleStation,
  isStaffStation,
  type MyCompletion,
  type NearbyEvent,
  showEvents,
  showPuzzles,
  showVenueChallenges,
  type StaffEvent,
  type Station,
  stationErrorText,
  stationLabel,
  stationStep,
  stepText,
  checkIn,
} from "@/features/game/briefFeatures";
import { cleanHandle, gameTerms, type GameTerms, joinGame } from "@/features/game/rooms";
import { gameStore, useGame } from "@/features/game/runtime";

import { LineIcon, T, W, glass } from "../kit";
import { BriefScreen, Card, Chip, GhostButton, Label, Loading, NotOpen, P, PinkButton, Say, spotNow, useBriefFlags } from "./briefKit";

/** Events checked in at this session (the server remembers too; this only saves a tap). */
const checkedIn = new Set<string>();

export default function EventScreen({ gameId }: { gameId?: string | null }) {
  const flags = useBriefFlags();
  const on = showEvents(flags);
  return (
    <BriefScreen title={gameId ? "Event" : "Events"} kicker="CosQuest" testID="brief-event">
      {flags === null ? <Loading /> : !on ? <NotOpen what="Event stations" testID="brief-event-off" /> : gameId ? <OneEvent gameId={gameId} /> : <EventList />}
    </BriefScreen>
  );
}

function EventList() {
  const [events, setEvents] = useState<NearbyEvent[] | null>(null);
  const [staff, setStaff] = useState<StaffEvent[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        const at = await spotNow();
        setEvents(await fetchNearbyEvents(gameStore.client, at));
      } catch (e) {
        setErr(stationErrorText(e));
        setEvents([]);
      }
      try {
        setStaff(await fetchStaffEvents(gameStore.client));
      } catch {
        setStaff([]);
      }
    })();
  }, []);
  return (
    <>
      {staff.length ? (
        <Card tone="pink" testID="brief-event-staff">
          <Label>You are staff at</Label>
          {staff.map((s) => (
            <Row key={s.game_id} title={s.title} sub={s.pending ? `${s.pending} waiting for you` : "Nothing waiting"} onPress={() => router.push({ pathname: "/wale/staff", params: { game: s.game_id } })} chip={s.pending ? { text: String(s.pending), tone: "pink" } : null} />
          ))}
        </Card>
      ) : null}
      {events === null ? (
        <Loading text="Finding events near you" />
      ) : (
        <Card testID="brief-event-list">
          <Label>Near you</Label>
          <Say text={err} />
          {events.length === 0 ? <P color={W.inkSoft}>No CosQuest events near you right now.</P> : null}
          {events.map((e) => (
            <Row key={e.game_id} title={e.title} sub={`${eventWhenText(e)}${typeof e.distance_m === "number" ? ` · ${(e.distance_m / 1000).toFixed(1)} km` : ""}`} onPress={() => router.push({ pathname: "/wale/event", params: { game: e.game_id } })} chip={e.status === "live" ? { text: "Live", tone: "green" } : null} />
          ))}
        </Card>
      )}
    </>
  );
}

function Row({ title, sub, onPress, chip, testID }: { title: string; sub?: string; onPress: () => void; chip?: { text: string; tone: "slate" | "pink" | "green" | "purple" } | null; testID?: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} testID={testID} style={({ pressed }) => [glass(10, "rgba(255,255,255,0.55)"), { padding: 12, flexDirection: "row", alignItems: "center", gap: 10, opacity: pressed ? 0.7 : 1 }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <T size={14} weight={700} lines={2}>
          {title}
        </T>
        {sub ? (
          <T size={11} weight={400} color={W.inkSoft} lines={2}>
            {sub}
          </T>
        ) : null}
      </View>
      {chip ? <Chip text={chip.text} tone={chip.tone} /> : null}
      <LineIcon name="chevron-right" size={18} color={W.inkSoft} />
    </Pressable>
  );
}

function OneEvent({ gameId }: { gameId: string }) {
  const flags = useBriefFlags();
  const handle = useGame((s) => s.profile?.handle ?? s.me?.handle ?? null);
  const [terms, setTerms] = useState<GameTerms | null>(null);
  const [stations, setStations] = useState<Station[] | null>(null);
  const [mine, setMine] = useState<MyCompletion[]>([]);
  const [inEvent, setInEvent] = useState(checkedIn.has(gameId));
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<{ text: string; good: boolean } | null>(null);

  const load = useCallback(async () => {
    try {
      setTerms(await gameTerms(gameStore.client, gameId));
    } catch (e) {
      setSaid({ text: stationErrorText(e), good: false });
    }
    try {
      setStations(await fetchStations(gameStore.client, gameId));
    } catch {
      setStations([]);
    }
    try {
      setMine(await fetchMyStations(gameStore.client, gameId));
    } catch {
      // signed out or the route is off: no statuses
    }
  }, [gameId]);

  useEffect(() => {
    void load();
  }, [load]);

  const joinAndCheckIn = async () => {
    setBusy("checkin");
    setSaid(null);
    try {
      await joinGame(gameStore.client, gameId, cleanHandle(handle), null);
      const at = await spotNow();
      if (!at) throw new Error("location");
      const r = await checkIn(gameStore.client, gameId, at);
      checkedIn.add(gameId);
      setInEvent(true);
      setSaid({ text: r.already ? "You're checked in." : `Checked in at ${r.title || "the event"}.`, good: true });
    } catch (e) {
      setSaid({ text: e instanceof Error && e.message === "location" ? "Turn on location to check in at the venue." : stationErrorText(e), good: false });
    } finally {
      setBusy(null);
    }
  };

  const completeHere = async (s: Station) => {
    setBusy(s.id);
    setSaid(null);
    try {
      const at = await spotNow();
      if (!at) throw new Error("location");
      const r = await completeStation(gameStore.client, gameId, s.id, at);
      setSaid({ text: r.status === "verified" ? `${s.name}: +${r.xp} XP` : `${s.name}: ${r.status}`, good: r.status === "verified" });
      void load();
    } catch (e) {
      setSaid({ text: e instanceof Error && e.message === "location" ? "Turn on location to complete a station." : stationErrorText(e), good: false });
    } finally {
      setBusy(null);
    }
  };

  const open = (s: Station) => {
    if (isPuzzleStation(s)) router.push({ pathname: "/wale/puzzle", params: { game: gameId, station: s.id } });
    else router.push({ pathname: "/wale/challenge", params: { game: gameId, station: s.id } });
  };

  // Booths need venue challenges on, puzzles need comic puzzles on; with them off those stations
  // still show (the server lists them) but say they are not open.
  const playable = (s: Station) => (isPuzzleStation(s) ? showPuzzles(flags) : isStaffStation(s) ? showVenueChallenges(flags) : true);
  const byId = new Map(mine.map((m) => [m.station_id, m]));

  return (
    <>
      <Card tone="solid" testID="brief-event-head">
        <T size={18} weight={700} lines={2}>
          {terms?.title ?? "CosQuest event"}
        </T>
        {terms ? <P color={W.inkSoft}>{eventWhenText({ status: terms.status, starts_at: terms.starts_at })}</P> : null}
        {inEvent ? (
          <Chip text="Checked in" tone="green" />
        ) : (
          <PinkButton label="Join and check in" onPress={() => void joinAndCheckIn()} busy={busy === "checkin"} disabled={terms?.status !== undefined && terms.status !== "live"} testID="brief-event-checkin" />
        )}
        <Say text={said?.text ?? null} good={said?.good} testID="brief-event-said" />
      </Card>

      <Card testID="brief-event-stations">
        <Label>Stations</Label>
        {stations === null ? <P color={W.inkSoft}>Loading</P> : stations.length === 0 ? <P color={W.inkSoft}>No stations at this event yet.</P> : null}
        {(stations ?? []).map((s) => {
          const step = stationStep(byId.get(s.id));
          const chip = stepText(step);
          const can = playable(s);
          const sub = `${stationLabel(s.station_type)} · ${s.xp} XP${can ? "" : " · not open yet"}`;
          if (!isPuzzleStation(s) && !isStaffStation(s)) {
            return (
              <View key={s.id} style={[glass(10, "rgba(255,255,255,0.55)"), { padding: 12, gap: 8 }]} testID={`brief-event-station-${s.id}`}>
                <T size={14} weight={700} lines={2}>
                  {s.name}
                </T>
                <T size={11} weight={400} color={W.inkSoft} lines={2}>
                  {sub}
                </T>
                {step === "done" ? <Chip text={chip} tone="green" /> : <GhostButton label="I'm here" onPress={() => void completeHere(s)} disabled={!inEvent || busy === s.id} testID={`brief-event-station-${s.id}-here`} />}
              </View>
            );
          }
          return <Row key={s.id} title={s.name} sub={sub} onPress={() => (can ? open(s) : setSaid({ text: `${stationLabel(s.station_type)}s aren't open yet.`, good: false }))} chip={chip ? { text: chip, tone: step === "done" ? "green" : step === "pending" ? "pink" : "purple" } : null} testID={`brief-event-station-${s.id}`} />;
        })}
      </Card>

      {showVenueChallenges(flags) ? <GhostButton label="Event staff" onPress={() => router.push({ pathname: "/wale/staff", params: { game: gameId } })} testID="brief-event-staff-link" /> : null}
    </>
  );
}
