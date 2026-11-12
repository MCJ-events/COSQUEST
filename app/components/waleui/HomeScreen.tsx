// Wale's Homepage (Figma "Cosquest · Homepage mobile", menu closed and menu
// open, 403 x 575). Every block sits where his frame has it.
//
// Over the Figma, from his voice note of 11 Nov: there are no gems, only XP
// and CosCoin, so the second currency pill is not drawn.
//
// His 3D icons (gear, megaphone, envelope, trophy, swords, wardrobe, shop,
// map) and the street-map backdrop are flattened pictures in the Figma, so the
// app's own icons stand in at the same place until he exports them. The hero
// is the player's Forge character when they have one, else a neutral figure.
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import ForgeModel from "@/components/game/ForgeModel";
import { RankBadge } from "@/components/game/RankBadge";
import { spaced, xpRatio } from "@/features/waleui/armory";
import { useEquipped } from "@/features/game/forgeWorldDevice";

import { useProgMe, useWaleProfile } from "./data";
import { notBuiltYet, openGameSheet, openMap } from "./go";
import { useFactionHero } from "./heroArt";
import { At, DesignCanvas, type IconName, PlaceholderTag, PreviewSlot, T, Tap, W, glass } from "./kit";

export const HOME_W = 403;
export const HOME_H = 575;

const LEFT: { id: string; label: string; icon?: IconName; y: number; go: () => void }[] = [
  { id: "add-friend", label: "ADD FRIEND", icon: "person-add", y: 85, go: () => openGameSheet("friends") },
  { id: "team-up", label: "TEAM UP", icon: "people", y: 111.5, go: () => openGameSheet("squad") },
  { id: "faction", label: "FACTION", y: 138, go: () => openGameSheet("ranks") },
  { id: "community", label: "COMMUNITY", y: 164, go: () => router.push("/community") },
];

const RIGHT: { id: string; label: string; icon: IconName; y: number; go: () => void }[] = [
  { id: "weapon", label: "WEAPON", icon: "hammer", y: 217.5, go: () => router.push("/wale/weapons") },
  { id: "wardrobe", label: "WARDROBE", icon: "shirt", y: 252.5, go: () => router.push("/wale/wardrobe") },
  { id: "shop", label: "SHOP", icon: "storefront", y: 287.5, go: () => openGameSheet("coins") },
];

const MENU: { id: string; label: string; icon: IconName; y: number; size: number; go: () => void }[] = [
  { id: "settings", label: "SETTINGS", icon: "settings", y: 22, size: 9, go: () => router.push("/wale/settings") },
  { id: "news", label: "NEWS", icon: "megaphone", y: 53, size: 9, go: () => notBuiltYet("News") },
  { id: "mails", label: "MAILS", icon: "mail", y: 86.5, size: 9, go: () => router.push("/chat") },
  { id: "leaderboard", label: "LEADERBOARD", icon: "trophy", y: 119, size: 7.5, go: () => openGameSheet("war") },
];

export default function HomeScreen({ menuOpen = false }: { menuOpen?: boolean }) {
  const [menu, setMenu] = useState(menuOpen);
  const p = useWaleProfile();
  const prog = useProgMe();
  const equipped = useEquipped();
  const fh = useFactionHero();
  const rank = prog?.rank?.number ?? null;
  const ratio = xpRatio(p.xpHave, p.xpNeed);
  return (
    <DesignCanvas width={HOME_W} height={HOME_H} colors={["#C1DEE9", "#D6E9F2", "#E6F2F8"]} testID="wale-home">
      {/* the hero, behind everything */}
      <At x={98} y={80} w={164} h={417} testID="wale-home-hero">
        {equipped.avatar ? (
          <ForgeModel id={equipped.avatar} held spin style={{ width: 164, height: 417 }} size={417} accessibilityLabel="Your hero" />
        ) : (
          <PreviewSlot w={164} h={417} shape="body" image={fh?.full} label={fh ? `Your hero: ${fh.name}` : "Your hero (placeholder figure)"} />
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
      <At x={63} y={40.5} w={16} h={17.5} style={{ borderRadius: 8, backgroundColor: "#7B52D9", alignItems: "center", justifyContent: "center" }} testID="wale-home-xp-icon">
        <Ionicons name="shield" size={9} color="#FFFFFF" />
      </At>
      <At x={81} y={49} w={88} h={7} style={{ borderRadius: 4, backgroundColor: "#FFFFFF", overflow: "hidden" }} testID="wale-home-xp-bar">
        <LinearGradient colors={["#6A3FD0", "#B9A7F0"]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={{ width: 88 * ratio, height: 7, borderRadius: 4 }} />
      </At>
      <At x={220} y={25} w={51} h={13} style={[glass(7, "rgba(255,255,255,0.3)"), { alignItems: "flex-end", justifyContent: "center", paddingRight: 10 }]} testID="wale-home-coins">
        <T size={9} weight={400} style={{ lineHeight: 11 }} testID="wale-home-coins-text">
          {p.coins === null ? "0" : spaced(p.coins)}
        </T>
      </At>
      <At x={207} y={21} w={19} h={19} testID="wale-home-coin-icon">
        <Image source={require("@/assets/images/dashboard/coscoin.png")} style={{ width: 19, height: 19 }} contentFit="contain" />
      </At>
      {p.placeholder ? <PlaceholderTag x={176} y={44} text="NOT SIGNED IN: PLACEHOLDER" /> : null}

      {/* left column */}
      <At x={11} y={73} w={82} h={119} style={glass(6, "rgba(255,255,255,0.12)")} testID="wale-home-left" />
      {LEFT.map((b) => (
        <Tap key={b.id} x={19} y={b.y} w={64} h={19} label={b.label} onPress={b.go} style={[glass(9, "rgba(255,255,255,0.35)"), { flexDirection: "row", gap: 2 }]} testID={`wale-home-${b.id}`}>
          {b.icon ? <Ionicons name={b.icon} size={8} color={W.purple} /> : null}
          <T size={6.5} weight={700} style={{ lineHeight: 9 }}>
            {b.label}
          </T>
        </Tap>
      ))}

      {/* rank badge (hidden under the open menu in his frame) */}
      {!menu ? (
        <Tap x={272.5} y={107.5} w={78} h={94} label={rank ? `Your rank: ${rank}` : "Ranks"} onPress={() => openGameSheet("ranks")} testID="wale-home-rank">
          <RankBadge rank={rank ?? 1} total={10} size={78} />
          {rank === null ? <PlaceholderTag x={14} y={86} /> : null}
        </Tap>
      ) : null}

      {/* right column */}
      <At x={256} y={208} w={121} h={233} style={glass(14, "rgba(255,255,255,0.28)")} testID="wale-home-right" />
      {RIGHT.map((b) => (
        <Tap key={b.id} x={265} y={b.y} w={103} h={30} label={b.label} onPress={b.go} style={[glass(8, "rgba(255,255,255,0.55)"), { flexDirection: "row", gap: 6 }]} testID={`wale-home-${b.id}`}>
          <Ionicons name={b.icon} size={14} color={W.purple} />
          <T size={9.5} weight={700} color={W.inkSoft} spacing={0.6} style={{ lineHeight: 13 }}>
            {b.label}
          </T>
        </Tap>
      ))}
      <At x={268} y={325} w={93} h={75} style={{ alignItems: "center", justifyContent: "center" }} testID="wale-home-map-art">
        <Ionicons name="map" size={54} color="#8FBF6A" />
        <View style={{ position: "absolute", top: 2 }}>
          <Ionicons name="location" size={34} color="#E0463C" />
        </View>
      </At>
      <Tap x={265} y={408} w={103} h={32} label="Open map" onPress={openMap} style={{ backgroundColor: W.green, borderRadius: 8 }} testID="wale-home-open-map">
        <T size={9} weight={700} color="#FFFFFF" style={{ lineHeight: 12 }}>
          OPEN MAP
        </T>
      </Tap>

      {/* ENTER QUEST */}
      <Tap x={17} y={502} w={369} h={60} label="Enter quest" onPress={() => router.push("/quests")} style={{ backgroundColor: W.pink, borderRadius: 14, flexDirection: "row", gap: 9, shadowColor: W.pink, shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 5 } }} testID="wale-home-enter-quest">
        <Ionicons name="cube-outline" size={20} color="#FFFFFF" />
        <T size={19} weight={800} color="#FFFFFF" spacing={0.6} style={{ lineHeight: 26 }}>
          ENTER QUEST
        </T>
      </Tap>

      {/* menu */}
      {menu ? (
        <>
          <At x={277} y={15.5} w={110} h={138} style={{ borderRadius: 10, backgroundColor: "rgba(200,196,222,0.86)" }} testID="wale-home-menu" />
          {MENU.map((m) => (
            <Tap key={m.id} x={283} y={m.y} w={98} h={28.5} label={m.label} onPress={m.go} style={[glass(7, "rgba(255,255,255,0.5)"), { flexDirection: "row", justifyContent: "flex-start", paddingLeft: 8, gap: 9 }]} testID={`wale-home-menu-${m.id}`}>
              <Ionicons name={m.icon} size={16} color={W.purple} />
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
          <Ionicons name="menu" size={20} color={W.ink} />
        </Tap>
      )}
    </DesignCanvas>
  );
}
