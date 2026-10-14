// Tap, then say the answer (costquest-ios Roam/ChallengeViews.swift SayItButton).
// Recognised on the phone by the Kotlin SpeechListener; matched to a choice
// in features/game/voiceAnswer.ts; the server marks the index exactly as a tap.
// Anything that stops it (no permission, a call, no offline recogniser) says
// so in one line and the choices stay tappable: typing is always the fallback.
import { Ionicons } from "@expo/vector-icons";
import { AudioModule } from "expo-audio";
import * as Haptics from "expo-haptics";
import * as Speech from "expo-speech";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { type SpeechEngine, VoiceAnswer, voicePrompt } from "@/features/game/voiceAnswer";
import { nativeHelpers } from "@/modules/costquest-game/src";
import { store } from "@/store/store";

import { GF, GP } from "./theme";

/** The Android recogniser through the game module; null where there is none (iOS rn, web). */
function androidEngine(): SpeechEngine | null {
  const n = nativeHelpers;
  if (Platform.OS !== "android" || !n?.startListening || !n.stopListening || !n.addListener) return null;
  return {
    async requestPermission() {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      return status.granted;
    },
    async start({ choices, locale }) {
      // The Warden must not be heard as the answer.
      await Speech.stop().catch(() => {});
      // On the phone or not at all, as iOS promises.
      await n.startListening!({ choices, locale, onDeviceOnly: true });
    },
    async stop() {
      // Dropped, not just stopped: a late final result must not reach the next attempt.
      await (n.cancelListening ?? n.stopListening)!();
    },
    subscribe(onResult, onError) {
      const a = n.addListener!("onSpeechResult", (e) => onResult(e.text, e.final));
      const b = n.addListener!("onSpeechError", (e) => onError(e.code));
      return () => {
        a.remove();
        b.remove();
      };
    },
  };
}

export default function SayItButton({ choices, removed, onPick }: { choices: string[]; removed: number[]; onPick: (i: number) => void }) {
  const voice = useMemo(
    () =>
      new VoiceAnswer({
        engine: androidEngine(),
        callActive: () => store.getState().call.active != null,
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      }),
    [],
  );
  // A match can land seconds after the tap: answer with the latest onPick, not the tap's.
  const pick = useRef(onPick);
  useEffect(() => {
    pick.current = onPick;
  }, [onPick]);
  const { state, heard } = useSyncExternalStore(voice.watch, voice.snapshot, voice.snapshot);
  // The card going away (an answer tapped, the clock) closes the microphone.
  useEffect(() => () => voice.stop(), [voice]);

  // Nothing to offer where the platform has no recogniser module at all.
  if (!voice.available) return null;

  const listening = state.kind === "listening";
  const tap = () => {
    const live = choices.map((c, i) => (removed.includes(i) ? "" : c));
    voice
      .listen(live, (i) => {
        if (removed.includes(i)) return;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        pick.current(i);
      })
      .catch(() => {});
  };

  return (
    <View style={styles.row}>
      <Pressable
        onPress={tap}
        style={[styles.mic, { backgroundColor: listening ? GP.berry : GP.skyDeep }]}
        accessibilityRole="button"
        accessibilityLabel={listening ? "Stop listening" : "Say your answer"}>
        <Ionicons name={listening ? "radio" : "mic"} size={22} color="#FFF" />
      </Pressable>
      <Text style={[styles.line, state.kind === "idle" && { opacity: 0.8 }]} numberOfLines={2}>
        {voicePrompt(state, heard)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  mic: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  line: { flex: 1, fontFamily: GF.bold, fontSize: 14, color: "#FFF" },
});
