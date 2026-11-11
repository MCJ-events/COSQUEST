// Wale's Social lobby (Figma "Social lobby · Mobile", 430 x 956): level and
// XP, three counters, the event banner, Portal and Free Shop, the lobby view,
// the move stick, View Profile, SHOP, the five tabs and the chat bar.
//
// The shared 3D lobby itself (other players walking about) does not exist in
// the game yet: it is a multiplayer presence feature with no server behind
// it. The picture in his frame is a screenshot of another game, so the view
// here is a plain placeholder panel in the same place, and the stick moves a
// dot on it so the control can be felt. Everything around it is wired.
//
// Over the Figma (Wale, 11 Nov): no gems. His third counter is drawn as
// coins, so it shows CosCoin.
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { PanResponder, View } from "react-native";

import { spaced, xpRatio } from "@/features/waleui/armory";
import { OUTFITS } from "@/features/waleui/look";
import { useGame } from "@/features/game/runtime";
import { useAppSelector } from "@/store/hooks";

import { useWaleProfile } from "./data";
import { notBuiltYet, openGameSheet } from "./go";
import { At, DesignCanvas, type IconName, PlaceholderTag, T, Tap, W } from "./kit";

const FW = 430;

const TABS: { id: string; label: string; icon: IconName; cx: number; go: () => void }[] = [
  { id: "friends", label: "Friends", icon: "people-outline", cx: 52, go: () => openGameSheet("friends") },
  { id: "emotes", label: "Emotes", icon: "accessibility-outline", cx: 132.5, go: () => notBuiltYet("Emotes") },
  { id: "chat", label: "Chat", icon: "chatbox-outline", cx: 213, go: () => router.push("/chat") },
  { id: "wardrobe", label: "Wardrobe", icon: "shirt-outline", cx: 295, go: () => router.push("/wale/wardrobe") },
  { id: "club", label: "Club", icon: "shield-outline", cx: 377, go: () => router.push("/group/discover") },
];

export default function LobbyScreen() {
  const p = useWaleProfile();
  const standing = useGame((s) => s.me?.standing ?? null);
  const quests = useAppSelector((s) => s.quest.quests) as { _id?: string; id?: string; title?: string; category?: string }[] | undefined;
  const event = quests && quests.length > 0 ? quests[0] : null;
  const total = standing ? standing.xp : null;
  const next = standing ? standing.next_level_xp : null;
  const ratio = xpRatio(total, next);
  // the stick: a knob that follows the thumb inside its ring, and a dot it moves on the lobby panel
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const [dot, setDot] = useState({ x: 215, y: 180 });
  const drag = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderMove: (_e, g) => {
        const len = Math.hypot(g.dx, g.dy) || 1;
        const k = Math.min(1, 29 / len);
        const x = g.dx * k;
        const y = g.dy * k;
        setKnob({ x, y });
        setDot((d) => ({ x: Math.max(12, Math.min(418, d.x + x * 0.12)), y: Math.max(12, Math.min(340, d.y + y * 0.12)) }));
      },
      onPanResponderRelease: () => setKnob({ x: 0, y: 0 }),
      onPanResponderTerminate: () => setKnob({ x: 0, y: 0 }),
    }),
  ).current;

  return (
    <DesignCanvas width={FW} height={956} colors={["#DAECF2", "#E8F4F9"]} testID="wale-lobby">
      <At x={16} y={10}>
        <T size={10} weight={700} color={W.pink} spacing={1.2} style={{ lineHeight: 12 }} testID="wale-lobby-kicker">
          COSQUEST
        </T>
      </At>
      <View style={{ position: "absolute", left: 0, top: 22, width: FW, height: 1, backgroundColor: "rgba(255,255,255,0.8)" }} />
      <At x={16} y={37.5} w={44} h={45} style={{ borderRadius: 10, backgroundColor: "rgba(255,255,255,0.7)", alignItems: "center", justifyContent: "center" }} testID="wale-lobby-level">
        <T size={21} weight={700} style={{ lineHeight: 28 }}>{`${p.level ?? 1}`}</T>
      </At>
      <At x={72} y={36} w={280}>
        <T size={15} weight={700} style={{ lineHeight: 22 }} testID="wale-lobby-title">{`COSQUEST · ${p.name}`}</T>
      </At>
      <At x={72} y={62} w={200}>
        <T size={9} weight={500} color={W.inkSoft} testID="wale-lobby-xp-text">{`${spaced(total ?? 0)} / ${spaced(next ?? 0)}`}</T>
      </At>
      <At x={328} y={62} w={30} style={{ alignItems: "flex-end" }}>
        <T size={8.5} weight={700} color={W.pink}>
          XP
        </T>
      </At>
      <At x={72} y={79.5} w={286} h={4} style={{ borderRadius: 2, backgroundColor: W.hair, overflow: "hidden" }} testID="wale-lobby-xp-bar">
        <View style={{ width: 286 * ratio, height: 4, borderRadius: 2, backgroundColor: W.pink }} />
      </At>
      <Tap x={371} y={37.5} w={43.5} h={45} label="Menu" onPress={() => router.push("/wale/settings")} style={{ borderRadius: 10, backgroundColor: "rgba(255,255,255,0.7)" }} testID="wale-lobby-menu">
        <Ionicons name="menu" size={22} color={W.ink} />
      </Tap>
      <View style={{ position: "absolute", left: 0, top: 96, width: FW, height: 1, backgroundColor: "rgba(255,255,255,0.8)" }} />

      {/* counters */}
      {[
        { id: "tickets", x: 16, w: 128, icon: "ticket-outline" as IconName, value: "0", go: () => router.push("/tickets"), ph: true },
        { id: "outfits", x: 151, w: 127, icon: "shirt-outline" as IconName, value: `${OUTFITS.length}`, go: () => router.push("/wale/wardrobe"), ph: false },
        { id: "coins", x: 286, w: 129, icon: "logo-bitcoin" as IconName, value: spaced(p.coins ?? 0), go: () => openGameSheet("coins"), ph: p.coins === null },
      ].map((c) => (
        <Tap key={c.id} x={c.x} y={102.5} w={c.w} h={35} label={`${c.id}: ${c.value}`} onPress={c.go} style={{ borderRadius: 10, backgroundColor: "rgba(255,255,255,0.7)", flexDirection: "row", gap: 9 }} testID={`wale-lobby-counter-${c.id}`}>
          <Ionicons name={c.id === "coins" ? "ellipse-outline" : c.icon} size={17} color={W.pink} />
          <T size={12.5} weight={700} style={{ lineHeight: 17 }}>
            {c.value}
          </T>
        </Tap>
      ))}
      <View style={{ position: "absolute", left: 0, top: 145, width: FW, height: 1, backgroundColor: "rgba(255,255,255,0.8)" }} />

      {/* event banner, portal, free shop */}
      <Tap x={12} y={151} w={260} h={48.5} label={event?.title ? `Event: ${event.title}` : "No event running"} onPress={() => router.push("/quests")} style={{ borderRadius: 10, backgroundColor: "#FFFFFF", flexDirection: "row", justifyContent: "flex-start", paddingLeft: 12, gap: 10 }} testID="wale-lobby-event">
        <Ionicons name="flag-outline" size={18} color={W.pink} />
        <View style={{ flex: 1 }}>
          <T size={9} weight={700} italic upper style={{ lineHeight: 13 }}>
            {event?.title ?? "No event running"}
          </T>
          <T size={8.5} weight={600} color={W.inkSoft} upper style={{ lineHeight: 13 }}>
            {event ? (event.category ?? "Quest") : "Quests open here"}
          </T>
        </View>
      </Tap>
      <Tap x={279.5} y={151} w={66.5} h={48.5} label="Portal" onPress={() => notBuiltYet("The portal")} style={{ borderRadius: 10, backgroundColor: "rgba(255,255,255,0.35)", paddingTop: 5 }} testID="wale-lobby-portal">
        <T size={8} weight={700} color={W.pink} style={{ lineHeight: 13 }}>
          NEW
        </T>
        <T size={8.5} weight={700} style={{ lineHeight: 13 }} testID="wale-lobby-portal-text">
          PORTAL · 0
        </T>
      </Tap>
      <Tap x={353} y={151} w={66} h={48.5} label="Free shop" onPress={() => openGameSheet("coins")} style={{ borderRadius: 10, backgroundColor: "rgba(255,255,255,0.35)", paddingTop: 5 }} testID="wale-lobby-freeshop">
        <T size={8} weight={700} color={W.pink} style={{ lineHeight: 13 }}>
          FREE
        </T>
        <T size={8.5} weight={700} style={{ lineHeight: 13 }} testID="wale-lobby-freeshop-text">
          SHOP
        </T>
      </Tap>

      {/* the lobby view (placeholder) */}
      <At x={0} y={208} w={FW} h={353} style={{ backgroundColor: "#8FA9B5", overflow: "hidden" }} testID="wale-lobby-view">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <View key={`h${i}`} style={{ position: "absolute", left: 0, top: 30 + i * 50, width: FW, height: 1, backgroundColor: "rgba(255,255,255,0.18)" }} />
        ))}
        {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <View key={`v${i}`} style={{ position: "absolute", top: 0, left: 15 + i * 50, width: 1, height: 351, backgroundColor: "rgba(255,255,255,0.18)" }} />
        ))}
        <View style={{ position: "absolute", left: dot.x - 9, top: dot.y - 9, width: 18, height: 18, borderRadius: 9, backgroundColor: W.pink, borderWidth: 2, borderColor: "#FFFFFF" }} />
        <View style={{ position: "absolute", left: 0, top: 150, width: FW, alignItems: "center" }}>
          <T size={11} weight={700} color="#FFFFFF" spacing={0.6}>
            SHARED 3D LOBBY: NOT BUILT YET
          </T>
          <T size={9} weight={500} color="rgba(255,255,255,0.85)">
            Placeholder view. The stick moves the dot.
          </T>
        </View>
      </At>
      <Tap x={257.5} y={218} w={100} h={22.5} label="Free shop" onPress={() => openGameSheet("coins")} style={{ borderRadius: 12, backgroundColor: "#FFFFFF", flexDirection: "row", gap: 5 }} testID="wale-lobby-freeshop-pill">
        <T size={8.5} weight={700} style={{ lineHeight: 12 }}>
          FREE SHOP
        </T>
        <Ionicons name="location-outline" size={11} color={W.pink} />
      </Tap>

      <At x={16} y={579} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: W.pink }} />
        <T size={9} weight={700} spacing={0.4} testID="wale-lobby-label">
          SOCIAL LOBBY
        </T>
      </At>

      {/* controls */}
      <At x={22.5} y={642.5} w={111} h={111} style={{ borderRadius: 56, borderWidth: 2, borderColor: "#FFFFFF", backgroundColor: "rgba(255,255,255,0.15)" }} testID="wale-lobby-stick" />
      <View
        {...drag.panHandlers}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Move"
        testID="wale-lobby-stick-knob"
        style={{ position: "absolute", left: 52 + knob.x, top: 672.5 + knob.y, width: 51, height: 51, borderRadius: 26, backgroundColor: "#FFFFFF", borderWidth: 2, borderColor: W.pink, alignItems: "center", justifyContent: "center" }}
      >
        <Ionicons name="move" size={22} color={W.ink} />
      </View>
      <Tap x={182} y={683.5} w={69.5} h={69.5} label="View profile" onPress={() => router.push("/profile")} style={{ borderRadius: 34, borderWidth: 2, borderColor: "#FFFFFF", backgroundColor: "rgba(255,255,255,0.3)" }} testID="wale-lobby-view-profile">
        <T size={8.5} weight={800} italic align="center" lines={2} style={{ lineHeight: 11 }}>
          {"VIEW\nPROFILE"}
        </T>
      </Tap>
      <Tap x={281} y={627.5} w={124.5} h={124.5} label="Shop" onPress={() => openGameSheet("coins")} style={{ borderRadius: 63, backgroundColor: "#FFFFFF" }} testID="wale-lobby-shop">
        <T size={22} weight={800} italic style={{ lineHeight: 30 }}>
          SHOP
        </T>
      </Tap>

      {/* tabs */}
      <At x={0} y={798} w={FW} h={102.5} style={{ backgroundColor: "rgba(255,255,255,0.45)", borderTopWidth: 1, borderBottomWidth: 1, borderColor: "rgba(255,255,255,0.8)" }} testID="wale-lobby-tabbar" />
      {TABS.map((t) => {
        const on = t.id === "wardrobe";
        return (
          <Tap key={t.id} x={t.cx - 37.25} y={813.5} w={75} h={72.5} label={t.label} onPress={t.go} style={{ borderRadius: 12, backgroundColor: on ? "#FFFFFF" : "rgba(255,255,255,0.35)", gap: 6 }} testID={`wale-lobby-tab-${t.id}`}>
            <Ionicons name={t.icon} size={24} color={on ? W.pink : W.ink} />
            <T size={9.5} weight={700} color={on ? W.pink : W.ink} style={{ lineHeight: 13 }} testID={`wale-lobby-tablabel-${t.id}`}>
              {t.label}
            </T>
          </Tap>
        );
      })}

      {/* chat bar */}
      <Tap x={12} y={905} w={406} h={46} label="Tap to chat" onPress={() => router.push("/chat")} style={{ flexDirection: "row", justifyContent: "flex-start", paddingLeft: 5, gap: 13 }} testID="wale-lobby-chatbar">
        <Ionicons name="chatbubble-outline" size={18} color={W.inkSoft} />
        <T size={11} weight={400} color={W.inkSoft} style={{ flex: 1 }} testID="wale-lobby-chat-text">
          Tap to chat...
        </T>
        <Ionicons name="paper-plane-outline" size={18} color={W.pink} style={{ marginRight: 4 }} />
      </Tap>
      {p.placeholder ? <PlaceholderTag x={150} y={24} text="NOT SIGNED IN: PLACEHOLDER NUMBERS" /> : null}
    </DesignCanvas>
  );
}
