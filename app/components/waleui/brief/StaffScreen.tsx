// The staff desk at a CosQuest event (13 Nov 2026; feature `venue_challenges`). A volunteer joins
// with the staff code the organiser gives them; their phone then shows:
//   Queue        challenges waiting at their event: the claim code big (the player shows theirs),
//                the player, the booth, the photo when there is one; Approve pays the player, Reject
//                can carry a note the player sees
//   Booth codes  each booth's code and its QR, so a staff phone held up at a booth works as the sign
// The queue checks back every few seconds. Signed by the staff member's own game key: the server
// decides who is staff, and never lets anyone approve their own challenge.
import { Image } from "expo-image";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import { QrCode } from "@/components/game/QrCode";
import {
  decideCompletion,
  fetchStaffEvents,
  fetchStaffQueue,
  isNotStaff,
  joinStaff,
  normaliseStationCode,
  photoUri,
  type QueueItem,
  showVenueChallenges,
  type StaffEvent,
  type StaffQueue,
  stationErrorText,
  stationLabel,
} from "@/features/game/briefFeatures";
import { QR_MAX_BYTES } from "@/features/game/qr";
import { gameStore } from "@/features/game/runtime";
import { router } from "expo-router";

import { T, W } from "../kit";
import { BigCode, BriefScreen, Card, Chip, Field, GhostButton, Label, Loading, NotOpen, P, PinkButton, Say, usePoll, useBriefFlags } from "./briefKit";

export default function StaffScreen({ gameId }: { gameId?: string | null }) {
  const flags = useBriefFlags();
  const on = showVenueChallenges(flags);
  return (
    <BriefScreen title="Staff desk" kicker="Event staff" testID="brief-staff" icon={require("@/assets/images/waleui/icon_trophy.png")}>
      {flags === null ? <Loading /> : !on ? <NotOpen what="The staff desk" testID="brief-staff-off" /> : gameId ? <Desk gameId={gameId} /> : <StaffEvents />}
    </BriefScreen>
  );
}

function StaffEvents() {
  const [events, setEvents] = useState<StaffEvent[] | null>(null);
  useEffect(() => {
    void fetchStaffEvents(gameStore.client)
      .then(setEvents)
      .catch(() => setEvents([]));
  }, []);
  if (events === null) return <Loading />;
  return (
    <Card>
      <Label>Your events</Label>
      {events.length === 0 ? <P color={W.inkSoft}>{"You aren't staff at any event. Open the event and join with its staff code."}</P> : null}
      {events.map((e) => (
        <GhostButton key={e.game_id} label={`${e.title}${e.pending ? ` (${e.pending})` : ""}`} onPress={() => router.replace({ pathname: "/wale/staff", params: { game: e.game_id } })} />
      ))}
    </Card>
  );
}

function Desk({ gameId }: { gameId: string }) {
  const [queue, setQueue] = useState<StaffQueue | null>(null);
  const [notStaff, setNotStaff] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"queue" | "codes">("queue");

  const load = useCallback(async () => {
    try {
      setQueue(await fetchStaffQueue(gameStore.client, gameId));
      setNotStaff(false);
      setErr(null);
    } catch (e) {
      if (isNotStaff(e)) setNotStaff(true);
      else setErr(stationErrorText(e));
    }
  }, [gameId]);

  useEffect(() => {
    void load();
  }, [load]);
  usePoll(() => void load(), 8000, !!queue && tab === "queue");

  if (notStaff) return <JoinStaff gameId={gameId} onJoined={() => void load()} />;
  if (!queue) return err ? <Card><Say text={err} /><GhostButton label="Try again" onPress={() => void load()} /></Card> : <Loading />;
  return (
    <>
      <Card tone="solid">
        <T size={16} weight={700} lines={2}>
          {queue.title}
        </T>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <GhostButton label={`Queue (${queue.completions.length})`} onPress={() => setTab("queue")} testID="brief-staff-tab-queue" icon={tab === "queue" ? <Chip text="on" tone="pink" /> : null} />
          </View>
          <View style={{ flex: 1 }}>
            <GhostButton label="Booth codes" onPress={() => setTab("codes")} testID="brief-staff-tab-codes" icon={tab === "codes" ? <Chip text="on" tone="pink" /> : null} />
          </View>
        </View>
      </Card>
      {tab === "queue" ? (
        queue.completions.length === 0 ? (
          <Card>
            <P color={W.inkSoft}>Nobody is waiting. New challenges show up here by themselves.</P>
          </Card>
        ) : (
          queue.completions.map((c) => <QueueCard key={String(c.id)} gameId={gameId} item={c} onDecided={() => void load()} />)
        )
      ) : queue.stations.length === 0 ? (
        <Card>
          <P color={W.inkSoft}>This event has no booths with a code.</P>
        </Card>
      ) : (
        queue.stations.map((s) => (
          <Card key={s.id} tone="solid" testID={`brief-staff-booth-${s.id}`}>
            <Label>{stationLabel(s.station_type)}</Label>
            <T size={16} weight={700} lines={2}>
              {s.name}
            </T>
            {s.qr_text && new TextEncoder().encode(s.qr_text).length <= QR_MAX_BYTES ? <QrCode text={s.qr_text} size={220} /> : null}
            <BigCode code={s.code} />
            <P color={W.inkSoft} align="center">
              Players scan this with their camera, or type the code.
            </P>
          </Card>
        ))
      )}
    </>
  );
}

function QueueCard({ gameId, item, onDecided }: { gameId: string; item: QueueItem; onDecided: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"yes" | "no" | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const uri = photoUri(gameStore.client.baseUrl, item.photo_url);
  const decide = async (approve: boolean) => {
    setBusy(approve ? "yes" : "no");
    setSaid(null);
    try {
      await decideCompletion(gameStore.client, gameId, item.id, approve, note);
      onDecided();
    } catch (e) {
      setSaid(stationErrorText(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card tone="solid" testID={`brief-staff-item-${item.id}`}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <BigCode code={item.claim_code} size={30} />
        {item.attempts && item.attempts > 1 ? <Chip text={`Try ${item.attempts}`} tone="purple" /> : null}
      </View>
      <T size={15} weight={700}>
        {item.handle}
      </T>
      <P color={W.inkSoft}>{`${item.station_name} · ${stationLabel(item.station_type)}${item.qr_ok ? " · code scanned" : ""}`}</P>
      {uri ? <Image source={{ uri }} style={{ width: "100%", aspectRatio: 4 / 3, borderRadius: 10, backgroundColor: W.band }} contentFit="cover" accessibilityLabel={`Photo from ${item.handle}`} /> : null}
      <Field value={note} onChangeText={setNote} placeholder="Note for the player (optional)" autoCapitalize="sentences" maxLength={200} />
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <PinkButton label="Approve" tone="green" onPress={() => void decide(true)} busy={busy === "yes"} disabled={!!busy} testID={`brief-staff-item-${item.id}-approve`} />
        </View>
        <View style={{ flex: 1 }}>
          <PinkButton label="Reject" tone="ink" onPress={() => void decide(false)} busy={busy === "no"} disabled={!!busy} testID={`brief-staff-item-${item.id}-reject`} />
        </View>
      </View>
      <Say text={said} />
    </Card>
  );
}

function JoinStaff({ gameId, onJoined }: { gameId: string; onJoined: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const join = async () => {
    setBusy(true);
    setSaid(null);
    try {
      await joinStaff(gameStore.client, gameId, code);
      onJoined();
    } catch (e) {
      const reason = e instanceof Error ? e.message : "";
      setSaid(reason === "bad_code" ? "That staff code isn't right for this event." : stationErrorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card testID="brief-staff-join">
      <Label>Join as staff</Label>
      <P color={W.inkSoft}>{"The event's organiser gives staff a code. Put it in to see the booth queue on this phone."}</P>
      <Field value={code} onChangeText={(s) => setCode(normaliseStationCode(s))} placeholder="STAFF CODE" big maxLength={8} testID="brief-staff-join-field" />
      <PinkButton label="Join" onPress={() => void join()} busy={busy} disabled={code.length < 4} testID="brief-staff-join-go" />
      <Say text={said} />
    </Card>
  );
}
