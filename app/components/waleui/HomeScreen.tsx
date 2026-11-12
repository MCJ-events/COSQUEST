// Wale's Homepage (Figma "Cosquest · Homepage mobile", menu closed and menu
// open, 403 x 575). Every block sits where his frame has it.
//
// Over the Figma, from his notes of 11 Nov: there are no gems. His two currency
// slots are CosCoin and XP, so the second pill (a pink gem in the frame) shows
// the player's total XP with his XP shield.
//
// Build 23: the art is his own, cut out of the Figma frames (assets/images/waleui,
// each at the box measured in his frame): the hooded hero, the street web behind
// it, the 3D icons (gear, megaphone, envelope, trophy, add friend, team up,
// swords, wardrobe, shop), the map with its pin, the coin and the XP shield.
// The hero slot shows the player's own faction hero (heroArt.ts), standing in
// the box his character fills, and falls back to his cut-out character only
// when the faction is unknown (signed out, no faction yet). Never the 3D Forge
// avatar. The rank badge stays the code-drawn Roman numeral one (Mark), sized
// to fill the box his badge art fills.
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useState } from "react";

import { RankBadge } from "@/components/game/RankBadge";
import { spaced, xpRatio } from "@/features/waleui/armory";

import { useGame } from "@/features/game/runtime";

import { useProgMe, useWaleProfile } from "./data";
import { notBuiltYet, openGameSheet, openMap } from "./go";
import { useFactionHero } from "./heroArt";
import { Art, At, DesignCanvas, Hexagon, LineIcon, T, Tap, W, glass } from "./kit";

/** His art and the box each piece fills in the 403 x 575 frame (x, y, w, h), measured from the cut-outs. */
const ART = {
  web: { src: require("@/assets/images/waleui/home_web.png"), x: 1, y: 220, w: 254, h: 278 },
  hero: { src: require("@/assets/images/waleui/home_hero.png"), x: 97.25, y: 83.25, w: 153, h: 404.5 },
  xp: { src: require("@/assets/images/waleui/xp_shield.png"), x: 62.75, y: 43.5, w: 16.5, h: 15.25 },
  coin: { src: require("@/assets/images/waleui/coin.png"), x: 205.75, y: 21.5, w: 20.25, h: 17.5 },
  // the second currency slot (his frame: a gem at 278.5, 21.5, 16.5 x 15.5): his XP shield in its place
  xp2: { src: require("@/assets/images/waleui/xp_shield.png"), x: 278.5, y: 21.75, w: 16.5, h: 15.25 },
  map: { src: require("@/assets/images/waleui/map_pin.png"), x: 265.75, y: 326.5, w: 98, h: 73.5 },
} as const;
type Pic = { src: number; x: number; y: number; w: number; h: number };

export const HOME_W = 403;
export const HOME_H = 575;

/** `pic` is the icon's box in the frame; `tx` is where his label starts (frame x). Rows without a picture are centred. */
const LEFT: { id: string; label: string; pic?: Pic; tx?: number; y: number; go: () => void }[] = [
  { id: "add-friend", label: "ADD FRIEND", pic: { src: require("@/assets/images/waleui/icon_add_friend.png"), x: 23.5, y: 90, w: 9, h: 10.25 }, tx: 35, y: 85, go: () => openGameSheet("friends") },
  { id: "team-up", label: "TEAM UP", pic: { src: require("@/assets/images/waleui/icon_team_up.png"), x: 23.75, y: 113.5, w: 15, h: 12.75 }, tx: 41, y: 111.5, go: () => openGameSheet("squad") },
  { id: "faction", label: "FACTION", y: 138, go: () => openGameSheet("ranks") },
  { id: "community", label: "COMMUNITY", y: 164, go: () => router.push("/community") },
];

const RIGHT: { id: string; label: string; pic: Pic; tx: number; y: number; go: () => void }[] = [
  { id: "weapon", label: "WEAPON", pic: { src: require("@/assets/images/waleui/icon_swords.png"), x: 272, y: 224.5, w: 16.75, h: 16.5 }, tx: 292.5, y: 217.5, go: () => router.push("/wale/weapons") },
  { id: "wardrobe", label: "WARDROBE", pic: { src: require("@/assets/images/waleui/icon_wardrobe.png"), x: 275, y: 258, w: 13.75, h: 19 }, tx: 298.5, y: 252.5, go: () => router.push("/wale/wardrobe") },
  { id: "shop", label: "SHOP", pic: { src: require("@/assets/images/waleui/icon_shop.png"), x: 273.75, y: 294, w: 17.5, h: 18 }, tx: 301.5, y: 287.5, go: () => openGameSheet("coins") },
];

const MENU: { id: string; label: string; pic: Pic; tx: number; y: number; size: number; go: () => void }[] = [
  { id: "settings", label: "SETTINGS", pic: { src: require("@/assets/images/waleui/icon_gear.png"), x: 288.75, y: 26.5, w: 21.25, h: 18.75 }, tx: 317.5, y: 22, size: 9, go: () => router.push("/wale/settings") },
  { id: "news", label: "NEWS", pic: { src: require("@/assets/images/waleui/icon_megaphone.png"), x: 291, y: 58.5, w: 17, h: 19.5 }, tx: 316.5, y: 53, size: 9, go: () => notBuiltYet("News") },
  { id: "mails", label: "MAILS", pic: { src: require("@/assets/images/waleui/icon_envelope.png"), x: 288.5, y: 89.75, w: 18.5, h: 21.75 }, tx: 315.5, y: 86.5, size: 9, go: () => router.push("/chat") },
  { id: "leaderboard", label: "LEADERBOARD", pic: { src: require("@/assets/images/waleui/icon_trophy.png"), x: 289.75, y: 123.75, w: 15.25, h: 19 }, tx: 313, y: 119, size: 7.5, go: () => openGameSheet("war") },
];

export default function HomeScreen({ menuOpen = false }: { menuOpen?: boolean }) {
  const [menu, setMenu] = useState(menuOpen);
  const p = useWaleProfile();
  const prog = useProgMe();
  const fh = useFactionHero();
  const totalXp = useGame((s) => s.me?.standing?.xp ?? null);
  const rank = prog?.rank?.number ?? null;
  const ratio = xpRatio(p.xpHave, p.xpNeed);
  return (
    <DesignCanvas width={HOME_W} height={HOME_H} colors={["#C1DEE9", "#D6E9F2", "#E6F2F8"]} testID="wale-home">
      {/* his street web, and on it the player's faction hero (his own character when the faction is unknown) */}
      <Art {...ART.web} source={ART.web.src} testID="wale-home-web" />
      <At x={ART.hero.x} y={ART.hero.y} w={ART.hero.w} h={ART.hero.h} pointerEvents="none" testID="wale-home-hero">
        {fh ? (
          <Image source={fh.full} style={{ width: ART.hero.w, height: ART.hero.h }} contentFit="contain" contentPosition="bottom" accessible accessibilityRole="image" accessibilityLabel={`Your hero: ${fh.name}`} />
        ) : (
          <Image source={ART.hero.src} style={{ width: ART.hero.w, height: ART.hero.h }} contentFit="fill" accessible accessibilityRole="image" accessibilityLabel="Your hero" />
        )}
      </At>

      {/* top bar */}
      <At x={0} y={0} w={403} h={66} style={[glass(0, "rgba(255,255,255,0.22)"), { borderTopWidth: 0, borderLeftWidth: 0, borderRightWidth: 0, borderBottomLeftRadius: 14, borderBottomRightRadius: 14 }]} testID="wale-home-topbar" />
      <At x={53} y={22} w={116} h={18} style={[glass(8, "rgba(255,255,255,0.3)"), { justifyContent: "center", paddingLeft: 17 }]} testID="wale-home-nameplate">
        <T size={12.5} weight={700} color="#000000" style={{ lineHeight: 16 }} testID="wale-home-name">
          {p.name}
        </T>
      </At>
      <At x={17} y={16} w={43} h={43} style={{ borderRadius: 22, backgroundColor: "#C9C3DA", overflow: "hidden", alignItems: "center", justifyContent: "center" }} testID="wale-home-avatar">
        {p.avatar ? <Image source={p.avatar as never} style={{ width: 43, height: 43 }} contentFit="cover" /> : <Ionicons name="person" size={24} color="#FFFFFF" />}
      </At>
      <Art {...ART.xp} source={ART.xp.src} testID="wale-home-xp-icon" />
      <At x={81} y={49} w={88} h={7} style={{ borderRadius: 4, backgroundColor: "#FFFFFF", overflow: "hidden" }} testID="wale-home-xp-bar">
        <LinearGradient colors={["#6A3FD0", "#B9A7F0"]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={{ width: 88 * ratio, height: 7, borderRadius: 4 }} />
      </At>
      <At x={220} y={25} w={51} h={13} style={[glass(7, "rgba(255,255,255,0.3)"), { alignItems: "flex-end", justifyContent: "center", paddingRight: 10 }]} testID="wale-home-coins">
        <T size={9} weight={400} style={{ lineHeight: 11 }} testID="wale-home-coins-text">
          {p.coins === null ? "0" : spaced(p.coins)}
        </T>
      </At>
      <Art {...ART.coin} source={ART.coin.src} testID="wale-home-coin-icon" />
      {/* the second currency slot: total XP (hidden under the open menu, as in his frame) */}
      {!menu ? (
        <>
          <At x={295} y={25} w={51} h={13} style={[glass(7, "rgba(255,255,255,0.3)"), { alignItems: "flex-end", justifyContent: "center", paddingRight: 10 }]} testID="wale-home-xp-total">
            <T size={9} weight={400} style={{ lineHeight: 11 }} testID="wale-home-xp-total-text">
              {totalXp === null ? "0" : spaced(totalXp)}
            </T>
          </At>
          <Art {...ART.xp2} source={ART.xp2.src} testID="wale-home-xp-total-icon" />
        </>
      ) : null}

      {/* left column */}
      <At x={11} y={73} w={82} h={119} style={glass(6, "rgba(255,255,255,0.12)")} testID="wale-home-left" />
      {LEFT.map((b) => (
        <Tap key={b.id} x={19} y={b.y} w={64} h={19} label={b.label} onPress={b.go} style={[glass(9, "rgba(255,255,255,0.35)"), b.tx ? { flexDirection: "row", justifyContent: "flex-start", paddingLeft: b.tx - 19 - 1 } : null]} testID={`wale-home-${b.id}`}>
          {b.pic ? <Art x={b.pic.x - 19 - 1} y={b.pic.y - b.y - 1} w={b.pic.w} h={b.pic.h} source={b.pic.src} /> : null}
          <T size={6.5} weight={700} style={{ lineHeight: 9 }}>
            {b.label}
          </T>
        </Tap>
      ))}

      {/* rank badge (hidden under the open menu in his frame) */}
      {!menu ? (
        <Tap x={265.25} y={100.25} w={93} h={104.25} label={rank ? `Your rank: ${rank}` : "Ranks"} onPress={() => openGameSheet("ranks")} testID="wale-home-rank">
          {/* his badge art fills (272.5, 104) 78.5 x 98.5; the drawn shield is 84% of its own box, so size 93 fills that */}
          <RankBadge rank={rank ?? 1} total={10} size={93} />
        </Tap>
      ) : null}

      {/* right column */}
      <At x={256} y={208} w={121} h={233} style={glass(14, "rgba(255,255,255,0.28)")} testID="wale-home-right" />
      {RIGHT.map((b) => (
        <Tap key={b.id} x={265} y={b.y} w={103} h={30} label={b.label} onPress={b.go} style={[glass(8, "rgba(255,255,255,0.55)"), { flexDirection: "row", justifyContent: "flex-start", paddingLeft: b.tx - 265 - 1 }]} testID={`wale-home-${b.id}`}>
          <Art x={b.pic.x - 265 - 1} y={b.pic.y - b.y - 1} w={b.pic.w} h={b.pic.h} source={b.pic.src} />
          <T size={9.5} weight={700} color={W.inkSoft} spacing={0.6} style={{ lineHeight: 13 }}>
            {b.label}
          </T>
        </Tap>
      ))}
      <Art {...ART.map} source={ART.map.src} testID="wale-home-map-art" />
      <Tap x={265} y={408} w={103} h={32} label="Open map" onPress={openMap} style={{ backgroundColor: W.green, borderRadius: 8 }} testID="wale-home-open-map">
        <T size={9} weight={700} color="#FFFFFF" style={{ lineHeight: 12 }}>
          OPEN MAP
        </T>
      </Tap>

      {/* ENTER QUEST */}
      <Tap x={17} y={502} w={369} h={60} label="Enter quest" onPress={() => router.push("/quests")} style={{ backgroundColor: W.pink, borderRadius: 14, flexDirection: "row", gap: 9, shadowColor: W.pink, shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 5 } }} testID="wale-home-enter-quest">
        <Hexagon w={17} h={19} />
        <T size={19} weight={800} color="#FFFFFF" spacing={0.6} style={{ lineHeight: 26 }}>
          ENTER QUEST
        </T>
      </Tap>

      {/* menu */}
      {menu ? (
        <>
          <At x={277} y={15.5} w={110} h={138} style={{ borderRadius: 10, backgroundColor: "rgba(200,196,222,0.86)" }} testID="wale-home-menu" />
          {MENU.map((m) => (
            <Tap key={m.id} x={283} y={m.y} w={98} h={28.5} label={m.label} onPress={m.go} style={[glass(7, "rgba(255,255,255,0.5)"), { flexDirection: "row", justifyContent: "flex-start", paddingLeft: m.tx - 283 - 1 }]} testID={`wale-home-menu-${m.id}`}>
              <Art x={m.pic.x - 283 - 1} y={m.pic.y - m.y - 1} w={m.pic.w} h={m.pic.h} source={m.pic.src} />
              <T size={m.size} weight={700} spacing={0.5} style={{ lineHeight: 13 }}>
                {m.label}
              </T>
            </Tap>
          ))}
          {/* a tap anywhere else closes it */}
          <Tap x={0} y={160} w={403} h={330} label="Close menu" onPress={() => setMenu(false)} testID="wale-home-menu-close" />
        </>
      ) : (
        <Tap x={352} y={15} w={39} h={42} label="Menu" onPress={() => setMenu(true)} style={glass(10, "rgba(255,255,255,0.6)")} testID="wale-home-menu-button">
          <LineIcon name="menu" size={19.5} />
        </Tap>
      )}
    </DesignCanvas>
  );
}
