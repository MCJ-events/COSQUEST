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
// Build 29: the hero slot shows the character the player picked (else their faction hero) as its 2D art
// (heroArt.ts), and tapping it opens the character picker. Before: the player's own faction hero (heroArt.ts), standing in
// the box his character fills, and falls back to his cut-out character only
// when the faction is unknown (signed out, no faction yet). Never the 3D Forge
// avatar. The rank badge is his own badge art for the player's rank
// (RankBadgeArt.tsx) with the rank as a Roman numeral on the tab (Mark).
//
// Build 27 (Wale on build 26: "this circled part is a lot of space in the app on
// iPhone, it does not fit the screen"): the canvas fills the room between the
// status bar and the tab bar (kit.tsx DesignCanvas fit, features/waleui/fit.ts).
// The spare height goes to the middle of his frame: the header, the column under
// it, the rank badge and the menu stay where he put them; ENTER QUEST keeps his
// 13 px above the tab bar; the hero and the street web grow with the room (the
// hero no wider than the gap beside the right-hand panel) and the panel moves
// with the hero's body. At his frame's size nothing moves.
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { spaced, xpRatio } from "@/features/waleui/armory";
import { homeStretch } from "@/features/waleui/fit";

import { fetchPayConfig } from "@/features/game/payLink";
import { gameStore, useGame } from "@/features/game/runtime";

import { showEvents, showReferrals } from "@/features/game/briefFeatures";

import { useBriefFlags } from "./brief/briefKit";
import { useProgMe, useWaleProfile } from "./data";
import { notBuiltYet, openGameSheet, openMap } from "./go";
import { useFactionHero } from "./heroArt";
import { HeroIdle } from "./HeroIdle";
import { BADGE_CELL, WaleRankBadge } from "./RankBadgeArt";
import { Art, At, DesignCanvas, Hexagon, LineIcon, T, Tap, W, glass, useCanvasExtra } from "./kit";

/** His art and the box each piece fills in the 403 x 575 frame (x, y, w, h), measured from the cut-outs. */
const ART = {
  web: { src: require("@/assets/images/waleui/home_web.png"), x: 1, y: 220, w: 254, h: 278 },
  hero: { src: require("@/assets/images/waleui/home_hero.png"), x: 97.25, y: 83.25, w: 153, h: 404.5 },
  xp: { src: require("@/assets/images/waleui/xp_shield.png"), x: 62.75, y: 43.5, w: 16.5, h: 15.25 },
  coin: { src: require("@/assets/images/waleui/coin.png"), x: 205.75, y: 21.5, w: 20.25, h: 17.5 },
  // the second currency slot: his pink XP coin, as drawn in that slot
  xp2: { src: require("@/assets/images/waleui/xp_coin.png"), x: 278, y: 20.75, w: 17.5, h: 17.75 },
  map: { src: require("@/assets/images/waleui/map_pin.png"), x: 265.75, y: 326.5, w: 98, h: 73.5 },
} as const;
type Pic = { src: number; x: number; y: number; w: number; h: number };

/** His badge's box on the Homepage, and the scale that puts rank IV's badge exactly in it. */
const BADGE_BOX = { x: 272.5, y: 104, w: 78.5, h: 98.5 };
const BADGE_K = BADGE_BOX.w / BADGE_CELL.badge.w;

/** What getAvatarSource gives a profile with no photo and no preset. */
const DEFAULT_AVATAR = require("@/assets/images/dp-avatar.png");

export const HOME_W = 403;
export const HOME_H = 575;

/** `pic` is the icon's box in the frame; `tx` is where his label starts (frame x). Rows without a picture are centred. */
const LEFT: { id: string; label: string; pic?: Pic; tx?: number; y: number; go: () => void }[] = [
  { id: "add-friend", label: "ADD FRIEND", pic: { src: require("@/assets/images/waleui/icon_add_friend.png"), x: 23.5, y: 90, w: 9, h: 10.25 }, tx: 35, y: 85, go: () => openGameSheet("friends") },
  { id: "team-up", label: "TEAM UP", pic: { src: require("@/assets/images/waleui/icon_team_up.png"), x: 23.75, y: 113.5, w: 15, h: 12.75 }, tx: 41, y: 111.5, go: () => openGameSheet("squad") },
  { id: "faction", label: "FACTION", y: 138, go: () => router.push("/wale/faction") },
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

/** One menu row's step in his frame (the four rows sit 31 to 34 px apart). */
const MENU_STEP = 32.5;

/**
 * Rows added under his four when the server has the feature on (13 Nov 2026, the brief features):
 * INVITE (referrals) and EVENTS (event stations). With the flags off the menu is his frame exactly.
 */
function extraMenu(flags: ReturnType<typeof useBriefFlags>): typeof MENU {
  const rows: { id: string; label: string; src: number; w: number; h: number; go: () => void }[] = [];
  if (showReferrals(flags)) rows.push({ id: "invite", label: "INVITE", src: require("@/assets/images/waleui/icon_team_up.png"), w: 18, h: 15.25, go: () => router.push("/wale/invite") });
  if (showEvents(flags)) rows.push({ id: "events", label: "EVENTS", src: require("@/assets/images/waleui/map_pin.png"), w: 20, h: 15, go: () => router.push("/wale/event") });
  return rows.map((r, i) => {
    const y = 119 + MENU_STEP * (i + 1);
    return { id: r.id, label: r.label, pic: { src: r.src, x: 289, y: y + 5, w: r.w, h: r.h }, tx: 313, y, size: 9, go: r.go };
  });
}

/**
 * `inTabs`: drawn as the Home tab, so the canvas ends at the top of the floating tab bar
 * (app/(tabs)/home.tsx); the /wale/home link has no tab bar and fills to the home bar inset.
 */
export default function HomeScreen({ menuOpen = false, inTabs = false }: { menuOpen?: boolean; inTabs?: boolean }) {
  return (
    <DesignCanvas width={HOME_W} height={HOME_H} colors={["#C1DEE9", "#D6E9F2", "#E6F2F8"]} testID="wale-home" fit={inTabs ? "tabs" : "screen"}>
      <HomeFrame menuOpen={menuOpen} />
    </DesignCanvas>
  );
}

function HomeFrame({ menuOpen }: { menuOpen: boolean }) {
  const extra = useCanvasExtra();
  const fit = homeStretch(extra);
  const dy = fit.rightDy;
  const [menu, setMenu] = useState(menuOpen);
  const briefFlags = useBriefFlags();
  const extras = extraMenu(briefFlags);
  const menuRows = [...MENU, ...extras];
  const grow = MENU_STEP * extras.length;
  const p = useWaleProfile();
  // payments: the Wallet is reachable only when the server has the pay routes on (features/game/payLink.ts: 404 = null)
  const [payOn, setPayOn] = useState(false);
  useEffect(() => {
    let live = true;
    fetchPayConfig(gameStore.client)
      .then((c) => {
        if (live) setPayOn(c !== null);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  const prog = useProgMe();
  const fh = useFactionHero();
  const totalXp = useGame((s) => s.me?.standing?.xp ?? null);
  // the app's generic picture and the default "adventurer" preset count as no avatar here (only in this
  // slot, features/waleui/homeAvatar.ts): then his round frame shows the player's faction hero bust
  const ownAvatar = !!p.homeAvatar && p.homeAvatar !== DEFAULT_AVATAR;
  const rank = prog?.rank?.number ?? null;
  const ratio = xpRatio(p.xpHave, p.xpNeed);
  return (
    <>
      {/* his street web, and on it the player's faction hero (his own character when the faction is unknown); both grow
          with the room on a tall phone, the web cut at his edge beside the right-hand panel */}
      <At x={fit.web.x} y={fit.web.y} w={ART.web.w} h={fit.web.h} style={{ overflow: "hidden" }} pointerEvents="none">
        <Art x={0} y={0} w={fit.web.w} h={fit.web.h} source={ART.web.src} testID="wale-home-web" />
      </At>
      <At x={fit.hero.x} y={fit.hero.y} w={fit.hero.w} h={fit.hero.h} pointerEvents="none" testID="wale-home-hero">
        {/* Wale (13 Nov): the hero idles in place, breathing and shifting its weight about its planted feet */}
        <HeroIdle testID="wale-home-hero-idle">
        {fh ? (
          <Image source={fh.full} style={{ width: fit.hero.w, height: fit.hero.h }} contentFit="contain" contentPosition="bottom" accessible accessibilityRole="image" accessibilityLabel={`Your hero: ${fh.name}`} />
        ) : (
          <Image source={ART.hero.src} style={{ width: fit.hero.w, height: fit.hero.h }} contentFit="contain" contentPosition="bottom" accessible accessibilityRole="image" accessibilityLabel="Your hero" />
        )}
        </HeroIdle>
      </At>
      {/* build 29: tap your character to pick who you are (the character picker) */}
      <Tap x={fit.hero.x} y={fit.hero.y} w={fit.hero.w} h={fit.hero.h} label={fh ? `Your character: ${fh.name}. Change character` : "Pick your character"} onPress={() => router.push("/wale/character" as never)} testID="wale-home-hero-pick" />

      {/* top bar */}
      <At x={0} y={0} w={403} h={66} style={[glass(0, "rgba(255,255,255,0.22)"), { borderTopWidth: 0, borderLeftWidth: 0, borderRightWidth: 0, borderBottomLeftRadius: 14, borderBottomRightRadius: 14 }]} testID="wale-home-topbar" />
      <At x={53} y={22} w={116} h={18} style={[glass(8, "rgba(255,255,255,0.3)"), { justifyContent: "center", paddingLeft: 17 }]} testID="wale-home-nameplate">
        <T size={12.5} weight={700} color="#000000" style={{ lineHeight: 16 }} testID="wale-home-name">
          {p.name}
        </T>
      </At>
      <At x={17} y={16} w={43} h={43} style={{ borderRadius: 22, backgroundColor: "#C9C3DA", overflow: "hidden", alignItems: "center", justifyContent: "center" }} testID="wale-home-avatar">
        {ownAvatar ? (
          <Image source={p.homeAvatar as never} style={{ width: 43, height: 43 }} contentFit="cover" />
        ) : fh ? (
          <Image source={fh.bust} style={{ width: 43, height: 43 }} contentFit="cover" contentPosition="top" accessible accessibilityRole="image" accessibilityLabel={fh.name} />
        ) : (
          <Ionicons name="person" size={24} color="#FFFFFF" />
        )}
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
      {/* the CosCoin pill opens the Wallet (balance and history from the server; app/wallet.tsx), only on a
          server with payments on (/v1/pay/config answers): production 404s it, so build 25 looks like build 24 there */}
      {payOn ? (
        <Tap x={203} y={18} w={70} h={24} label={`Wallet: ${p.coins === null ? 0 : p.coins} CosCoins`} onPress={() => router.push("/wallet")} testID="wale-home-wallet" />
      ) : null}
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
        <Tap x={272.5} y={107.5} w={78} h={94} label={rank ? `Your rank: ${rank}` : "Ranks"} onPress={() => openGameSheet("ranks")} testID="wale-home-rank">
          {/* his own badge for the player's rank; rank IV's badge fills his art's box (272.5, 104) 78.5 x 98.5 exactly */}
          <View pointerEvents="none" style={{ position: "absolute", left: BADGE_BOX.x - 272.5 - BADGE_CELL.badge.x * BADGE_K, top: BADGE_BOX.y - 107.5 - BADGE_CELL.badge.y * BADGE_K }}>
            <WaleRankBadge rank={rank ?? 1} width={BADGE_CELL.w * BADGE_K} />
          </View>
        </Tap>
      ) : null}

      {/* right column */}
      <At x={256} y={208 + dy} w={121} h={233} style={glass(14, "rgba(255,255,255,0.28)")} testID="wale-home-right" />
      {RIGHT.map((b) => (
        <Tap key={b.id} x={265} y={b.y + dy} w={103} h={30} label={b.label} onPress={b.go} style={[glass(8, "rgba(255,255,255,0.55)"), { flexDirection: "row", justifyContent: "flex-start", paddingLeft: b.tx - 265 - 1 }]} testID={`wale-home-${b.id}`}>
          <Art x={b.pic.x - 265 - 1} y={b.pic.y - b.y - 1} w={b.pic.w} h={b.pic.h} source={b.pic.src} />
          <T size={9.5} weight={700} color={W.inkSoft} spacing={0.6} style={{ lineHeight: 13 }}>
            {b.label}
          </T>
        </Tap>
      ))}
      <Art {...ART.map} y={ART.map.y + dy} source={ART.map.src} testID="wale-home-map-art" />
      <Tap x={265} y={408 + dy} w={103} h={32} label="Open map" onPress={openMap} style={{ backgroundColor: W.green, borderRadius: 8 }} testID="wale-home-open-map">
        <T size={9} weight={700} color="#FFFFFF" style={{ lineHeight: 12 }}>
          OPEN MAP
        </T>
      </Tap>

      {/* ENTER QUEST */}
      <Tap x={17} y={fit.questY} w={369} h={60} label="Enter quest" onPress={() => router.push("/quests")} style={{ backgroundColor: W.pink, borderRadius: 14, flexDirection: "row", gap: 9, shadowColor: W.pink, shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 5 } }} testID="wale-home-enter-quest">
        <Hexagon w={17} h={19} />
        <T size={19} weight={800} color="#FFFFFF" spacing={0.6} style={{ lineHeight: 26 }}>
          ENTER QUEST
        </T>
      </Tap>

      {/* menu */}
      {menu ? (
        <>
          <At x={277} y={15.5} w={110} h={138 + grow} style={{ borderRadius: 10, backgroundColor: "rgba(200,196,222,0.86)" }} testID="wale-home-menu" />
          {menuRows.map((m) => (
            <Tap key={m.id} x={283} y={m.y} w={98} h={28.5} label={m.label} onPress={m.go} style={[glass(7, "rgba(255,255,255,0.5)"), { flexDirection: "row", justifyContent: "flex-start", paddingLeft: m.tx - 283 - 1 }]} testID={`wale-home-menu-${m.id}`}>
              <Art x={m.pic.x - 283 - 1} y={m.pic.y - m.y - 1} w={m.pic.w} h={m.pic.h} source={m.pic.src} />
              <T size={m.size} weight={700} spacing={0.5} style={{ lineHeight: 13 }}>
                {m.label}
              </T>
            </Tap>
          ))}
          {/* a tap anywhere else closes it */}
          <Tap x={0} y={160 + grow} w={403} h={330 - grow + extra} label="Close menu" onPress={() => setMenu(false)} testID="wale-home-menu-close" />
        </>
      ) : (
        <Tap x={352} y={15} w={39} h={42} label="Menu" onPress={() => setMenu(true)} style={glass(10, "rgba(255,255,255,0.6)")} testID="wale-home-menu-button">
          <LineIcon name="menu" size={19.5} />
        </Tap>
      )}
    </>
  );
}
