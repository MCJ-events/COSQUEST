// The pieces of the brief feature screens (13 Nov 2026: Invite, Events, a booth challenge, the comic
// panel puzzle, the staff desk), in Wale's look: his sky gradient, his frosted panels with the white
// hairline, his ink and pink, Poppins. Wale has not drawn these screens, so unlike his own frames
// (kit.tsx DesignCanvas) they are laid out to flow: lists here grow with the event. When he draws
// them, each screen moves onto a DesignCanvas like his others.
import * as Application from "expo-application";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, type StyleProp, TextInput, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONTS } from "@/constants/fonts";
import { type BriefFlags, createFlagCache, fetchBriefFlags, type Spot } from "@/features/game/briefFeatures";
import { gameStore, refreshFix, startLocation } from "@/features/game/runtime";

import { back } from "../go";
import { ArtIcon, LineIcon, T, W, glass } from "../kit";

// ---------- flags ----------

const flagCache = createFlagCache(() => fetchBriefFlags(gameStore.client));

/** The Build Brief flags from the server: null while the first answer is on its way. */
export function useBriefFlags(): BriefFlags | null {
  const [flags, setFlags] = useState<BriefFlags | null>(flagCache.peek());
  useEffect(() => {
    let live = true;
    void flagCache.get().then((f) => {
      if (live) setFlags(f);
    });
    return () => {
      live = false;
    };
  }, []);
  return flags;
}

// ---------- the phone ----------

/** Where the phone is now, for an action the server judges by place; null without permission or signal. */
export async function spotNow(): Promise<Spot | null> {
  await startLocation(true);
  const fix = (await refreshFix()) ?? gameStore.get().fix;
  if (!fix) return null;
  return { lat: fix.lat, lng: fix.lng, accuracy_m: Math.max(1, Math.round(fix.accuracy ?? 30)) };
}

/** The phone's vendor id for the one-code-per-phone rule; null on the web or when the system has none. */
export async function installId(): Promise<string | null> {
  try {
    if (Platform.OS === "ios") return await Application.getIosIdForVendorAsync();
    if (Platform.OS === "android") return Application.getAndroidId();
  } catch {
    // no id: the server decides whether a code can be used without one
  }
  return null;
}

/** Re-runs `work` every `ms` while mounted and `on` is true. */
export function usePoll(work: () => void, ms: number, on: boolean) {
  useEffect(() => {
    if (!on) return;
    const t = setInterval(work, ms);
    return () => clearInterval(t);
  }, [work, ms, on]);
}

/** A clock that ticks once a second (for countdowns). */
export function useNow(on = true): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

// ---------- layout ----------

export function BriefScreen({ title, kicker, children, testID, icon, onClose }: { title: string; kicker?: string; children: ReactNode; testID: string; icon?: number; onClose?: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: "#B5D9E6" }} testID={testID}>
      <LinearGradient colors={["#B5D9E6", "#E6F2F8", "#D2E8F2"]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }} />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 18, paddingBottom: insets.bottom + 32, paddingHorizontal: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          {icon ? <ArtIcon w={30} h={30} source={icon} /> : null}
          <View style={{ flex: 1 }}>
            {kicker ? (
              <T size={10} weight={700} color={W.inkSoft} spacing={0.8} upper>
                {kicker}
              </T>
            ) : null}
            <T size={22} weight={700} lines={2} testID={`${testID}-title`}>
              {title}
            </T>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose ?? (() => back())} hitSlop={6} style={({ pressed }) => [glass(10, "rgba(255,255,255,0.3)"), { width: 44, height: 44, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.7 : 1 }]} testID={`${testID}-close`}>
            <LineIcon name="x" size={24} stroke={2.7} />
          </Pressable>
        </View>
        {children}
      </ScrollView>
    </View>
  );
}

export function Card({ children, style, testID, tone = "glass" }: { children: ReactNode; style?: StyleProp<ViewStyle>; testID?: string; tone?: "glass" | "solid" | "pink" }) {
  const fill = tone === "solid" ? "rgba(255,255,255,0.85)" : tone === "pink" ? W.pinkTint : "rgba(255,255,255,0.45)";
  return (
    <View testID={testID} style={[glass(14, fill), { padding: 16, gap: 10 }, tone === "pink" ? { borderColor: W.pink } : null, style]}>
      {children}
    </View>
  );
}

/** Body text that wraps (his canvas text is one line by default). */
export function P({ children, color = W.ink, size = 13, weight = 400, testID, align }: { children: ReactNode; color?: string; size?: number; weight?: 400 | 500 | 600 | 700; testID?: string; align?: "left" | "center" }) {
  return (
    <T size={size} weight={weight} color={color} lines={0} testID={testID} align={align} style={{ lineHeight: Math.round(size * 1.45) }}>
      {children}
    </T>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return (
    <T size={10} weight={700} color={W.inkSoft} spacing={0.8} upper>
      {children}
    </T>
  );
}

/** His ENTER QUEST button, at a size that fits a card. */
export function PinkButton({ label, onPress, disabled, busy, testID, tone = "pink" }: { label: string; onPress: () => void; disabled?: boolean; busy?: boolean; testID?: string; tone?: "pink" | "green" | "ink" }) {
  const bg = tone === "green" ? W.green : tone === "ink" ? W.ink : W.pink;
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [{ height: 50, borderRadius: 14, backgroundColor: bg, alignItems: "center", justifyContent: "center", opacity: off ? 0.45 : pressed ? 0.75 : 1, shadowColor: bg, shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } }]}
    >
      {busy ? (
        <ActivityIndicator color="#FFFFFF" />
      ) : (
        <T size={15} weight={800} color="#FFFFFF" spacing={0.6} upper>
          {label}
        </T>
      )}
    </Pressable>
  );
}

export function GhostButton({ label, onPress, disabled, testID, icon }: { label: string; onPress: () => void; disabled?: boolean; testID?: string; icon?: ReactNode }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [glass(10, "rgba(255,255,255,0.55)"), { minHeight: 42, paddingHorizontal: 14, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", opacity: disabled ? 0.45 : pressed ? 0.7 : 1 }]}
    >
      {icon}
      <T size={12} weight={700} color={W.ink} spacing={0.4} upper>
        {label}
      </T>
    </Pressable>
  );
}

export function Field({ value, onChangeText, placeholder, testID, big, autoCapitalize = "characters", maxLength, multiline }: { value: string; onChangeText: (s: string) => void; placeholder: string; testID?: string; big?: boolean; autoCapitalize?: "characters" | "sentences" | "none"; maxLength?: number; multiline?: boolean }) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={W.slate}
      autoCapitalize={autoCapitalize}
      autoCorrect={false}
      maxLength={maxLength}
      multiline={multiline}
      testID={testID}
      accessibilityLabel={placeholder}
      style={[glass(10, "rgba(255,255,255,0.7)"), { minHeight: big ? 56 : 44, paddingHorizontal: 14, paddingVertical: 8, color: W.ink, fontFamily: big ? FONTS.bold : FONTS.medium, fontSize: big ? 22 : 14, letterSpacing: big ? 4 : 0, textAlign: big ? "center" : "left" }]}
    />
  );
}

/** A small rounded tag (a status on a row). */
export function Chip({ text, tone = "slate" }: { text: string; tone?: "slate" | "pink" | "green" | "purple" }) {
  const bg = tone === "pink" ? W.pink : tone === "green" ? W.green : tone === "purple" ? W.purple : W.chip;
  return (
    <View style={{ backgroundColor: bg, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 3, alignSelf: "flex-start" }}>
      <T size={9} weight={700} color="#FFFFFF" spacing={0.6} upper>
        {text}
      </T>
    </View>
  );
}

/** A big code (yours, a booth's, a claim code), spaced and readable from arm's length. */
export function BigCode({ code, size = 34, testID }: { code: string; size?: number; testID?: string }) {
  const spaced = useMemo(() => code.split("").join(" "), [code]);
  return (
    <T size={size} weight={800} color={W.ink} spacing={1} align="center" testID={testID} style={{ lineHeight: Math.round(size * 1.25) }}>
      {spaced}
    </T>
  );
}

export function Loading({ text = "Loading" }: { text?: string }) {
  return (
    <Card>
      <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
        <ActivityIndicator color={W.pink} />
        <P color={W.inkSoft}>{text}</P>
      </View>
    </Card>
  );
}

/** What every brief screen shows when its feature is off on this server (a link can still land here). */
export function NotOpen({ what, testID }: { what: string; testID?: string }) {
  return (
    <Card testID={testID}>
      <P weight={600}>{`${what} isn't open yet.`}</P>
      <P color={W.inkSoft}>It switches on from the server when the team is ready. Nothing to do on your side.</P>
    </Card>
  );
}

/** A one-line message under an action: an error in pink, good news in green. */
export function Say({ text, good, testID }: { text: string | null; good?: boolean; testID?: string }) {
  if (!text) return null;
  return (
    <P color={good ? W.green : W.pinkDeep} weight={600} testID={testID}>
      {text}
    </P>
  );
}
