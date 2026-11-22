// ==========================================
// WEBSITE: TOP UP COSCOIN (cosquest.vercel.app/checkout/costcoin?h=<link>)
// ==========================================
// Meeting 19 Nov: CosCoin is bought on the web only. The app (or a game)
// opens this page with a 20-minute link for one bundle; the page swaps it
// (once) for a checkout-only pass, shows the bundle and the balance, checks
// 18+, and sends the member to Stripe's page, which returns to
// /checkout/costcoin-return. Normal CosQuest look.
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from "react-native";

import { Message, backToApp } from "@/components/checkout/CheckoutParts";
import { useInk } from "@/constants/chatTheme";
import { FONTS } from "@/constants/fonts";
import { coins, dollars } from "@/services/coscoin";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { payTopUp, redeemTopUp } from "@/store/thunks/coscoinThunks";

const PINK = "#C34D9C";
const LOGO = require("@/assets/images/cosquest-logo.png");
const COIN = require("@/assets/images/dashboard/coscoin.png");

function useMinutesLeft(expiresAt: string | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  if (!expiresAt) return null;
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 60000));
}

export default function TopUpCheckout() {
  const ink = useInk();
  const dispatch = useAppDispatch();
  const { h } = useLocalSearchParams<{ h?: string }>();
  const web = useAppSelector((state) => state.coscoin.web);
  const asked = useRef(false);
  const minutesLeft = useMinutesLeft(web.expiresAt);

  useEffect(() => {
    if (asked.current || !h) return;
    asked.current = true;
    dispatch(redeemTopUp({ h: String(h) }));
    // The link is one-use and private: keep it out of the address bar and history.
    if (Platform.OS === "web") window.history.replaceState(null, "", "/checkout/costcoin");
  }, [h, dispatch]);

  const card = { borderRadius: 20, padding: 20, backgroundColor: ink.dark ? "#1F2130" : "#FFFFFF" };
  const text = (light: string) => ink.text(light);
  const expired = minutesLeft === 0;
  const b = web.bundle;

  let body: React.ReactNode;
  if (!h && web.status === "idle") {
    body = <Message icon="link-outline" title="Open this page from CosQuest" text="Tap Top up in the CosQuest app (or a CosQuest game), and it brings you here." />;
  } else if (web.status === "redeeming" || (web.status === "idle" && h)) {
    body = <ActivityIndicator color={PINK} style={{ marginTop: 40 }} />;
  } else if (web.status === "error" && !b) {
    const young = web.error?.code === "too_young" || web.error?.code === "age_unknown";
    body = <Message icon={young ? "person-circle-outline" : "time-outline"} title={young ? "CosCoin is for members 18 and over" : "This top-up link can't be used"} text={web.error?.message || "Go back to CosQuest and tap Top up again."} action="Back to CosQuest" onAction={backToApp} />;
  } else if (b) {
    body = (
      <View style={{ gap: 16 }}>
        <View style={[card, { alignItems: "center", gap: 10 }]}>
          <Image source={COIN} style={{ width: 64, height: 64 }} contentFit="contain" accessibilityIgnoresInvertColors />
          <Text style={{ fontFamily: FONTS.bold, fontSize: 26, color: text("#24283C") }}>{coins(b.costcoin)}</Text>
          <Text style={{ fontFamily: FONTS.medium, fontSize: 15, color: text("#66738A") }}>{b.name}</Text>
          <View style={{ marginTop: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: ink.dark ? "#2A2C3D" : "#FBEFF7" }}>
            <Text style={{ fontFamily: FONTS.semibold, fontSize: 15, color: PINK }}>{dollars(b.priceCents)}</Text>
          </View>
        </View>

        <View style={[card, { gap: 10 }]}>
          <Line icon="wallet-outline" label="Your balance now" value={web.balance === null ? "-" : coins(web.balance)} />
          <Line icon="add-circle-outline" label="After this top-up" value={web.balance === null ? "-" : coins(web.balance + b.costcoin)} strong />
          <Text style={{ fontFamily: FONTS.regular, fontSize: 12.5, lineHeight: 18, color: text("#66738A") }}>
            CosCoin is CosQuest's game currency for skins, items and more across CosQuest games. It isn't cash: it can't be withdrawn or used to enter paid quests.
          </Text>
        </View>

        {expired ? (
          <Message icon="time-outline" title="This top-up has closed" text="Go back to CosQuest and tap Top up again." action="Back to CosQuest" onAction={backToApp} compact />
        ) : (
          <View style={{ gap: 10 }}>
            {web.error ? <Text style={{ fontFamily: FONTS.regular, fontSize: 13.5, color: "#D9364F", textAlign: "center" }}>{web.error.message}</Text> : null}
            <Pressable onPress={() => dispatch(payTopUp())} disabled={web.status === "paying"} accessibilityRole="button" style={{ height: 54, borderRadius: 27, alignItems: "center", justifyContent: "center", backgroundColor: PINK }}>
              {web.status === "paying" ? <ActivityIndicator color="#FFFFFF" /> : <Text style={{ fontFamily: FONTS.bold, fontSize: 16, color: "#FFFFFF" }}>{`Pay ${dollars(b.priceCents)}`}</Text>}
            </Pressable>
            <Text style={{ fontFamily: FONTS.regular, fontSize: 12.5, textAlign: "center", color: text("#66738A") }}>
              Secure payment by Stripe. Your card details never reach CosQuest.{minutesLeft ? ` This top-up closes in ${minutesLeft} min.` : ""}
            </Text>
          </View>
        )}
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: ink.dark ? "#14151F" : "#F4F8FD" }} contentContainerStyle={{ padding: 20, paddingBottom: 48, width: "100%", maxWidth: 560, alignSelf: "center", gap: 18 }}>
      <View style={{ alignItems: "center", gap: 6, marginTop: 8 }}>
        <Image source={LOGO} style={{ width: 150, height: 60 }} contentFit="contain" accessibilityLabel="CosQuest" />
        <Text style={{ fontFamily: FONTS.semibold, fontSize: 18, color: text("#24283C") }}>Top up CosCoin</Text>
        {web.member ? <Text style={{ fontFamily: FONTS.regular, fontSize: 13, color: text("#66738A") }}>For {web.member.username ? `@${web.member.username}` : web.member.name}</Text> : null}
      </View>
      {body}
    </ScrollView>
  );
}

function Line({ icon, label, value, strong }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string; strong?: boolean }) {
  const ink = useInk();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Ionicons name={icon} size={18} color={PINK} />
      <Text style={{ flex: 1, fontFamily: FONTS.regular, fontSize: 14, color: ink.text("#3D4256") }}>{label}</Text>
      <Text style={{ fontFamily: strong ? FONTS.bold : FONTS.medium, fontSize: 14.5, color: ink.text("#24283C") }}>{value}</Text>
    </View>
  );
}
