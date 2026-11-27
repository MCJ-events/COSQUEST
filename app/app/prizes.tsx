// ==========================================
// MY PRIZES: what I won, and claiming a prize
// ==========================================
// Prizes are paid in US dollars after a claim: identity and 18+, payout details
// (bank transfer or check) and the US tax form (W-9 or W-8BEN). Bank and tax
// numbers are encrypted on the server; only the last 4 digits come back.
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import TicketScreenHeader from "@/components/tickets/TicketScreenHeader";
import { useInk } from "@/constants/chatTheme";
import { FONTS } from "@/constants/fonts";
import { type Prize, type PrizeStatus, claimPrize, getPrizes } from "@/services/prizes";
import { useAppSelector } from "@/store/hooks";

const PINK = "#C34D9C";
const STATUS: Record<PrizeStatus, { label: string; color: string }> = {
  awaiting_claim: { label: "Claim it", color: PINK },
  submitted: { label: "Claim sent: being checked", color: "#B7791F" },
  verified: { label: "Checked: payout being prepared", color: "#2563EB" },
  payout_requested: { label: "Payout waiting for approval", color: "#2563EB" },
  held: { label: "Approved: paid after the hold", color: "#2563EB" },
  paid: { label: "Paid", color: "#15803D" },
  forfeited: { label: "Not claimed in time", color: "#66738A" },
  rejected: { label: "Claim refused", color: "#D9364F" },
};
const money = (p: Prize) => `$${(p.amountCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const placeLabel = (n: number) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`);

export default function MyPrizes() {
  const ink = useInk();
  const token = useAppSelector((state) => state.auth.token);
  const [prizes, setPrizes] = useState<Prize[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    getPrizes(token)
      .then((d) => setPrizes(d.prizes))
      .catch((e) => setError(e?.message || "Couldn't load your prizes."));
  }, [token]);
  useFocusEffect(load);

  const text = (light: string) => ink.text(light);
  return (
    <View style={{ flex: 1, backgroundColor: ink.dark ? "#14151F" : "#F4F8FD" }}>
      <TicketScreenHeader title="My prizes" />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 12, width: "100%", maxWidth: 720, alignSelf: "center" }}>
        {error ? <Text style={{ fontFamily: FONTS.regular, fontSize: 14, color: "#D9364F" }}>{error}</Text> : null}
        {!prizes ? (
          <ActivityIndicator color={PINK} style={{ marginTop: 32 }} />
        ) : !prizes.length ? (
          <Text style={{ fontFamily: FONTS.regular, fontSize: 15, color: text("#66738A") }}>No prizes yet. Win a quest and it shows here.</Text>
        ) : (
          prizes.map((p) => (
            <View key={p.id} style={{ gap: 8, padding: 16, borderRadius: 18, backgroundColor: ink.dark ? "#1F2130" : "#FFFFFF" }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Ionicons name="trophy" size={22} color={PINK} />
                <Text style={{ flex: 1, fontFamily: FONTS.semibold, fontSize: 16, color: text("#24283C") }}>
                  {placeLabel(p.place)} place · {p.quest.title || "Quest"}
                </Text>
                <Text style={{ fontFamily: FONTS.bold, fontSize: 17, color: text("#24283C") }}>{money(p)}</Text>
              </View>
              <Text style={{ fontFamily: FONTS.medium, fontSize: 13.5, color: STATUS[p.status].color }}>
                {STATUS[p.status].label}
                {p.status === "awaiting_claim" ? ` by ${new Date(p.claimDeadline).toLocaleDateString()}` : ""}
                {p.status === "held" && p.holdUntil ? ` (${new Date(p.holdUntil).toLocaleDateString()})` : ""}
                {p.status === "paid" && p.paymentRef ? ` · ref ${p.paymentRef}` : ""}
              </Text>
              {p.status === "rejected" && p.rejectedReason ? <Text style={{ fontFamily: FONTS.regular, fontSize: 13, color: text("#66738A") }}>{p.rejectedReason}</Text> : null}
              {p.payoutMethod ? (
                <Text style={{ fontFamily: FONTS.regular, fontSize: 13, color: text("#66738A") }}>
                  {p.payoutMethod.type === "ach" ? `Bank transfer to account ending ${p.payoutMethod.accountLast4}` : "Check by mail"}
                </Text>
              ) : null}
              {p.status === "awaiting_claim" ? (
                open === p.id ? (
                  <ClaimForm prize={p} token={token} onDone={() => { setOpen(null); load(); }} />
                ) : (
                  <Pressable onPress={() => setOpen(p.id)} accessibilityRole="button" style={{ alignSelf: "flex-start", paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999, backgroundColor: PINK }}>
                    <Text style={{ fontFamily: FONTS.semibold, fontSize: 14, color: "#FFFFFF" }}>Claim {money(p)}</Text>
                  </Pressable>
                )
              ) : null}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function ClaimForm({ prize, token, onDone }: { prize: Prize; token: string | null; onDone: () => void }) {
  const ink = useInk();
  const [legalName, setLegalName] = useState("");
  const [dob, setDob] = useState("");
  const [payoutType, setPayoutType] = useState<"ach" | "check">("ach");
  const [holder, setHolder] = useState("");
  const [routing, setRouting] = useState("");
  const [account, setAccount] = useState("");
  const [address, setAddress] = useState("");
  const [form, setForm] = useState<"w9" | "w8ben">("w9");
  const [tin, setTin] = useState("");
  const [country, setCountry] = useState("");
  const [certify, setCertify] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const text = (light: string) => ink.text(light);
  const input = { minHeight: 44, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: ink.dark ? "#2E3145" : "#DCE3EE", backgroundColor: ink.dark ? "#14151F" : "#F8FAFD", fontFamily: FONTS.regular, fontSize: 14.5, color: text("#24283C"), ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null) };
  const label = (s: string) => <Text style={{ marginTop: 6, fontFamily: FONTS.medium, fontSize: 13, color: text("#3D4256") }}>{s}</Text>;
  const choice = (on: boolean, title: string, onPress: () => void) => (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected: on }} style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: on ? PINK : ink.dark ? "#2E3145" : "#DCE3EE", backgroundColor: on ? "#FBEFF7" : "transparent" }}>
      <Text style={{ fontFamily: FONTS.medium, fontSize: 13, color: on ? PINK : text("#3D4256") }}>{title}</Text>
    </Pressable>
  );

  const submit = async () => {
    if (!token) return;
    setBusy(true);
    setError("");
    try {
      await claimPrize(token, prize.id, {
        legalName: legalName.trim(),
        dateOfBirth: dob.trim(),
        certify,
        payout: payoutType === "ach" ? { type: "ach", accountHolder: holder.trim(), routingNumber: routing, accountNumber: account } : { type: "check", mailingAddress: address.trim() },
        tax: form === "w9" ? { form: "w9", tin } : { form: "w8ben", country: country.trim(), tin: tin || undefined },
      });
      onDone();
    } catch (e: any) {
      setError(e?.message || "Couldn't send your claim.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 6, marginTop: 4 }}>
      {label("Full legal name (as on your ID)")}
      <TextInput value={legalName} onChangeText={setLegalName} autoComplete="name" style={input} />
      {label("Date of birth (YYYY-MM-DD)")}
      <TextInput value={dob} onChangeText={(v) => setDob(v.replace(/[^0-9-]/g, "").slice(0, 10))} placeholder="1998-04-21" placeholderTextColor="#9AA3B5" style={input} />

      {label("How you want to be paid")}
      <View style={{ flexDirection: "row", gap: 8 }}>
        {choice(payoutType === "ach", "Bank transfer (US)", () => setPayoutType("ach"))}
        {choice(payoutType === "check", "Check by mail", () => setPayoutType("check"))}
      </View>
      {payoutType === "ach" ? (
        <>
          {label("Account holder name")}
          <TextInput value={holder} onChangeText={setHolder} style={input} />
          {label("Routing number (9 digits)")}
          <TextInput value={routing} onChangeText={(v) => setRouting(v.replace(/\D/g, "").slice(0, 9))} keyboardType="number-pad" style={input} />
          {label("Account number")}
          <TextInput value={account} onChangeText={(v) => setAccount(v.replace(/\D/g, "").slice(0, 17))} keyboardType="number-pad" secureTextEntry style={input} />
        </>
      ) : (
        <>
          {label("Mailing address")}
          <TextInput value={address} onChangeText={setAddress} multiline style={[input, { minHeight: 70, paddingTop: 10 }]} />
        </>
      )}

      {label("Tax form")}
      <View style={{ flexDirection: "row", gap: 8 }}>
        {choice(form === "w9", "W-9 (US person)", () => setForm("w9"))}
        {choice(form === "w8ben", "W-8BEN (not a US person)", () => setForm("w8ben"))}
      </View>
      {form === "w9" ? (
        <>
          {label("SSN or EIN (9 digits)")}
          <TextInput value={tin} onChangeText={(v) => setTin(v.replace(/\D/g, "").slice(0, 9))} keyboardType="number-pad" secureTextEntry style={input} />
        </>
      ) : (
        <>
          {label("Country of tax residence")}
          <TextInput value={country} onChangeText={setCountry} style={input} />
          {label("Foreign tax ID (if you have one)")}
          <TextInput value={tin} onChangeText={(v) => setTin(v.slice(0, 30))} secureTextEntry style={input} />
        </>
      )}

      <Pressable onPress={() => setCertify((x) => !x)} accessibilityRole="checkbox" accessibilityState={{ checked: certify }} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start", marginTop: 8 }}>
        <Ionicons name={certify ? "checkbox" : "square-outline"} size={22} color={certify ? PINK : text("#66738A")} />
        <Text style={{ flex: 1, fontFamily: FONTS.regular, fontSize: 13, lineHeight: 18, color: text("#3D4256") }}>
          I confirm this information is true and correct, I am 18 or over, and I understand prizes are taxable income.
        </Text>
      </Pressable>
      <Text style={{ fontFamily: FONTS.regular, fontSize: 12, color: text("#66738A") }}>Your bank and tax numbers are encrypted. CosQuest staff only see the last 4 digits.</Text>
      {error ? <Text style={{ fontFamily: FONTS.regular, fontSize: 13.5, color: "#D9364F" }}>{error}</Text> : null}
      <Pressable onPress={submit} disabled={busy || !certify} accessibilityRole="button" style={{ marginTop: 6, alignItems: "center", paddingVertical: 13, borderRadius: 999, backgroundColor: busy || !certify ? "#B9BECB" : PINK }}>
        {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={{ fontFamily: FONTS.semibold, fontSize: 15, color: "#FFFFFF" }}>Send my claim</Text>}
      </Pressable>
    </View>
  );
}
