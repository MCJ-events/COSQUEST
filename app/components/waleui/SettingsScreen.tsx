// Wale's Settings (Figma "CosQuest · Settings mobile", 430 x 960; added to the
// file on 11 Nov): Sounds and Music sliders, three switches, Language, nine
// link buttons and the build line.
//
// Wired to what exists: Haptic feedback is the game's own haptics switch
// (components/game/prefs.ts); Help & Support, Privacy Policy, Terms of
// Service, Delete My Account and Manage Consent open the app's own screens.
// Sounds, Music, Locked movement control and Personal offers have nothing
// behind them in the app yet, so they are remembered on the phone and marked
// in the screens README; the buttons with no page say so when tapped.
//
// His frame draws each slider's pink fill running past the thumb. A slider
// cannot work that way, so the fill ends at the thumb here.
import * as Application from "expo-application";
import Constants from "expo-constants";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { PanResponder, View } from "react-native";

import { setHapticsOn, useHapticsOn } from "@/components/game/prefs";
import { getPref, setPref } from "@/utils/prefsStorage";

import { back, notBuiltYet } from "./go";
import { At, DesignCanvas, LineIcon, T, Tap, W, glass } from "./kit";

const FW = 430;
const TRACK_X = 24;
const TRACK_W = 381.6;

/** A small on-phone setting with nothing behind it yet. */
function useLocalPref(key: string, initial: string): [string, (v: string) => void] {
  const [v, setV] = useState(initial);
  useEffect(() => {
    let live = true;
    getPref(key)
      .then((got) => {
        if (live && got !== null) setV(got);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [key]);
  return [
    v,
    (next: string) => {
      setV(next);
      setPref(key, next).catch(() => {});
    },
  ];
}

function Slider({ y, value, onChange, label, testID }: { y: number; value: number; onChange: (v: number) => void; label: string; testID: string }) {
  const start = useRef(value);
  const latest = useRef(value);
  latest.current = value;
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        start.current = latest.current;
      },
      onPanResponderMove: (_e, g) => onChange(Math.max(0, Math.min(1, start.current + g.dx / TRACK_W))),
    }),
  ).current;
  const tx = TRACK_X + value * (TRACK_W - 22);
  return (
    <>
      <At x={TRACK_X} y={y - 4} w={TRACK_W} h={8} style={{ borderRadius: 4, backgroundColor: "#C5D9E3", overflow: "hidden" }} testID={`${testID}-track`}>
        <View style={{ width: tx - TRACK_X + 11, height: 8, backgroundColor: W.pink }} />
      </At>
      <View
        {...pan.panHandlers}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}
        testID={`${testID}-thumb`}
        style={{ position: "absolute", left: tx, top: y - 14.5, width: 22, height: 29, borderRadius: 6, backgroundColor: "#FFFFFF", borderWidth: 2, borderColor: W.pink }}
      />
    </>
  );
}

function Switch({ y, on, onChange, label, testID }: { y: number; on: boolean; onChange: (v: boolean) => void; label: string; testID: string }) {
  return (
    <Tap x={348.75} y={y} w={57} h={36.5} label={label} selected={on} onPress={() => onChange(!on)} style={{ borderRadius: 18, backgroundColor: on ? W.pinkDeep : "rgba(255,255,255,0.35)", flexDirection: on ? "row" : "row-reverse", justifyContent: "space-between", paddingLeft: on ? 7 : 8, paddingRight: on ? 7 : 5 }} testID={testID}>
      <View style={{ width: 18, height: 25, borderRadius: 9, backgroundColor: on ? "#FFFFFF" : "#587482" }} />
      <T size={9} weight={700} color={on ? "#FFFFFF" : W.ink} style={{ lineHeight: 12 }}>
        {on ? "On" : "Off"}
      </T>
    </Tap>
  );
}

const LINKS: { id: string; label: string; go: () => void }[] = [
  { id: "help", label: "Help & Support", go: () => router.push("/help-support") },
  { id: "privacy", label: "Privacy Policy", go: () => router.push("/legal/privacy") },
  { id: "terms", label: "Terms of Service", go: () => router.push("/legal/terms") },
  { id: "controls", label: "Adjust Controls", go: () => notBuiltYet("Adjust Controls") },
  { id: "parents", label: "Parent’s Guide", go: () => notBuiltYet("The Parent’s Guide") },
  { id: "delete", label: "Delete My Account", go: () => router.push("/delete-account") },
  { id: "credits", label: "Credits", go: () => notBuiltYet("Credits") },
  { id: "licenses", label: "Third Party Licenses", go: () => notBuiltYet("Third Party Licenses") },
  { id: "consent", label: "Manage Consent", go: () => router.push("/privacy-visibility") },
];

export default function SettingsScreen() {
  const haptics = useHapticsOn();
  const [sounds, setSounds] = useLocalPref("wale.settings.sounds", "0.61");
  const [music, setMusic] = useLocalPref("wale.settings.music", "0.84");
  const [locked, setLocked] = useLocalPref("wale.settings.lockedMove", "0");
  const [offers, setOffers] = useLocalPref("wale.settings.offers", "1");
  const build = `${Constants.expoConfig?.version ?? "1.0.0"}${Application.nativeBuildVersion ? `.${Application.nativeBuildVersion}` : ""}`;
  return (
    <DesignCanvas width={FW} height={960} colors={["#B5D9E6", "#E6F2F8", "#D2E8F2"]} horizontal testID="wale-settings">
      <At x={24} y={30}>
        <T size={22} weight={700} style={{ lineHeight: 34 }} testID="wale-settings-title">
          Settings
        </T>
      </At>
      <Tap x={362} y={26} w={43.6} h={43} label="Close" onPress={() => back()} style={glass(10, "rgba(255,255,255,0.3)")} testID="wale-settings-close">
        <LineIcon name="x" size={25} stroke={2.7} />
      </Tap>

      <At x={24} y={96}>
        <T size={13} weight={700} style={{ lineHeight: 20 }} testID="wale-settings-sounds-label">
          Sounds
        </T>
      </At>
      <Slider y={147} value={Number(sounds) || 0} onChange={(v) => setSounds(v.toFixed(2))} label="Sounds" testID="wale-settings-sounds" />
      <At x={24} y={187}>
        <T size={13} weight={700} style={{ lineHeight: 20 }} testID="wale-settings-music-label">
          Music
        </T>
      </At>
      <Slider y={237.5} value={Number(music) || 0} onChange={(v) => setMusic(v.toFixed(2))} label="Music" testID="wale-settings-music" />

      <At x={24} y={296}>
        <T size={13} weight={700} style={{ lineHeight: 20 }} testID="wale-settings-haptic-label">
          Haptic feedback
        </T>
      </At>
      <Switch y={288} on={haptics} onChange={setHapticsOn} label="Haptic feedback" testID="wale-settings-haptic" />
      <At x={24} y={364}>
        <T size={13} weight={700} style={{ lineHeight: 20 }} testID="wale-settings-locked-label">
          Locked movement control
        </T>
      </At>
      <Switch y={355.5} on={locked === "1"} onChange={(v) => setLocked(v ? "1" : "0")} label="Locked movement control" testID="wale-settings-locked" />
      <At x={24} y={432}>
        <T size={13} weight={700} style={{ lineHeight: 20 }} testID="wale-settings-offers-label">
          Personal offers
        </T>
      </At>
      <Switch y={424} on={offers === "1"} onChange={(v) => setOffers(v ? "1" : "0")} label="Personal offers" testID="wale-settings-offers" />

      <At x={24} y={494}>
        <T size={11} weight={400} color={W.inkSoft} testID="wale-settings-language-label">
          Language
        </T>
      </At>
      <Tap x={24} y={519.4} w={381.6} h={47.6} label="Language: English" onPress={() => notBuiltYet("Other languages")} style={[glass(10, "rgba(255,255,255,0.18)"), { flexDirection: "row", justifyContent: "space-between", paddingLeft: 16, paddingRight: 14 }]} testID="wale-settings-language">
        <T size={13} weight={700} style={{ lineHeight: 20 }}>
          English
        </T>
        <LineIcon name="chevron-down" size={17} stroke={2.8} />
      </Tap>

      {LINKS.map((l, i) => (
        <Tap key={l.id} x={i % 2 === 0 ? 24 : 221.25} y={591 + Math.floor(i / 2) * 63.9} w={184.6} h={51} label={l.label} onPress={l.go} style={glass(10, "rgba(255,255,255,0.18)")} testID={`wale-settings-link-${l.id}`}>
          <T size={11.5} weight={700} style={{ lineHeight: 16 }}>
            {l.label}
          </T>
        </Tap>
      ))}

      <At x={0} y={922} w={FW} style={{ alignItems: "center" }}>
        <T size={10} weight={400} color={W.inkSoft} testID="wale-settings-build">{`Build: ${build}`}</T>
      </At>
    </DesignCanvas>
  );
}
