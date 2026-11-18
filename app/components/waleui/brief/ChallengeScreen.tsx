// A booth challenge at a CosQuest event (13 Nov 2026; feature `venue_challenges`): a carnival
// challenge or a costume check. At the booth the player scans its QR with the phone's camera (which
// opens this screen with the code filled in) or types the code printed under it, does the challenge,
// adds a photo when the booth takes one, and taps Done. Event staff then approve it on their own
// phone; until then the screen shows a claim code, big, to show them, and checks back every few
// seconds. A rejected challenge can be tried again while the server allows it.
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import {
  completeStation,
  fetchMyStations,
  fetchStations,
  isPuzzleStation,
  type MyCompletion,
  needFrom,
  normaliseStationCode,
  photoFits,
  showVenueChallenges,
  type Station,
  stationErrorText,
  stationLabel,
  stationStep,
  uploadStationPhoto,
  wantsCode,
  wantsPhoto,
} from "@/features/game/briefFeatures";
import { gameStore } from "@/features/game/runtime";

import { W } from "../kit";
import { BigCode, BriefScreen, Card, Chip, Field, GhostButton, Label, Loading, NotOpen, P, PinkButton, Say, spotNow, useBriefFlags, usePoll } from "./briefKit";

type Photo = { uri: string; b64: string };

/** A camera photo as a JPEG about 1080 px wide, small enough for the server (600 KB). */
async function takePhoto(): Promise<Photo | "denied" | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return "denied";
  const shot = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8 });
  if (shot.canceled || !shot.assets?.[0]) return null;
  const a = shot.assets[0];
  for (const [width, compress] of [
    [1080, 0.6],
    [900, 0.45],
    [720, 0.35],
  ] as const) {
    const out = await ImageManipulator.manipulateAsync(a.uri, [{ resize: { width: Math.min(a.width || width, width) } }], { compress, format: ImageManipulator.SaveFormat.JPEG, base64: true });
    if (out.base64 && photoFits(out.base64)) return { uri: out.uri, b64: out.base64 };
  }
  return null;
}

export default function ChallengeScreen({ gameId, stationId, initialCode }: { gameId: string; stationId: string; initialCode?: string | null }) {
  const flags = useBriefFlags();
  const on = showVenueChallenges(flags);
  const [station, setStation] = useState<Station | null | undefined>(undefined);
  const [mine, setMine] = useState<MyCompletion | null>(null);
  const [code, setCode] = useState(normaliseStationCode(initialCode));
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ text: string; good: boolean } | null>(null);
  const [need, setNeed] = useState<"station_code" | "photo" | null>(null);
  const [again, setAgain] = useState(false);

  const loadMine = useCallback(async () => {
    try {
      const all = await fetchMyStations(gameStore.client, gameId);
      setMine(all.find((c) => c.station_id === stationId) ?? null);
    } catch {
      // keep what we have
    }
  }, [gameId, stationId]);

  useEffect(() => {
    if (!on) return;
    void (async () => {
      try {
        const all = await fetchStations(gameStore.client, gameId);
        setStation(all.find((s) => s.id === stationId) ?? null);
      } catch (e) {
        setStation(null);
        setSaid({ text: stationErrorText(e), good: false });
      }
      await loadMine();
    })();
  }, [on, gameId, stationId, loadMine]);

  const step = again ? "start" : stationStep(mine);
  usePoll(() => void loadMine(), 5000, on && step === "pending");

  // A puzzle station has its own screen.
  useEffect(() => {
    if (station && isPuzzleStation(station)) router.replace({ pathname: "/wale/puzzle", params: { game: gameId, station: stationId } });
  }, [station, gameId, stationId]);

  const snap = async () => {
    setSaid(null);
    const got = await takePhoto();
    if (got === "denied") setSaid({ text: "Camera access is needed to add a photo.", good: false });
    else if (got) {
      setPhoto(got);
      if (need === "photo") setNeed(null);
    }
  };

  const done = async () => {
    if (!station) return;
    setBusy(true);
    setSaid(null);
    try {
      const at = await spotNow();
      if (!at) throw new Error("location");
      const photoId = photo ? (await uploadStationPhoto(gameStore.client, gameId, stationId, photo.b64)).photo_id : null;
      const r = await completeStation(gameStore.client, gameId, stationId, at, { stationCode: code, photoId });
      setAgain(false);
      setNeed(null);
      setMine({ station_id: stationId, status: r.status, claim_code: r.claim_code ?? null, xp: r.xp, quest_points: r.quest_points, attempts: r.attempts ?? null, can_retry: false });
      if (r.status === "verified") setSaid({ text: `+${r.xp} XP`, good: true });
    } catch (e) {
      setNeed(needFrom(e));
      setSaid({ text: e instanceof Error && e.message === "location" ? "Turn on location: the booth checks you are there." : stationErrorText(e), good: false });
    } finally {
      setBusy(false);
    }
  };

  const title = station?.name ?? "Challenge";
  return (
    <BriefScreen title={title} kicker={station ? stationLabel(station.station_type) : "Event challenge"} testID="brief-challenge" icon={require("@/assets/images/waleui/icon_trophy.png")}>
      {flags === null ? (
        <Loading />
      ) : !on ? (
        <NotOpen what="Booth challenges" testID="brief-challenge-off" />
      ) : station === undefined ? (
        <Loading />
      ) : station === null ? (
        <Card>
          <Say text={said?.text ?? "This booth isn't part of the event any more."} />
          <GhostButton label="Open the event" onPress={() => router.push({ pathname: "/wale/event", params: { game: gameId } })} />
        </Card>
      ) : step === "pending" ? (
        <Card tone="solid" testID="brief-challenge-pending">
          <Label>Show this to the staff</Label>
          <BigCode code={mine?.claim_code ?? "----"} size={44} testID="brief-challenge-claim" />
          <P color={W.inkSoft} align="center">
            Staff at the booth will check it on their phone. This updates by itself.
          </P>
          <Chip text="Waiting for staff" tone="pink" />
        </Card>
      ) : step === "done" ? (
        <Card tone="solid" testID="brief-challenge-done">
          <Chip text="Done" tone="green" />
          <P size={18} weight={700}>{`+${mine?.xp ?? station.xp} XP`}</P>
          <P color={W.inkSoft}>{`${station.name} is complete${mine?.quest_points ? `, ${mine.quest_points} quest points for this event` : ""}.`}</P>
          <GhostButton label="Back to the event" onPress={() => router.replace({ pathname: "/wale/event", params: { game: gameId } })} />
        </Card>
      ) : step === "rejected" ? (
        <Card testID="brief-challenge-rejected">
          <Chip text="Not accepted" tone="purple" />
          <P>{mine?.note ? `Staff said: ${mine.note}` : "Staff didn't accept this one."}</P>
          <P color={W.inkSoft}>No more tries are left for this booth.</P>
        </Card>
      ) : (
        <>
          {step === "retry" ? (
            <Card tone="pink" testID="brief-challenge-retry">
              <P weight={600}>{mine?.note ? `Staff said: ${mine.note}` : "Staff didn't accept that try."}</P>
              <P color={W.inkSoft}>You can try this booth again.</P>
              {!again ? <GhostButton label="Try again" onPress={() => setAgain(true)} testID="brief-challenge-again" /> : null}
            </Card>
          ) : null}
          {step === "start" ? (
            <>
              <Card testID="brief-challenge-how">
                <Label>{`${station.xp} XP`}</Label>
                <P>{station.instructions || (station.station_type === "costume" ? "Show your costume to the staff at this booth." : "Do the challenge at this booth, then tap Done.")}</P>
              </Card>
              {wantsCode(station) ? (
                <Card testID="brief-challenge-code" tone={need === "station_code" ? "pink" : "glass"}>
                  <Label>{station.qr === "required" ? "Booth code" : "Booth code (if there is one)"}</Label>
                  <P color={W.inkSoft}>Scan the QR at the booth with your camera, or type the code under it.</P>
                  <Field value={code} onChangeText={(s) => setCode(normaliseStationCode(s))} placeholder="BOOTH CODE" big maxLength={8} testID="brief-challenge-code-field" />
                </Card>
              ) : null}
              {wantsPhoto(station) ? (
                <Card testID="brief-challenge-photo" tone={need === "photo" ? "pink" : "glass"}>
                  <Label>{station.photo === "required" ? "Photo" : "Photo (optional)"}</Label>
                  <P color={W.inkSoft}>{station.station_type === "costume" ? "A photo of your costume helps the staff." : "A photo helps the staff check it."} Only event staff see it.</P>
                  {photo ? <Image source={{ uri: photo.uri }} style={{ width: "100%", aspectRatio: 4 / 3, borderRadius: 10 }} contentFit="cover" accessibilityLabel="Your photo" /> : null}
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <GhostButton label={photo ? "Retake" : "Take photo"} onPress={() => void snap()} testID="brief-challenge-photo-take" />
                    </View>
                    {photo ? (
                      <View style={{ flex: 1 }}>
                        <GhostButton label="Remove" onPress={() => setPhoto(null)} />
                      </View>
                    ) : null}
                  </View>
                </Card>
              ) : null}
              <PinkButton label="Done" onPress={() => void done()} busy={busy} disabled={(station.qr === "required" && code.length < 4) || (station.photo === "required" && !photo)} testID="brief-challenge-done-button" />
            </>
          ) : null}
          <Say text={said?.text ?? null} good={said?.good} testID="brief-challenge-said" />
          {said && !said.good ? <GhostButton label="Open the event" onPress={() => router.push({ pathname: "/wale/event", params: { game: gameId } })} /> : null}
        </>
      )}
    </BriefScreen>
  );
}
