// A card in the Dailies: this week's distance walked and its rewards at 5, 25
// and 50 km (costquest-ios Features/StepsFeature.swift StepsCard,
// MilestoneTile; placed like RoamSheets.swift DailiesSheet, behind the
// "walking" unlock). The phone's step counter feeds it on Android
// (features/game/stepsDevice.ts); the server decides what the walk is worth
// and pays it, and its refusals are shown in its own words.
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, StyleSheet, Text, View } from "react-native";

import { gameStore } from "@/features/game/runtime";
import {
  describeRewards,
  EMPTY_STEPS_VIEW,
  km,
  type MilestoneState,
  milestoneState,
  progressTo,
  type StepsMilestone,
  type StepsStatus,
  type StepsView,
} from "@/features/game/steps";
import { updateStepsOnPhone } from "@/features/game/stepsDevice";

import { Chip, GameButton, ProgressBar } from "./kit";
import { GF, GP } from "./theme";

export default function StepsCard() {
  const [view, setView] = useState<StepsView>(EMPTY_STEPS_VIEW);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const latest = useRef<StepsView>(EMPTY_STEPS_VIEW);
  const alive = useRef(true);

  const update = async (ask: boolean) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      const next = await updateStepsOnPhone(latest.current, ask);
      latest.current = next;
      if (!alive.current) return;
      setView(next);
      if (next.justPaid) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        // XP and the item bag moved; let the rest of the game see it.
        void gameStore.refreshMe();
      }
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  };

  // Once per appearance: opening the dailies is when a player wants to see
  // this week's walk, and the report is cheap and idempotent.
  useEffect(() => {
    alive.current = true;
    void update(false);
    return () => {
      alive.current = false;
    };
  }, []);

  const s = view.status;
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Ionicons name="footsteps" size={28} color={GP.grass} accessibilityElementsHidden importantForAccessibility="no" />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.title}>This week: {km(s?.meters ?? 0)} km walked</Text>
          <Text style={styles.muted}>Walk to earn XP and items. Resets Monday.</Text>
        </View>
      </View>
      {s ? (
        <>
          <Progress status={s} />
          <View style={styles.tiles}>
            {s.milestones.map((m) => (
              <MilestoneTile key={m.km} milestone={m} state={milestoneState(s, m.km)} />
            ))}
          </View>
        </>
      ) : busy ? (
        <ActivityIndicator color={GP.navy} style={{ marginVertical: 8 }} />
      ) : null}
      {view.newly.length ? (
        <View style={styles.paid}>
          {view.newly.map((n) => (
            <View key={n.km} style={styles.paidRow}>
              <Ionicons name="walk" size={18} color={GP.mint} accessibilityElementsHidden importantForAccessibility="no" />
              <Text style={styles.paidText}>
                {n.km} km reached! {describeRewards(n.rewards)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {view.note ? <Text style={[styles.note, { color: view.noteIsProblem ? GP.berry : GP.mist }]}>{view.note}</Text> : null}
      {view.motionDenied ? (
        <GameButton
          title="Open Settings"
          color={GP.skyDeep}
          small
          style={{ alignSelf: "flex-start" }}
          onPress={() => {
            Linking.openSettings().catch(() => {});
          }}
          accessibilityLabel="Open Settings to allow Physical activity"
        />
      ) : null}
      <GameButton
        title={busy ? "Counting..." : "Update from your phone"}
        color={GP.mint}
        icon={<Ionicons name="walk" size={20} color="#FFF" />}
        disabled={busy}
        onPress={() => void update(true)}
        accessibilityLabel="Update this week's walk from your phone"
      />
    </View>
  );
}

function Progress({ status }: { status: StepsStatus }) {
  const p = progressTo(status);
  return (
    <View style={{ gap: 6 }} accessible accessibilityLabel={p.line}>
      <ProgressBar value={p.value} color={p.allDone ? GP.mint : GP.sun} track={GP.track} />
      <Text style={[styles.line, p.allDone && { color: GP.mint }]}>{p.line}</Text>
    </View>
  );
}

/** One of the three weekly milestones: done, the one being walked towards, or later. */
function MilestoneTile({ milestone, state }: { milestone: StepsMilestone; state: MilestoneState }) {
  const color = state === "done" ? GP.mint : state === "next" ? GP.sunDeep : "#8C8C8C";
  const word = state === "done" ? "Done" : state === "next" ? "Next" : "Locked";
  return (
    <View
      style={[styles.tile, { backgroundColor: `${color}${state === "locked" ? "14" : "29"}` }]}
      accessible
      accessibilityLabel={`${milestone.km} kilometres, ${word.toLowerCase()}. ${describeRewards(milestone)}`}>
      <Ionicons name={state === "done" ? "checkmark-circle" : state === "next" ? "flag" : "lock-closed"} size={20} color={color} />
      <Text style={styles.tileKm}>{milestone.km} km</Text>
      <Text style={styles.tileRewards} numberOfLines={3} adjustsFontSizeToFit>
        {describeRewards(milestone, true)}
      </Text>
      <View>
        <Chip text={word} color={color} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12, padding: 14, borderRadius: 18, backgroundColor: "#FFF" },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  title: { fontFamily: GF.display, fontSize: 17, color: GP.ink },
  muted: { fontFamily: GF.body, fontSize: 13, color: GP.mist },
  line: { fontFamily: GF.bold, fontSize: 13, color: GP.mist },
  tiles: { flexDirection: "row", gap: 8 },
  tile: { flex: 1, alignItems: "center", gap: 4, paddingVertical: 8, paddingHorizontal: 4, borderRadius: 16 },
  tileKm: { fontFamily: GF.display, fontSize: 17, color: GP.ink },
  tileRewards: { fontFamily: GF.body, fontSize: 11, color: GP.mist, textAlign: "center" },
  paid: { gap: 6, padding: 10, borderRadius: 14, backgroundColor: "rgba(242,153,46,0.25)" },
  paidRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  paidText: { flex: 1, fontFamily: GF.bold, fontSize: 14, color: GP.ink },
  note: { fontFamily: GF.bold, fontSize: 14 },
});
