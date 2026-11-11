// Wale's Wardrobe (Figma "Cosquest · Wardrobe mobile", 403 x 1308): the two
// saved looks, STYLE and EMOTES, the five round shortcuts, the "Make it yours"
// list and RANDOMIZE. The looks are saved on the phone (lookStore.ts).
//
// The same wardrobe for every faction (Wale, 11 Nov). Emotes and Companion
// have no design behind them yet, so they say so when tapped.
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { EYE_COLORS, HAIR_COLORS, type Look, OUTFITS, SKIN_TONES, activeLook, lookSummary, randomLook } from "@/features/waleui/look";

import { back, notBuiltYet } from "./go";
import { At, Band, DesignCanvas, Footer, type IconName, IconTile, PreviewSlot, T, Tap, W, glass } from "./kit";
import { chooseSlot, setLook, useWardrobe } from "./lookStore";

const FW = 403;

export const tintOf = (l: Look) => ({ skin: SKIN_TONES[l.skin].color, hair: HAIR_COLORS[l.hairColor].color, outfit: OUTFITS[l.outfit].color.color, eye: EYE_COLORS[l.eye].color });

type TabId = "faces" | "hair" | "headwear" | "outfits";
const openTab = (tab: TabId) => router.push({ pathname: "/wale/customise", params: { tab } });

const ROWS: { id: string; label: string; icon: IconName; y: number; go: () => void }[] = [
  { id: "face", label: "Face", icon: "happy-outline", y: 813, go: () => openTab("faces") },
  { id: "hair", label: "Hair", icon: "cut-outline", y: 883, go: () => openTab("hair") },
  { id: "headwear", label: "Headwear", icon: "glasses-outline", y: 953, go: () => openTab("headwear") },
  { id: "outfit", label: "Outfit", icon: "shirt-outline", y: 1023.5, go: () => openTab("outfits") },
  { id: "companion", label: "Companion", icon: "paw-outline", y: 1093.5, go: () => notBuiltYet("Companion") },
];

const CIRCLES: { id: string; label: string; icon: IconName; cx: number; go: () => void }[] = [
  { id: "face", label: "Face", icon: "happy", cx: 52.5, go: () => openTab("faces") },
  { id: "hair", label: "Hair", icon: "cut", cx: 127, go: () => openTab("hair") },
  { id: "headwear", label: "Headwear", icon: "glasses", cx: 200.6, go: () => openTab("headwear") },
  { id: "outfit", label: "Outfit", icon: "shirt", cx: 275, go: () => openTab("outfits") },
  { id: "companion", label: "Companion", icon: "paw", cx: 348.75, go: () => notBuiltYet("Companion") },
];

export default function WardrobeScreen() {
  const wardrobe = useWardrobe();
  const look = activeLook(wardrobe);
  const [tab, setTab] = useState<"style" | "emotes">("style");
  return (
    <DesignCanvas width={FW} height={1308} colors={["#BADCE8", "#D3E9F2"]} testID="wale-wardrobe">
      <Band y={0} h={79} w={FW} line="bottom" />
      <IconTile x={16} y={17.5} size={44} icon="arrow-back" label="Back" onPress={() => back()} testID="wale-wardrobe-back" />
      <At x={72} y={20}>
        <T size={10} weight={700} color={W.pink} spacing={1.2} testID="wale-wardrobe-kicker">
          COSQUEST
        </T>
      </At>
      <At x={72} y={34}>
        <T size={22} weight={700} style={{ lineHeight: 30 }} testID="wale-wardrobe-title">
          Wardrobe
        </T>
      </At>
      <IconTile x={342} y={17.5} size={44} icon="close" label="Close" onPress={() => back()} testID="wale-wardrobe-close" />

      <At x={16} y={105}>
        <T size={9.5} weight={500} color={W.inkSoft} testID="wale-wardrobe-yourlooks">
          YOUR LOOKS
        </T>
      </At>
      <Tap x={299} y={103} w={90} h={18} label="More options" onPress={() => notBuiltYet("More options")} style={{ flexDirection: "row", justifyContent: "flex-end", gap: 5 }} testID="wale-wardrobe-more">
        <Ionicons name="ellipsis-horizontal" size={12} color={W.ink} />
        <T size={10} weight={700} align="right" testID="wale-wardrobe-more-text">
          More options
        </T>
      </Tap>

      {([0, 1] as const).map((slot) => {
        const on = wardrobe.active === slot;
        return (
          <Tap key={slot} x={slot === 0 ? 16 : 178} y={138} w={slot === 0 ? 154 : 152.6} h={47.5} label={`Style ${slot + 1}`} selected={on} onPress={() => chooseSlot(slot)} style={{ borderRadius: 10, backgroundColor: on ? "#FFFFFF" : "rgba(255,255,255,0.3)", flexDirection: "row", justifyContent: "flex-start", paddingLeft: 13, gap: 8 }} testID={`wale-wardrobe-style-${slot + 1}`}>
            <Ionicons name={on ? "shirt-outline" : "add"} size={16} color={on ? W.pink : W.inkSoft} />
            <T size={10} weight={700} color={on ? W.pink : W.inkSoft} spacing={0.4}>{`STYLE ${slot + 1}`}</T>
            {on ? <View style={{ width: 2.5, height: 15, borderRadius: 1, backgroundColor: W.pink }} /> : null}
          </Tap>
        );
      })}
      <Tap x={337.5} y={138} w={48.5} h={47.5} label="Randomize this look" onPress={() => setLook(randomLook())} style={{ borderRadius: 10, backgroundColor: "rgba(255,255,255,0.3)" }} testID="wale-wardrobe-dice">
        <Ionicons name="dice-outline" size={20} color={W.inkSoft} />
      </Tap>

      <At x={59} y={195} w={285} h={375} testID="wale-wardrobe-hero">
        <PreviewSlot w={285} h={375} shape="body" tint={tintOf(look)} headwear={look.headwear} label={`Your look: ${lookSummary(look)} (placeholder figure)`} />
      </At>

      <Tap x={16} y={575} w={180.5} h={48} label="Style" selected={tab === "style"} onPress={() => setTab("style")} style={{ borderRadius: 10, backgroundColor: tab === "style" ? "#FFFFFF" : "rgba(255,255,255,0.3)", flexDirection: "row", justifyContent: "flex-start", paddingLeft: 18, gap: 12 }} testID="wale-wardrobe-tab-style">
        <T size={10.5} weight={700} color={tab === "style" ? W.pink : W.inkSoft} spacing={0.5}>
          STYLE
        </T>
        {tab === "style" ? <View style={{ width: 2.5, height: 17, borderRadius: 1, backgroundColor: W.pink }} /> : null}
      </Tap>
      <Tap x={207.5} y={575} w={178.5} h={48} label="Emotes" selected={tab === "emotes"} onPress={() => setTab("emotes")} style={{ borderRadius: 10, backgroundColor: tab === "emotes" ? "#FFFFFF" : "rgba(255,255,255,0.3)", flexDirection: "row", justifyContent: "flex-start", paddingLeft: 18, gap: 12 }} testID="wale-wardrobe-tab-emotes">
        <T size={10.5} weight={700} color={tab === "emotes" ? W.pink : W.inkSoft} spacing={0.5}>
          EMOTES
        </T>
        {tab === "emotes" ? <View style={{ width: 2.5, height: 17, borderRadius: 1, backgroundColor: W.pink }} /> : null}
      </Tap>

      {CIRCLES.map((c) => (
        <Tap key={c.id} x={c.cx - 25} y={640} w={50} h={50} label={c.label} onPress={c.go} style={{ borderRadius: 25, backgroundColor: W.purple, borderBottomWidth: 3, borderBottomColor: W.purpleDeep }} testID={`wale-wardrobe-circle-${c.id}`}>
          <Ionicons name={c.icon} size={24} color="#FFFFFF" />
        </Tap>
      ))}

      <At x={17.5} y={710.5} w={369} h={522} style={{ borderRadius: 18, backgroundColor: "rgba(255,255,255,0.72)" }} testID="wale-wardrobe-card" />
      <At x={35} y={728}>
        <T size={20} weight={700} style={{ lineHeight: 28 }} testID="wale-wardrobe-card-title">
          {tab === "style" ? "Make it yours" : "Emotes"}
        </T>
      </At>
      <At x={35} y={769} w={335}>
        <T size={11.5} weight={400} color={W.inkSoft} testID="wale-wardrobe-card-sub">
          {tab === "style" ? "Customize your style, from head to companion." : "Emotes are not designed yet. They will list here."}
        </T>
      </At>
      <View style={{ position: "absolute", left: 35, top: 799, width: 335, height: 1, backgroundColor: "rgba(40,66,78,0.18)" }} />
      {tab === "style"
        ? ROWS.map((r) => (
            <Tap key={r.id} x={34} y={r.y} w={335} h={61} label={r.label} onPress={r.go} style={{ borderRadius: 10, backgroundColor: "#FFFFFF", flexDirection: "row", justifyContent: "flex-start", paddingLeft: 17, gap: 15 }} testID={`wale-wardrobe-row-${r.id}`}>
              <Ionicons name={r.icon} size={22} color={W.pink} />
              <T size={13.5} weight={700} style={{ flex: 1 }}>
                {r.label}
              </T>
              <Ionicons name="chevron-forward" size={13} color={W.ink} style={{ marginRight: 12 }} />
            </Tap>
          ))
        : null}
      <Tap x={34} y={1168} w={335} h={48} label="Randomize" onPress={() => setLook(randomLook())} style={{ borderRadius: 10, backgroundColor: "#FFFFFF", flexDirection: "row", gap: 9 }} testID="wale-wardrobe-randomize">
        <Ionicons name="dice-outline" size={15} color={W.ink} />
        <T size={11.5} weight={700} spacing={0.4}>
          RANDOMIZE
        </T>
      </Tap>
      <View style={{ position: "absolute", left: 0, top: 1254, width: FW, height: 1, backgroundColor: "rgba(255,255,255,0.7)" }} />
      <Footer y={1281} w={FW} path="COSQUEST  /  WARDROBE" testID="wale-wardrobe-footer" />
    </DesignCanvas>
  );
}
