// Wale's Wardrobe (Figma "Cosquest · Wardrobe mobile", 403 x 1308): the two
// saved looks, STYLE and EMOTES, the five round shortcuts, the "Make it yours"
// list and RANDOMIZE. The looks are saved on the phone (lookStore.ts).
//
// The same wardrobe for every faction (Wale, 11 Nov). Emotes and Companion
// have no design behind them yet, so they say so when tapped.
//
// The art is Wale's own, cut from his frame (custArt.tsx): the character, the
// white glyphs in the round buttons and his line icons. The character is his
// action pose for outfit 1 and his standing picture for outfits 2 to 4 (he
// drew the action pose for outfit 1 only). Face, hair, headwear and colour
// choices are saved but cannot change a flat picture.
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { activeLook, lookSummary, randomLook } from "@/features/waleui/look";

import { ART, Art, Ico, wardrobeArt } from "./custArt";
import { BOX } from "./custArtBoxes";
import { back, notBuiltYet } from "./go";
import { At, Band, DesignCanvas, Footer, T, Tap, W } from "./kit";
import { chooseSlot, setLook, useWardrobe } from "./lookStore";

const FW = 403;
const TILE = { backgroundColor: "rgba(255,255,255,0.75)", borderRadius: 10 } as const;

type TabId = "faces" | "hair" | "headwear" | "outfits";
const openTab = (tab: TabId) => router.push({ pathname: "/wale/customise", params: { tab } });

type PartId = "face" | "hair" | "headwear" | "outfit" | "companion";

const ROWS: { id: PartId; label: string; y: number; go: () => void }[] = [
  { id: "face", label: "Face", y: 813, go: () => openTab("faces") },
  { id: "hair", label: "Hair", y: 883, go: () => openTab("hair") },
  { id: "headwear", label: "Headwear", y: 953, go: () => openTab("headwear") },
  { id: "outfit", label: "Outfit", y: 1023.5, go: () => openTab("outfits") },
  { id: "companion", label: "Companion", y: 1093.5, go: () => notBuiltYet("Companion") },
];

const CIRCLES: { id: PartId; label: string; cx: number; go: () => void }[] = [
  { id: "face", label: "Face", cx: 52.5, go: () => openTab("faces") },
  { id: "hair", label: "Hair", cx: 127, go: () => openTab("hair") },
  { id: "headwear", label: "Headwear", cx: 200.6, go: () => openTab("headwear") },
  { id: "outfit", label: "Outfit", cx: 275, go: () => openTab("outfits") },
  { id: "companion", label: "Companion", cx: 348.75, go: () => notBuiltYet("Companion") },
];

export default function WardrobeScreen() {
  const wardrobe = useWardrobe();
  const look = activeLook(wardrobe);
  const [tab, setTab] = useState<"style" | "emotes">("style");
  const hero = wardrobeArt(look.outfit);
  return (
    <DesignCanvas width={FW} height={1308} colors={["#BADCE8", "#D3E9F2"]} testID="wale-wardrobe">
      <Band y={0} h={79} w={FW} line="bottom" />
      <Tap x={16} y={17.5} w={44} h={44} label="Back" onPress={() => back()} style={TILE} testID="wale-wardrobe-back">
        <Ico source={ART.ic.arrowBack} size={22} color={W.ink} />
      </Tap>
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
      <Tap x={342} y={17.5} w={44} h={44} label="Close" onPress={() => back()} style={TILE} testID="wale-wardrobe-close">
        <Ico source={ART.ic.close} size={22} color={W.ink} />
      </Tap>

      <At x={16} y={105}>
        <T size={9.5} weight={500} color={W.inkSoft} testID="wale-wardrobe-yourlooks">
          YOUR LOOKS
        </T>
      </At>
      <Tap x={271} y={103} w={115} h={18} label="More options" onPress={() => notBuiltYet("More options")} style={{ flexDirection: "row", justifyContent: "flex-end", gap: 4 }} testID="wale-wardrobe-more">
        <Ico source={ART.ic.more} size={14} color={W.ink} />
        <T size={10} weight={700} align="right" testID="wale-wardrobe-more-text">
          More options
        </T>
      </Tap>

      {([0, 1] as const).map((slot) => {
        const on = wardrobe.active === slot;
        return (
          <Tap key={slot} x={slot === 0 ? 16 : 178} y={138} w={slot === 0 ? 154 : 152.6} h={47.5} label={`Style ${slot + 1}`} selected={on} onPress={() => chooseSlot(slot)} style={{ borderRadius: 10, backgroundColor: on ? "#FFFFFF" : "rgba(255,255,255,0.3)", flexDirection: "row", justifyContent: "flex-start", paddingLeft: 12, gap: 5 }} testID={`wale-wardrobe-style-${slot + 1}`}>
            <Ico source={on ? ART.ic.outfit : ART.ic.plus} size={20} color={on ? W.pink : W.inkSoft} />
            <T size={10.5} weight={700} color={on ? W.pink : W.inkSoft} spacing={0.4}>{`STYLE ${slot + 1}`}</T>
            {on ? <View style={{ width: 2.5, height: 15, borderRadius: 1, backgroundColor: W.pink }} /> : null}
          </Tap>
        );
      })}
      <Tap x={337.5} y={138} w={48.5} h={47.5} label="Randomize this look" onPress={() => setLook(randomLook())} style={{ borderRadius: 10, backgroundColor: "rgba(255,255,255,0.3)" }} testID="wale-wardrobe-dice">
        <Ico source={ART.ic.dice} size={22} color={W.inkSoft} />
      </Tap>

      <At x={59} y={195} w={285} h={375} testID="wale-wardrobe-hero">
        <Art source={hero.source} box={hero.box} dx={59} dy={195} label={`Your look: ${lookSummary(look)}`} testID="wale-wardrobe-hero-art" />
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
          <Art source={ART.circle[c.id]} box={BOX.circle[c.id]} dx={c.cx - 25} dy={640} />
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
          {tab === "style" ? "Customize your style, from head to companion." : "Emotes are not in the app yet."}
        </T>
      </At>
      <View style={{ position: "absolute", left: 35, top: 799, width: 335, height: 1, backgroundColor: "rgba(40,66,78,0.18)" }} />
      {tab === "style"
        ? ROWS.map((r) => (
            <Tap key={r.id} x={34} y={r.y} w={335} h={61} label={r.label} onPress={r.go} style={{ borderRadius: 10, backgroundColor: "#FFFFFF", flexDirection: "row", justifyContent: "flex-start", paddingLeft: 17, gap: 13 }} testID={`wale-wardrobe-row-${r.id}`}>
              <Ico source={ART.ic[r.id]} size={24} color={W.pink} />
              <T size={14.5} weight={700} style={{ flex: 1 }}>
                {r.label}
              </T>
              <Ico source={ART.ic.chevron} size={18} color={W.ink} style={{ marginRight: 17 }} />
            </Tap>
          ))
        : null}
      <Tap x={34} y={1168} w={335} h={48} label="Randomize" onPress={() => setLook(randomLook())} style={{ borderRadius: 10, backgroundColor: "#FFFFFF", flexDirection: "row", gap: 6 }} testID="wale-wardrobe-randomize">
        <Ico source={ART.ic.dice} size={18} color={W.ink} />
        <T size={11.5} weight={700} spacing={0.4}>
          RANDOMIZE
        </T>
      </Tap>
      <View style={{ position: "absolute", left: 0, top: 1254, width: FW, height: 1, backgroundColor: "rgba(255,255,255,0.7)" }} />
      <Footer y={1281} w={FW} path="COSQUEST  /  WARDROBE" testID="wale-wardrobe-footer" />
    </DesignCanvas>
  );
}
