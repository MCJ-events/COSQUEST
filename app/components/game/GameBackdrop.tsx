// The game's sheet and screen backdrop (UI/GameKit.swift GameBackdrop): slate
// to ice to pale blue, with two faint mountain slopes. Sits behind a screen's
// content (absolute fill, ignores touches).
import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, View } from "react-native";
import Svg, { Line, Polygon } from "react-native-svg";

import { GP } from "./theme";

/** Swift GameBackdrop (UI/GameKit.swift): slate to ice to pale blue with two faint mountain slopes. */
export function GameBackdrop() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient colors={[`${GP.slate}D9`, GP.ice, "#DEEDF2"]} style={StyleSheet.absoluteFill} />
      <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
        <Polygon points="-10,28 42,62 -10,62" fill="#FFFFFF" fillOpacity={0.12} />
        <Polygon points="110,30 60,60 110,60" fill="#FFFFFF" fillOpacity={0.12} />
        <Line x1={-10} y1={28} x2={42} y2={62} stroke={GP.slate} strokeOpacity={0.55} strokeWidth={0.4} />
        <Line x1={110} y1={30} x2={60} y2={60} stroke={GP.slate} strokeOpacity={0.55} strokeWidth={0.4} />
      </Svg>
    </View>
  );
}
