// ==========================================
// WEBSITE: AFTER A COSCOIN TOP-UP (Stripe returns here)
// ==========================================
// /checkout/costcoin-return?order=<id>&result=success|cancelled
// Asks the server how the top-up went (the server asks Stripe if the webhook
// hasn't arrived yet) and shows the new balance. The app updates by itself.
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useRef } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";

import { Message, backToApp } from "@/components/checkout/CheckoutParts";
import { useInk } from "@/constants/chatTheme";
import { FONTS } from "@/constants/fonts";
import { coins } from "@/services/coscoin";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { loadTopUpReturn } from "@/store/thunks/coscoinThunks";

const PINK = "#C34D9C";
const LOGO = require("@/assets/images/cosquest-logo.png");

export default function TopUpReturn() {
  const ink = useInk();
  const dispatch = useAppDispatch();
  const { order: orderId, result } = useLocalSearchParams<{ order?: string; result?: string }>();
  const web = useAppSelector((state) => state.coscoin.web);
  const tries = useRef(0);

  // Ask now, then every 3 seconds while it's still being confirmed (up to a minute).
  useEffect(() => {
    if (!orderId || result === "cancelled") return;
    let stop = false;
    const ask = async () => {
      if (stop) return;
      tries.current += 1;
      const action: any = await dispatch(loadTopUpReturn({ orderId: String(orderId) }));
      const status = action?.payload?.order?.status;
      if (!stop && (!status || status === "pending") && tries.current < 20) setTimeout(ask, 3000);
    };
    ask();
    return () => {
      stop = true;
    };
  }, [orderId, result, dispatch]);

  const order = web.order;
  let body: React.ReactNode;
  if (result === "cancelled") {
    body = <Message icon="close-circle-outline" title="Top-up cancelled" text="Nothing was charged. You can top up again from CosQuest whenever you like." action="Back to CosQuest" onAction={backToApp} />;
  } else if (!orderId) {
    body = <Message icon="link-outline" title="Open this page from CosQuest" text="Top up from the CosQuest app and you'll come back here after paying." />;
  } else if (!order) {
    body = web.returnStatus === "error" ? (
      <Message icon="hourglass-outline" title="Almost there" text={web.error?.message || "Your top-up is being finished. Open CosQuest to see your balance."} action="Back to CosQuest" onAction={backToApp} />
    ) : (
      <ActivityIndicator color={PINK} style={{ marginTop: 40 }} />
    );
  } else if (order.status === "paid") {
    body = (
      <View style={{ alignItems: "center", gap: 12, padding: 24, borderRadius: 20, backgroundColor: ink.dark ? "#1F2130" : "#FFFFFF" }}>
        <Ionicons name="checkmark-circle" size={56} color="#1D9A6C" />
        <Text style={{ fontFamily: FONTS.bold, fontSize: 22, color: ink.text("#24283C"), textAlign: "center" }}>{`${coins(order.costcoin)} added`}</Text>
        <Text style={{ fontFamily: FONTS.regular, fontSize: 14.5, color: ink.text("#66738A"), textAlign: "center" }}>{web.balance !== null ? `Your balance is now ${coins(web.balance)}.` : "Your balance is updated in CosQuest."}</Text>
        <Text style={{ fontFamily: FONTS.regular, fontSize: 12.5, color: ink.text("#98A0B0") }}>{order.number}</Text>
        <Message icon="phone-portrait-outline" title="Back to CosQuest" text="Your app already shows the new balance." action="Open CosQuest" onAction={backToApp} compact />
      </View>
    );
  } else if (order.status === "pending") {
    body = <Message icon="hourglass-outline" title="Confirming your payment…" text="This usually takes a few seconds. You can close this page: the coins land in CosQuest as soon as Stripe confirms." />;
  } else {
    body = <Message icon="alert-circle-outline" title="The top-up didn't go through" text={order.status === "refunded" ? "It was refunded in full." : "Nothing was charged. You can try again from CosQuest."} action="Back to CosQuest" onAction={backToApp} />;
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: ink.dark ? "#14151F" : "#F4F8FD" }} contentContainerStyle={{ padding: 20, paddingBottom: 48, width: "100%", maxWidth: 560, alignSelf: "center", gap: 18 }}>
      <View style={{ alignItems: "center", gap: 6, marginTop: 8 }}>
        <Image source={LOGO} style={{ width: 150, height: 60 }} contentFit="contain" accessibilityLabel="CosQuest" />
        <Text style={{ fontFamily: FONTS.semibold, fontSize: 18, color: ink.text("#24283C") }}>Top up CosCoin</Text>
      </View>
      {body}
    </ScrollView>
  );
}
