// The root error boundary: if a screen throws while drawing, the app shows a
// friendly restart screen instead of closing, and reports the error
// (services/monitoring.ts, a no-op without a DSN). "Restart" reloads the
// JS (expo-updates) and, where that is not available, draws the app again.
import { Ionicons } from "@expo/vector-icons";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { FONTS } from "@/constants/fonts";
import { reportError } from "@/services/monitoring";
import { C, radius, space, type } from "@/theme/tokens";

type State = { error: Error | null; attempt: number; where: string | null; copied: boolean };

async function reloadApp(): Promise<boolean> {
  try {
    const Updates = await import("expo-updates");
    await Updates.reloadAsync();
    return true;
  } catch {
    return false;
  }
}

export class RootErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, attempt: 0, where: null, copied: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(error, { componentStack: info.componentStack });
    console.error("[app] screen crashed:", error?.message, error?.stack, info?.componentStack);
    // Where it broke (the first screens/components on the path), shown under "Details".
    const where = String(info?.componentStack || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 6)
      .join("\n");
    this.setState({ where: where || null });
  }

  /** What the crash screen shows under "Details" (and copies). */
  details() {
    const e = this.state.error;
    return [`${e?.name || "Error"}: ${e?.message || "unknown"}`, this.state.where].filter(Boolean).join("\n");
  }

  copy = async () => {
    try {
      const Clipboard = await import("expo-clipboard");
      await Clipboard.setStringAsync(this.details());
      this.setState({ copied: true });
    } catch {
      // Copying is a nicety: the text can still be selected by hand.
    }
  };

  restart = async () => {
    const reloaded = await reloadApp();
    if (!reloaded) this.setState((s) => ({ error: null, where: null, copied: false, attempt: s.attempt + 1 }));
  };

  render() {
    if (!this.state.error) {
      // A new key draws everything from scratch after a restart.
      return <View style={{ flex: 1 }} key={this.state.attempt}>{this.props.children}</View>;
    }
    return (
      <View style={styles.screen} accessibilityViewIsModal>
        <View style={styles.badge}>
          <Ionicons name="sparkles" size={34} color={C.white} />
        </View>
        <Text style={styles.title} accessibilityRole="header">
          Something went wrong
        </Text>
        <Text style={styles.body}>CosQuest hit a problem and needs to restart. Your chats and progress are safe.</Text>
        <Pressable onPress={this.restart} style={({ pressed }) => [styles.button, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel="Restart CosQuest">
          <Text style={styles.buttonText}>Restart</Text>
        </Pressable>
        <View style={styles.details}>
          <Text style={styles.detailsTitle}>Details (send this to the CosQuest team)</Text>
          <Text selectable style={styles.detailsText} numberOfLines={10}>
            {this.details()}
          </Text>
          <Pressable onPress={this.copy} accessibilityRole="button" accessibilityLabel="Copy the error details" hitSlop={8}>
            <Text style={styles.copy}>{this.state.copied ? "Copied" : "Copy details"}</Text>
          </Pressable>
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.xxxl, backgroundColor: C.skyPale, gap: space.md },
  badge: { width: 72, height: 72, borderRadius: 36, backgroundColor: C.brand, alignItems: "center", justifyContent: "center", marginBottom: space.sm },
  title: { fontFamily: FONTS.bold, ...type.headline, color: C.ink, textAlign: "center" },
  body: { fontFamily: FONTS.regular, ...type.body, color: C.slate, textAlign: "center", maxWidth: 320 },
  button: { marginTop: space.lg, minHeight: 48, paddingHorizontal: space.xxxl, borderRadius: radius.pill, backgroundColor: C.brand, alignItems: "center", justifyContent: "center" },
  buttonText: { fontFamily: FONTS.semibold, ...type.bodyLarge, color: C.white },
  details: { marginTop: space.xl, width: "100%", maxWidth: 420, padding: space.md, borderRadius: radius.md, backgroundColor: C.white, gap: space.xs },
  detailsTitle: { fontFamily: FONTS.semibold, fontSize: 12, color: C.slate },
  detailsText: { fontFamily: FONTS.regular, fontSize: 11.5, lineHeight: 16, color: C.slate },
  copy: { fontFamily: FONTS.semibold, fontSize: 12.5, color: C.brand },
});
