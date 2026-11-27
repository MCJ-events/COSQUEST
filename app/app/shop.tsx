// ==========================================
// THE SHOP (Wale's design, 27 Nov 2026): Deals, Elite Merch, Manny's Remix, CosCoin
// ==========================================
// /shop?tab=coscoin|elite|remix|deals. Everything comes from GET /api/shop in one call;
// countdowns use the server's clock. CosCoin packs are paid on the CosQuest WEBSITE
// (team decision: no payments inside the apps); items are bought with CosCoin through a
// confirm sheet, and every change waits for the server. States: loading, confirm,
// processing, success, not enough CosCoin, owned, claimed, ended, offline.
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Crypto from "expo-crypto";
import { Image } from "expo-image";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";

import { FONTS } from "@/constants/fonts";
import { type ShopData, type ShopItem, claimFreeReward, getShop, requestTopUpLink, spendCosCoin } from "@/services/coscoin";
import { useAppSelector } from "@/store/hooks";

const COIN = require("@/assets/images/waleui/coin.png");
const C = { bg: "#D9EAF3", panel: "#EEF6FA", card: "#F7FBFD", line: "#CFE2EC", ink: "#1E3442", muted: "#557083", pink: "#C34D9C", pinkSoft: "#F6E3F0", green: "#15803D", red: "#D9364F" };
type Tab = "deals" | "elite" | "remix" | "coscoin";
const TABS: { key: Tab; label: string; icon: (color: string) => ReactNode }[] = [
  { key: "deals", label: "DEALS", icon: (c) => <Ionicons name="sparkles-outline" size={18} color={c} /> },
  { key: "elite", label: "ELITE MERCH", icon: (c) => <MaterialCommunityIcons name="crown-outline" size={19} color={c} /> },
  { key: "remix", label: "MANNY'S REMIX", icon: (c) => <Ionicons name="shuffle" size={19} color={c} /> },
  { key: "coscoin", label: "COSCOIN", icon: (c) => <MaterialCommunityIcons name="circle-multiple-outline" size={18} color={c} /> },
];
const CRUMB: Record<Tab, string> = { deals: "DEALS", elite: "ELITE MERCH", remix: "MANNY'S REMIX", coscoin: "COSCOIN PACKS" };

function left(endsAt: string | null | undefined, offsetMs: number) {
  if (!endsAt) return "";
  const ms = new Date(endsAt).getTime() - (Date.now() + offsetMs);
  if (ms <= 0) return "Ended";
  const d = Math.floor(ms / 864e5);
  const h = Math.floor((ms % 864e5) / 36e5);
  const m = Math.floor((ms % 36e5) / 6e4);
  return d > 0 ? `${d} d ${h} h` : h > 0 ? `${h} h ${m} m` : `${m} m`;
}

export default function Shop() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const token = useAppSelector((state) => state.auth.token);
  const [tab, setTab] = useState<Tab>((["deals", "elite", "remix", "coscoin"].includes(String(params.tab)) ? params.tab : "elite") as Tab);
  const [data, setData] = useState<ShopData | null>(null);
  const [offset, setOffset] = useState(0);
  const [online, setOnline] = useState(true);
  const [, setTick] = useState(0);
  const [confirm, setConfirm] = useState<ShopItem | null>(null);
  const [short, setShort] = useState<ShopItem | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const wanted = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const d = await getShop(token);
      setOffset(new Date(d.serverTime).getTime() - Date.now());
      setData(d);
      setOnline(true);
    } catch {
      setOnline(false);
    }
  }, [token]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useEffect(() => {
    const id = setInterval(() => setTick((x) => x + 1), 30000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  const balance = data?.balance.balance ?? 0;
  const close = () => (router.canGoBack() ? router.back() : router.replace("/" as any));

  const buy = async (item: ShopItem) => {
    if (!token) return;
    setBusy(item.id);
    setError("");
    try {
      const r = await spendCosCoin(token, item.id, Crypto.randomUUID());
      setConfirm(null);
      setToast(`${item.name} is yours! ${r.balance} CosCoin left.`);
      await load();
    } catch (e: any) {
      if (e?.status === 402) {
        setConfirm(null);
        setShort(item);
      } else setError(e?.message || "That didn't work. Nothing was charged.");
    } finally {
      setBusy(null);
    }
  };

  const claim = async (item: ShopItem) => {
    if (!token) return;
    setBusy(item.id);
    setError("");
    try {
      await claimFreeReward(token, item.id);
      setToast(`${item.name} claimed!`);
      await load();
    } catch (e: any) {
      setError(e?.message || "Couldn't claim the reward.");
    } finally {
      setBusy(null);
    }
  };

  const topUp = async (bundleId: string) => {
    if (!token) return;
    setBusy(bundleId);
    setError("");
    try {
      const { url } = await requestTopUpLink(bundleId, token);
      if (Platform.OS === "web") {
        window.location.href = url;
        return;
      }
      await WebBrowser.openBrowserAsync(url);
      await load(); // back from the website: the new balance
      if (wanted.current) setTab("elite");
    } catch (e: any) {
      setError(e?.message || "Couldn't open the top-up page.");
    } finally {
      setBusy(null);
    }
  };

  const remixLeft = left(data?.remix.endsAt, offset);
  const freeOpen = !!data?.remix.free && !data.remix.free.claimed;
  const dropLeft = useMemo(() => left(data?.eliteMerch.map((i) => i.dropEndsAt).filter(Boolean).sort()[0] as string | undefined, offset), [data, offset]);

  const priceButton = (item: ShopItem) => {
    if (item.owned && !item.stackable) return <Btn label="Owned" icon={<Ionicons name="checkmark-circle" size={18} color={C.green} />} tone="done" />;
    return <Btn label={`${item.priceCosCoin} Coscoin`} coin loading={busy === item.id} disabled={!online} onPress={() => setConfirm(item)} />;
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, paddingTop: Platform.OS === "web" ? 18 : 54, paddingBottom: 14, backgroundColor: C.panel, borderBottomWidth: 1, borderBottomColor: C.line }}>
        <IconBtn icon="arrow-back" label="Back" onPress={close} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: FONTS.bold, fontSize: 12, letterSpacing: 0.5, color: C.pink }}>COSQUEST</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ fontFamily: FONTS.bold, fontSize: 26, color: C.ink }}>Shop</Text>
            <Text style={{ fontFamily: FONTS.semibold, fontSize: 11, color: C.muted, backgroundColor: "#FFFFFF", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 }}>BETA</Text>
          </View>
        </View>
        <IconBtn icon="close" label="Close the shop" onPress={close} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 14, width: "100%", maxWidth: 760, alignSelf: "center" }}>
        <View style={{ flexDirection: "row" }}>
          <Pressable onPress={() => setTab("coscoin")} accessibilityLabel={`${balance} CosCoin. Get more`} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999, backgroundColor: "#FFFFFF" }}>
            <Image source={COIN} style={{ width: 24, height: 24 }} contentFit="contain" />
            <Text style={{ fontFamily: FONTS.bold, fontSize: 17, color: C.ink }}>{data ? balance.toLocaleString("en-US") : "…"}</Text>
            <Ionicons name="add-circle" size={20} color={C.pink} />
          </Pressable>
        </View>

        <Text style={{ fontFamily: FONTS.semibold, fontSize: 13, letterSpacing: 0.5, color: C.muted }}>BROWSE THE STORE</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          {TABS.map((t) => {
            const on = tab === t.key;
            return (
              <Pressable key={t.key} onPress={() => setTab(t.key)} accessibilityRole="tab" accessibilityState={{ selected: on }} style={{ flexBasis: "47%", flexGrow: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 50, borderRadius: 14, backgroundColor: on ? "#FFFFFF" : "#CFE3EE" }}>
                {t.icon(on ? C.pink : C.muted)}
                <Text style={{ fontFamily: FONTS.bold, fontSize: 13, color: on ? C.pink : C.muted }}>{t.label}</Text>
                {on ? <View style={{ width: 3, height: 18, borderRadius: 2, backgroundColor: C.pink }} /> : null}
              </Pressable>
            );
          })}
        </View>

        {freeOpen && tab !== "remix" ? (
          <Pressable onPress={() => setTab("remix")} style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 16, backgroundColor: C.panel }}>
            <Ionicons name="gift-outline" size={24} color={C.pink} />
            <View>
              <Text style={{ fontFamily: FONTS.semibold, fontSize: 14, color: C.ink }}>Manny&apos;s Remix</Text>
              <Text style={{ fontFamily: FONTS.regular, fontSize: 13, color: C.muted }}>Free reward available</Text>
            </View>
          </Pressable>
        ) : null}

        {error ? <Text style={{ fontFamily: FONTS.medium, fontSize: 13.5, color: C.red }}>{error}</Text> : null}
        {toast ? <Text style={{ fontFamily: FONTS.semibold, fontSize: 14, color: C.green, textAlign: "center", padding: 10, borderRadius: 12, backgroundColor: "#E6F6EC" }}>{toast}</Text> : null}

        {!data ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            {[0, 1, 2, 3].map((i) => <View key={i} style={{ flexBasis: "47%", flexGrow: 1, height: 220, borderRadius: 20, backgroundColor: C.panel, opacity: 0.7 }} />)}
          </View>
        ) : tab === "coscoin" ? (
          <>
            <Text style={{ fontFamily: FONTS.regular, fontSize: 14.5, lineHeight: 21, color: C.ink, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: "#E9C8DE", backgroundColor: C.pinkSoft }}>{data.notice}</Text>
            <Text style={{ fontFamily: FONTS.bold, fontSize: 22, color: C.ink }}>Coscoin packs</Text>
            {!data.packs.bundles.length ? <Text style={{ fontFamily: FONTS.regular, fontSize: 14, color: C.muted }}>No packs on sale right now.</Text> : null}
            <Grid>
              {data.packs.bundles.map((b) => (
                <Card key={b.id}>
                  <Image source={COIN} style={{ width: 84, height: 84, alignSelf: "center" }} contentFit="contain" />
                  <Text style={{ fontFamily: FONTS.bold, fontSize: 17, color: C.ink }}>{b.costcoin.toLocaleString("en-US")} Coscoin</Text>
                  <Text style={{ fontFamily: FONTS.medium, fontSize: 11.5, letterSpacing: 0.4, color: C.muted }}>CURRENCY PACK</Text>
                  <Btn label={`$${(b.priceCents / 100).toFixed(2)}`} icon={<Ionicons name="card-outline" size={18} color={C.pink} />} loading={busy === b.id} disabled={!online} onPress={() => topUp(b.id)} />
                </Card>
              ))}
            </Grid>
            <Text style={{ fontFamily: FONTS.regular, fontSize: 12.5, color: C.muted }}>Paid securely on the CosQuest website. Your balance updates when you come back.</Text>
          </>
        ) : tab === "elite" ? (
          <>
            <Heading title="Newly added" right={dropLeft} />
            {!data.eliteMerch.length ? <Text style={{ fontFamily: FONTS.regular, fontSize: 14, color: C.muted }}>Nothing new right now. Check back soon.</Text> : null}
            <Grid>
              {data.eliteMerch.map((item) => (
                <Card key={item.id}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    {item.isNew ? <Text style={{ fontFamily: FONTS.bold, fontSize: 12, color: C.pink }}>NEW</Text> : <View />}
                    <Text style={{ fontFamily: FONTS.regular, fontSize: 12, color: C.muted }}>{left(item.dropEndsAt, offset)}</Text>
                  </View>
                  {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={{ width: "100%", height: 170 }} contentFit="contain" /> : <View style={{ height: 170, alignItems: "center", justifyContent: "center" }}><Ionicons name="shirt-outline" size={56} color={C.muted} /></View>}
                  <Text style={{ fontFamily: FONTS.bold, fontSize: 16, color: C.ink }}>{item.name.toUpperCase()}</Text>
                  {item.subtitle ? <Text style={{ fontFamily: FONTS.regular, fontSize: 13, color: C.muted }}>{item.subtitle}</Text> : null}
                  {priceButton(item)}
                </Card>
              ))}
            </Grid>
          </>
        ) : tab === "remix" ? (
          <>
            <Heading title="Manny's Remix" right={remixLeft} />
            <Grid>
              {data.remix.free ? (
                <Card>
                  <Text style={{ fontFamily: FONTS.semibold, fontSize: 12.5, color: C.muted }}>FREE REWARD</Text>
                  {data.remix.free.imageUrl ? <Image source={{ uri: data.remix.free.imageUrl }} style={{ width: "100%", height: 110 }} contentFit="contain" /> : <Ionicons name="gift" size={64} color={C.pink} style={{ alignSelf: "center", marginVertical: 18 }} />}
                  <Text style={{ fontFamily: FONTS.bold, fontSize: 15, color: C.ink }}>{data.remix.free.name}</Text>
                  {data.remix.free.claimed ? (
                    <Btn label="Claimed" icon={<Ionicons name="checkmark-circle" size={18} color={C.green} />} tone="done" />
                  ) : (
                    <Btn label="FREE" icon={<Ionicons name="gift-outline" size={18} color={C.pink} />} loading={busy === data.remix.free.id} disabled={!online} onPress={() => claim(data.remix.free as ShopItem)} />
                  )}
                </Card>
              ) : null}
              {data.remix.offers.map((item) => (
                <Card key={item.id}>
                  <Text style={{ fontFamily: FONTS.semibold, fontSize: 12.5, color: C.muted }}>{item.subtitle?.toUpperCase() || "BASIC"}</Text>
                  {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={{ width: "100%", height: 110 }} contentFit="contain" /> : <Ionicons name="color-palette-outline" size={56} color={C.muted} style={{ alignSelf: "center", marginVertical: 18 }} />}
                  <Text style={{ fontFamily: FONTS.bold, fontSize: 15, color: C.ink }}>{item.name}</Text>
                  {priceButton(item)}
                </Card>
              ))}
            </Grid>
            {!data.remix.free && !data.remix.offers.length ? <Text style={{ fontFamily: FONTS.regular, fontSize: 14, color: C.muted }}>No remix offers right now.</Text> : null}
          </>
        ) : (
          <>
            <Heading title="Deals" right="" />
            {!data.deals.length ? <Text style={{ fontFamily: FONTS.regular, fontSize: 14, color: C.muted }}>No deals right now. Check back soon.</Text> : null}
            <Grid>
              {data.deals.map((item) => (
                <Card key={item.id}>
                  {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={{ width: "100%", height: 130 }} contentFit="contain" /> : null}
                  <Text style={{ fontFamily: FONTS.bold, fontSize: 15, color: C.ink }}>{item.name}</Text>
                  {item.subtitle ? <Text style={{ fontFamily: FONTS.regular, fontSize: 13, color: C.muted }}>{item.subtitle}</Text> : null}
                  {priceButton(item)}
                </Card>
              ))}
            </Grid>
          </>
        )}
      </ScrollView>

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingVertical: 12, paddingBottom: Platform.OS === "web" ? 12 : 26, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.panel }}>
        <Text style={{ fontFamily: FONTS.semibold, fontSize: 12, color: C.muted }}>COSQUEST / SHOP / {CRUMB[tab]}</Text>
        {online ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Ionicons name="wifi" size={16} color={C.muted} />
            <Text style={{ fontFamily: FONTS.regular, fontSize: 13, color: C.muted }}>Connected</Text>
          </View>
        ) : (
          <Pressable onPress={load} accessibilityRole="button">
            <Text style={{ fontFamily: FONTS.semibold, fontSize: 13, color: C.red }}>Offline · Reconnect to shop</Text>
          </Pressable>
        )}
      </View>

      <Sheet visible={!!confirm} onClose={() => setConfirm(null)}>
        {confirm ? (
          <>
            {confirm.imageUrl ? <Image source={{ uri: confirm.imageUrl }} style={{ width: "100%", height: 160 }} contentFit="contain" /> : null}
            <Text style={{ fontFamily: FONTS.bold, fontSize: 20, color: C.ink }}>{confirm.name}</Text>
            {confirm.subtitle ? <Text style={{ fontFamily: FONTS.regular, fontSize: 14, color: C.muted }}>{confirm.subtitle}</Text> : null}
            <Row label="Cost" value={`${confirm.priceCosCoin} Coscoin`} />
            <Row label="Balance after" value={`${Math.max(0, balance - (confirm.priceCosCoin || 0))} Coscoin`} />
            {confirm.boughtCoinsOnly ? <Text style={{ fontFamily: FONTS.regular, fontSize: 12.5, color: C.muted }}>This item takes bought CosCoin only.</Text> : null}
            <View style={{ flexDirection: "row", gap: 10, marginTop: 6 }}>
              <View style={{ flex: 1 }}><Btn label="Cancel" tone="plain" onPress={() => setConfirm(null)} /></View>
              <View style={{ flex: 1 }}><Btn label="Confirm" tone="solid" loading={busy === confirm.id} onPress={() => buy(confirm)} /></View>
            </View>
          </>
        ) : null}
      </Sheet>

      <Sheet visible={!!short} onClose={() => setShort(null)}>
        <Ionicons name="alert-circle-outline" size={40} color={C.pink} style={{ alignSelf: "center" }} />
        <Text style={{ fontFamily: FONTS.bold, fontSize: 20, color: C.ink, textAlign: "center" }}>Not enough Coscoin</Text>
        <Text style={{ fontFamily: FONTS.regular, fontSize: 14, color: C.muted, textAlign: "center" }}>
          {short ? `${short.name} costs ${short.priceCosCoin} Coscoin. You have ${balance}.` : ""}
        </Text>
        <View style={{ flexDirection: "row", gap: 10, marginTop: 6 }}>
          <View style={{ flex: 1 }}><Btn label="Not now" tone="plain" onPress={() => setShort(null)} /></View>
          <View style={{ flex: 1 }}><Btn label="Get Coscoin" tone="solid" onPress={() => { wanted.current = short?.id || null; setShort(null); setTab("coscoin"); }} /></View>
        </View>
      </Sheet>
    </View>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>{children}</View>;
}

function Card({ children }: { children: ReactNode }) {
  return <View style={{ flexBasis: "47%", flexGrow: 1, maxWidth: 360, gap: 8, padding: 14, borderRadius: 22, borderWidth: 2, borderColor: "#FFFFFF", backgroundColor: C.card }}>{children}</View>;
}

function Heading({ title, right }: { title: string; right: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <Text style={{ fontFamily: FONTS.bold, fontSize: 22, color: C.ink }}>{title}</Text>
      {right ? <Text style={{ fontFamily: FONTS.semibold, fontSize: 14, color: C.pink }}>{right}</Text> : null}
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.line }}>
      <Text style={{ fontFamily: FONTS.regular, fontSize: 14.5, color: C.muted }}>{label}</Text>
      <Text style={{ fontFamily: FONTS.semibold, fontSize: 14.5, color: C.ink }}>{value}</Text>
    </View>
  );
}

function IconBtn({ icon, label, onPress }: { icon: "arrow-back" | "close"; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={{ width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF" }}>
      <Ionicons name={icon} size={26} color={C.ink} />
    </Pressable>
  );
}

function Btn({ label, icon, coin, tone = "soft", loading, disabled, onPress }: { label: string; icon?: ReactNode; coin?: boolean; tone?: "soft" | "solid" | "plain" | "done"; loading?: boolean; disabled?: boolean; onPress?: () => void }) {
  const bg = tone === "solid" ? C.pink : tone === "plain" ? "#FFFFFF" : tone === "done" ? "#E6F6EC" : C.pinkSoft;
  const fg = tone === "solid" ? "#FFFFFF" : tone === "done" ? C.green : tone === "plain" ? C.ink : C.pink;
  return (
    <Pressable onPress={onPress} disabled={disabled || loading || !onPress} accessibilityRole="button" style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 48, borderRadius: 14, backgroundColor: bg, opacity: disabled ? 0.5 : 1 }}>
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {coin ? <Image source={COIN} style={{ width: 22, height: 22 }} contentFit="contain" /> : icon}
          <Text style={{ fontFamily: FONTS.bold, fontSize: 15.5, color: fg }}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

function Sheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(15,30,40,0.35)", justifyContent: "flex-end" }}>
        <Pressable onPress={() => {}} style={{ gap: 10, padding: 20, paddingBottom: 34, borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: "#FFFFFF", width: "100%", maxWidth: 560, alignSelf: "center" }}>
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
