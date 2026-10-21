// CosCoins (costquest-ios Features/CoinsFeature.swift CoinsSheet): the
// balance, the packs sold through Stripe's hosted checkout where the web shop
// is allowed, and the ledger. Coins are bought, never earned, and the sheet
// says so. A purchase that lands plays the "+1,200 CosCoins added" moment.
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";
import { AppState, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  type CoinHistoryRow,
  type CoinPack,
  COUNT_STEP_MS,
  COUNT_STEPS,
  countAt,
  deltaText,
  formatCoins,
  historyIcon,
  historyTitle,
  packLabel,
  packSub,
  packTag,
  packTagText,
  packTotal,
  priceText,
  relativeWhen,
} from "@/features/game/coins";

import { coinsStore, openCheckout, useCoins } from "./coinsModel";
import { GameButton, GameCoin, GamePanel, MAX_FONT_SCALE, announce, pressFeedback, withAlpha } from "./kit";
import { impact } from "./prefs";
import { SheetHost } from "./Sheet";
import { SheetFrame } from "./SheetFrame";
import { SheetHeader } from "./SheetHeader";
import { playSound } from "./sound";
import { GF, GP } from "./theme";
import { themedStyles, useThemedStyles } from "@/constants/chatTheme";

export default function CoinsSheet({ onClose }: { onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <SheetHost band={{ top: insets.top + 40, height: 90 }} scrimLabel="Close CosCoins" onClose={onClose}>
      {(close) => <CoinsBody close={close} />}
    </SheetHost>
  );
}

function CoinsBody({ close }: { close: () => void }) {
  const styles = useThemedStyles(STYLE_PAIR);
  const insets = useSafeAreaInsets();
  const coins = useCoins();
  const packs = coinsStore.packs();
  const balance = coinsStore.displayBalance();
  const shop = coins.config !== null && packs.length > 0;

  // On open, and back from the browser or the background (willEnterForeground).
  useEffect(() => {
    void coinsStore.refresh();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void coinsStore.refresh();
    });
    return () => sub.remove();
  }, []);

  const buy = async (pack: CoinPack) => {
    const url = await coinsStore.buy(pack);
    if (url) await openCheckout(url);
  };

  return (
    <SheetFrame top={insets.top + 40}>
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false}>
        <SheetHeader title="CosCoins" onClose={close} />
        <GamePanel>
          <View style={styles.balanceRow} accessible accessibilityLabel={`${balance} CosCoins`}>
            <GameCoin size={46} />
            <View style={{ gap: 2 }}>
              <Text style={styles.balance} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {formatCoins(balance)}
              </Text>
              <Text style={styles.balanceUnit} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                CosCoins
              </Text>
            </View>
          </View>
          <Text style={styles.small} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {"CosCoins are for use in CosQuest. They have no cash value and can't be withdrawn."}
          </Text>
        </GamePanel>

        {shop ? (
          <View style={{ gap: 10 }}>
            <SectionTitle text="Get CosCoins" />
            <View style={styles.grid}>
              {packs.map((p) => (
                <PackCard key={p.id} pack={p} disabled={coins.busy} onPress={() => void buy(p)} />
              ))}
            </View>
            {coins.problem ? <Text style={styles.problem}>{coins.problem}</Text> : null}
            <View style={styles.secure}>
              <Ionicons name="lock-closed" size={11} color={withAlpha(GP.ink, 0.7)} />
              <Text style={styles.secureText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                Payment is handled securely by Stripe.
              </Text>
            </View>
          </View>
        ) : coins.config !== null ? (
          // Outside the regions where the app may point at the web shop: said plainly, no other route.
          <GamePanel padding={14}>
            <View style={styles.notSold}>
              <View style={styles.globe}>
                <Ionicons name="globe" size={18} color="#FFF" />
              </View>
              <Text style={styles.notSoldText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                CosCoins are available in the US.
              </Text>
            </View>
          </GamePanel>
        ) : null}

        <View style={{ gap: 10 }}>
          <SectionTitle text="History" />
          {coins.history.length === 0 ? (
            <Text style={styles.empty} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              Nothing yet. Coins you buy or spend show up here.
            </Text>
          ) : (
            <GamePanel padding={6}>
              {coins.history.map((row, i) => (
                <View key={row.id}>
                  <HistoryLine row={row} />
                  {i < coins.history.length - 1 ? <View style={styles.rule} /> : null}
                </View>
              ))}
            </GamePanel>
          )}
        </View>
      </ScrollView>
      {coins.gained !== null ? <GainedMoment coins={coins.gained} onDone={() => coinsStore.dismissGained()} /> : null}
    </SheetFrame>
  );
}

function SectionTitle({ text }: { text: string }) {
  const styles = useThemedStyles(STYLE_PAIR);
  return (
    <Text style={styles.section} accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>
      {text.toUpperCase()}
    </Text>
  );
}

const PRESS = { stiffness: 816, damping: 34, mass: 1 };

/** One pack, as a flat printed card like the Nearby cards (CoinPackCard), pressed in like them (CardPress). */
function PackCard({ pack, disabled, onPress }: { pack: CoinPack; disabled: boolean; onPress: () => void }) {
  const styles = useThemedStyles(STYLE_PAIR);
  const tag = packTag(pack);
  const down = useSharedValue(0);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: 1 - 0.05 * down.get() }] }));
  return (
    <Pressable
      style={styles.packWrap}
      disabled={disabled}
      onPressIn={() => {
        pressFeedback();
        down.set(withSpring(1, PRESS));
      }}
      onPressOut={() => {
        down.set(withSpring(0, PRESS));
      }}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={packLabel(pack)}
      accessibilityState={{ disabled }}>
      <Animated.View style={[style, disabled && { opacity: 0.6 }]}>
        <View style={[styles.packEdge, { backgroundColor: tag === "best_value" ? GP.sunDeep : GP.slate }]} />
        <View style={styles.pack}>
          <View style={styles.packTop}>
            <GameCoin size={30} />
            {tag ? (
              <View style={styles.tag}>
                <Text style={styles.tagText}>{packTagText(tag)}</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.packTotal} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {formatCoins(packTotal(pack))}
          </Text>
          <Text style={styles.packSub} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {packSub(pack)}
          </Text>
          <View style={styles.price}>
            <Text style={styles.priceText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {priceText(pack)}
            </Text>
          </View>
        </View>
      </Animated.View>
    </Pressable>
  );
}

function HistoryLine({ row }: { row: CoinHistoryRow }) {
  const styles = useThemedStyles(STYLE_PAIR);
  const up = row.delta >= 0;
  const title = row.label ?? historyTitle(row.kind);
  const [now] = useState(() => Date.now());
  const when = relativeWhen(row.at, now);
  return (
    <View style={styles.line} accessible accessibilityLabel={`${title}, ${when}, ${up ? "plus" : "minus"} ${Math.abs(row.delta)} CosCoins`}>
      <View style={styles.lineIcon}>
        <Ionicons name={historyIcon(row.kind)} size={13} color={up ? GP.mint : GP.mist} />
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={styles.lineTitle} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {title}
        </Text>
        <Text style={styles.lineWhen} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {when}
        </Text>
      </View>
      {row.receipt_url ? (
        <Pressable onPress={() => void Linking.openURL(row.receipt_url!)} hitSlop={8} accessibilityRole="link" accessibilityLabel="Receipt">
          <Ionicons name="document-text" size={15} color={GP.skyDeep} />
        </Pressable>
      ) : null}
      <Text style={[styles.delta, { color: up ? GP.mint : withAlpha(GP.ink, 0.75) }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {deltaText(row.delta)}
      </Text>
    </View>
  );
}

/** "+1,200 CosCoins added": the count runs up, then settles (CoinsGainedMoment). */
function GainedMoment({ coins, onDone }: { coins: number; onDone: () => void }) {
  const styles = useThemedStyles(STYLE_PAIR);
  const reduce = useReducedMotion();
  const [step, setStep] = useState(reduce ? COUNT_STEPS : 0);
  const landed = useSharedValue(reduce ? 1 : 0.6);
  const coinStyle = useAnimatedStyle(() => ({ transform: [{ scale: landed.get() }] }));
  useEffect(() => {
    landed.set(withSpring(1, { stiffness: 195, damping: 15, mass: 1 }));
    announce(`${coins} CosCoins added`);
    let i = reduce ? COUNT_STEPS : 0;
    const t = setInterval(() => {
      i += 1;
      setStep(Math.min(i, COUNT_STEPS));
      if (i >= COUNT_STEPS) {
        clearInterval(t);
        playSound("reward");
        impact(Haptics.ImpactFeedbackStyle.Medium);
      }
    }, COUNT_STEP_MS);
    return () => clearInterval(t);
  }, [coins, landed, reduce]);
  return (
    <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.moment} accessibilityViewIsModal>
      <Pressable style={StyleSheet.absoluteFill} onPress={onDone} accessibilityLabel="Close" />
      <View style={styles.momentCol} accessible accessibilityLabel={`${coins} CosCoins added`}>
        <Animated.View style={coinStyle}>
          <GameCoin size={84} />
        </Animated.View>
        <Text style={styles.momentCount}>+{formatCoins(countAt(coins, step))}</Text>
        <Text style={styles.momentLine}>CosCoins added</Text>
      </View>
      <GameButton title="Nice" color={GP.sun} onPress={onDone} style={{ alignSelf: "center", marginTop: 6 }} />
    </Animated.View>
  );
}

const STYLE_PAIR = themedStyles({
  body: { paddingHorizontal: 18, gap: 16 },
  balanceRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  balance: { fontFamily: GF.display, fontSize: 34, color: GP.ink, fontVariant: ["tabular-nums"] },
  balanceUnit: { fontFamily: GF.bold, fontSize: 14, color: withAlpha(GP.ink, 0.6) },
  small: { marginTop: 10, fontFamily: GF.bold, fontSize: 12, color: withAlpha(GP.ink, 0.55) },
  section: { paddingTop: 4, fontFamily: GF.display, fontSize: 13, letterSpacing: 1.4, color: "#FFF", textShadowColor: "rgba(0,0,0,0.4)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 12 },
  packWrap: { width: "48%" },
  packEdge: { position: "absolute", left: 0, right: 0, top: 4, bottom: -4, borderRadius: 14 },
  pack: { gap: 8, padding: 12, borderRadius: 14, backgroundColor: GP.cream, shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 3, shadowOffset: { width: 0, height: 3 } },
  packTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 4 },
  tag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: GP.sun },
  tagText: { fontFamily: GF.display, fontSize: 10, letterSpacing: 0.8, color: GP.ink },
  packTotal: { fontFamily: GF.display, fontSize: 24, color: GP.ink, fontVariant: ["tabular-nums"] },
  packSub: { fontFamily: GF.bold, fontSize: 11, color: withAlpha(GP.ink, 0.55) },
  price: { alignItems: "center", paddingVertical: 7, borderRadius: 10, backgroundColor: GP.mint },
  priceText: { fontFamily: GF.display, fontSize: 16, color: "#FFF" },
  problem: { fontFamily: GF.bold, fontSize: 13, color: GP.sun },
  secure: { flexDirection: "row", alignItems: "center", gap: 6 },
  secureText: { fontFamily: GF.bold, fontSize: 12, color: withAlpha(GP.ink, 0.7) },
  notSold: { flexDirection: "row", alignItems: "center", gap: 12 },
  globe: { width: 36, height: 36, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: GP.skyDeep },
  notSoldText: { flex: 1, fontFamily: GF.display, fontSize: 16, color: GP.ink },
  empty: { fontFamily: GF.bold, fontSize: 14, color: "rgba(255,255,255,0.9)" },
  rule: { height: 1, marginHorizontal: 10, backgroundColor: withAlpha(GP.ink, 0.08) },
  line: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 10, paddingVertical: 9 },
  lineIcon: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: withAlpha(GP.ink, 0.06) },
  lineTitle: { fontFamily: GF.bold, fontSize: 14, color: GP.ink },
  lineWhen: { fontFamily: GF.bold, fontSize: 11, color: withAlpha(GP.ink, 0.5) },
  delta: { fontFamily: GF.display, fontSize: 16, fontVariant: ["tabular-nums"] },
  moment: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", padding: 28, gap: 14 },
  momentCol: { alignItems: "center", gap: 14 },
  momentCount: { fontFamily: GF.display, fontSize: 56, color: "#FFF", fontVariant: ["tabular-nums"] },
  momentLine: { fontFamily: GF.display, fontSize: 18, color: "rgba(255,255,255,0.85)" },
});
