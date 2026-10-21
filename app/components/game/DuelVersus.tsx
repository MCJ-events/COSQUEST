// "Who is fighting whom", while the arena loads (costquest-ios Features/DuelFeature.swift
// VersusCard): the mode's title, you, "VS", and the Guardian. It holds for
// 1.8 s (VERSUS_MS) before the fight.
import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, useReducedMotion, ZoomIn } from "react-native-reanimated";

import { fightersOf, versusSubline, versusTitle } from "@/features/game/duelFlow";
import { gameStore } from "@/features/game/runtime";
import type { DuelFighterPeek, DuelStart } from "@/features/game/wire";

import { MAX_FONT_SCALE } from "./kit";
import { edgeOf, GF, GP, realmColor } from "./theme";
import { themedStyles, useThemedStyles } from "@/constants/chatTheme";

type IconName = ComponentProps<typeof Ionicons>["name"];

/** DuelLook.weaponSymbol, in Ionicons. */
function weaponIcon(w: string | null | undefined): IconName {
  switch (w) {
    case "fists":
      return "hand-left";
    case "polearm":
      return "remove";
    case "blaster":
      return "locate";
    case "arcane":
      return "sparkles";
    default:
      return "shield-half";
  }
}

export default function DuelVersus({ start }: { start: DuelStart }) {
  const styles = useThemedStyles(STYLE_PAIR);
  const reduce = useReducedMotion();
  const title = versusTitle(start, (id) => gameStore.factionName(id));
  const f = fightersOf(start);
  // One element for VoiceOver, as .accessibilityElement(children: .combine).
  const label = f ? `${title}. ${f.p1.name}, you, against ${f.p2.name}.` : title;
  return (
    <Animated.View
      entering={reduce ? FadeIn.duration(200) : ZoomIn.springify().stiffness(195).damping(22).withInitialValues({ transform: [{ scale: 0.9 }] })}
      style={styles.card}
      accessible
      accessibilityLabel={label}>
      <Text style={styles.title} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {title.toUpperCase()}
      </Text>
      {f ? (
        <>
          <Side f={f.p1} you />
          <Text style={styles.vs} maxFontSizeMultiplier={1.2}>
            VS
          </Text>
          <Side f={f.p2} you={false} />
        </>
      ) : null}
    </Animated.View>
  );
}

function Side({ f, you }: { f: DuelFighterPeek; you: boolean }) {
  const styles = useThemedStyles(STYLE_PAIR);
  const tint = realmColor(f.faction);
  return (
    <View style={styles.sideWrap}>
      <View style={[StyleSheet.absoluteFill, { top: 4, borderRadius: 16, backgroundColor: tint }]} />
      <View style={styles.side}>
        <View style={[styles.icon, { backgroundColor: tint }]}>
          <Ionicons name={weaponIcon(f.weapon_class)} size={22} color="#FFF" />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={styles.name} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {you ? `${f.name} (you)` : f.name}
          </Text>
          <Text style={styles.subline} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {versusSubline(f).toUpperCase()}
          </Text>
        </View>
      </View>
    </View>
  );
}

const STYLE_PAIR = themedStyles({
  card: { alignItems: "center", gap: 18, padding: 24, width: "100%" },
  title: { fontFamily: GF.display, fontSize: 14, letterSpacing: 1.6, color: "rgba(255,255,255,0.7)", textAlign: "center" },
  vs: { fontFamily: GF.display, fontSize: 44, color: GP.sun, textShadowColor: edgeOf(GP.sun), textShadowOffset: { width: 0, height: 3 }, textShadowRadius: 0.1 },
  sideWrap: { width: "100%", maxWidth: 360, paddingBottom: 4 },
  side: { flexDirection: "row", alignItems: "center", gap: 14, padding: 14, borderRadius: 16, backgroundColor: GP.cream },
  icon: { width: 52, height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  name: { fontFamily: GF.display, fontSize: 22, color: GP.ink },
  subline: { fontFamily: GF.bold, fontSize: 11, letterSpacing: 0.4, color: "rgba(30,58,76,0.55)" },
});
