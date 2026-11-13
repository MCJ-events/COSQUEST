// Wale's Armory (Figma "weapons", 403 wide) and his weapon page ("Cosquest ·
// Speedshot mobile detail", 403 x 946).
//
// The names, tiers and owned / not owned states are the REAL faction ladder
// (features/waleui/armory.ts), not the mock-up names in the Figma. His frame
// has 2 owned and 12 not owned; a faction's ladder has 10 weapons, so the grid
// has the same cards in the same columns and rows and simply ends sooner.
//
// The weapon pictures in his frame are mock-ups (and they, their corner tags
// and the upgrade core tiles are pictures from another studio's game, so they
// are NOT copied in). Until the real ladder weapons have art, each card shows
// one of the app's bundled weapon pictures by tier, in his card style: on a
// light purple tile when owned, on a dark purple tile for the first two rows of
// not-owned cards and bare below that, as in his frame. The corner tag and the
// core tiles are drawn in code in his shapes and colours.
//
// Build 23: the weapon page hero is the player's faction hero (heroArt.ts) in
// the box his archer fills, over his street web; his own archer shows only when
// the faction is unknown. The attack panel is his five buttons (the same sprites the
// fight HUD uses, game3d/art/hud/wale, copied to assets/images/waleui).
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, Platform, View } from "react-native";
import Svg, { Path, Polygon } from "react-native-svg";

import { type Armory, type ArmoryWeapon, armoryFooter, countLabel, findWeapon } from "@/features/waleui/armory";
import { fight3dAvailable } from "@/features/game3d/flags";

import { buyArmoryWeapon, useArmory } from "./data";
import { back, notBuiltYet } from "./go";
import { useFactionHero } from "./heroArt";
import { Art, At, Band, DesignCanvas, LineIcon, Padlock, T, Tap, W, WaleFooter, glass } from "./kit";

const FW = 403;

/** Stand-in pictures (the app's own bundled weapon renders), one per tier. */
const STAND_INS = [
  require("@/assets/weapons/rogue_dagger.png"),
  require("@/assets/weapons/knight_sword.png"),
  require("@/assets/weapons/war_axe.png"),
  require("@/assets/weapons/hunter_crossbow.png"),
  require("@/assets/weapons/arcane_staff.png"),
  require("@/assets/weapons/knight_shield.png"),
  require("@/assets/weapons/forge_warhammer.png"),
  require("@/assets/weapons/repeater_rifle.png"),
  require("@/assets/weapons/crown_greatsword.png"),
];
export const standIn = (tier: number) => STAND_INS[Math.abs(tier) % STAND_INS.length];

// ---------- the list ----------

const CARD_W = 117;
const CARD_H = 169.5;
const COL_X = [15.5, 143, 270.5];
const ROW_PITCH = 179.7;

/** Where everything sits for a given number of owned and not-owned weapons (his frame: 2 and 12). */
export function armoryLayout(owned: number, notOwned: number) {
  const ownedRows = Math.max(1, Math.ceil(owned / 3));
  const ownedTop = 108;
  const ownedBottom = ownedTop + (ownedRows - 1) * ROW_PITCH + CARD_H;
  const notTop = ownedBottom + 62.5;
  const notRows = Math.max(1, Math.ceil(notOwned / 3));
  const notBottom = notTop + (notRows - 1) * ROW_PITCH + CARD_H;
  return { ownedTop, notHeadingY: ownedBottom + 37.5, notTop, totalsY: notBottom + 31, lineY: notBottom + 52, footerY: notBottom + 82.5, height: Math.round(notBottom + 111) };
}

/** His corner tag colours (red, pink, teal, blue), one per tier in turn. */
const TAG_COLORS = ["#E5463B", "#DF6BD0", "#3FA79B", "#5B7FDF"];

/** The slanted tag in the tile's top left corner (20 x 13.5 in his frame). His glyphs are another game's class icons; ours carries the tier number, which is real. */
function CornerTag({ tier }: { tier: number }) {
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width: 20, height: 13.5 }}>
      <Svg width={20} height={13.5} viewBox="0 0 20 13.5">
        <Polygon points="0,0 20,0 14.5,13.5 0,13.5" fill={TAG_COLORS[Math.abs(tier) % TAG_COLORS.length]} />
      </Svg>
      <View style={{ position: "absolute", left: 0, top: 0, width: 15, height: 13.5, alignItems: "center", justifyContent: "center" }}>
        <T size={7.5} weight={800} color="#FFFFFF" style={{ lineHeight: 10 }}>{`${tier + 1}`}</T>
      </View>
    </View>
  );
}

/** `bare`: no tile behind the picture (his lower not-owned rows). */
function Card({ w, x, y, onPress, bare }: { w: ArmoryWeapon; x: number; y: number; onPress: () => void; bare?: boolean }) {
  const owned = w.state === "owned";
  const live = owned || w.state === "available";
  return (
    <Tap x={x} y={y} w={CARD_W} h={CARD_H} label={`${w.name}, ${w.tierLabel}, ${w.status.toLowerCase()}`} onPress={onPress} style={[glass(14, owned ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.3)"), owned ? { borderColor: W.pink } : null, { alignItems: "stretch", justifyContent: "flex-start" }]} testID={`wale-weapons-card-${w.tier}`}>
      {bare ? (
        <View style={{ position: "absolute", left: 9.5, top: 10, width: 97, height: 88, alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
          <Image source={standIn(w.tier)} style={{ width: 112, height: 112 }} contentFit="contain" />
        </View>
      ) : (
        <View style={{ position: "absolute", left: 9.5, top: 16, width: 97, height: 78, borderRadius: 8, backgroundColor: owned ? "#9B45D6" : "#3C1466", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
          <LinearGradient colors={owned ? ["#8E3BD0", "#C05BEA", "#9A42D8"] : ["#34105C", "#4A1B7A", "#3A1366"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: "absolute", left: 0, top: 0, width: 97, height: 78 }} />
          <View style={{ position: "absolute", left: 0, top: 66, width: 97, height: 12, backgroundColor: owned ? "rgba(120,40,190,0.55)" : "rgba(30,8,60,0.5)" }} />
          <Image source={standIn(w.tier)} style={{ width: 108, height: 108 }} contentFit="contain" />
          <CornerTag tier={w.tier} />
        </View>
      )}
      <View style={{ position: "absolute", left: 9.5, top: 104, width: 99 }}>
        <T size={9} weight={700} lines={2} upper style={{ lineHeight: 12 }}>
          {w.name}
        </T>
      </View>
      <View style={{ position: "absolute", left: 9.5, top: 141, width: 99, flexDirection: "row", alignItems: "center", gap: 3 }}>
        {w.state === "available" ? <LineIcon name="arrow-up" size={8.5} color={W.pink} stroke={2.6} /> : owned ? <LineIcon name="check" size={9} color={W.pink} stroke={2.6} /> : <Padlock size={9} />}
        <T size={7} weight={700} color={live ? W.pink : W.inkSoft} style={{ lineHeight: 10 }}>
          {w.status}
        </T>
      </View>
    </Tap>
  );
}

export function WeaponsScreen() {
  const a = useArmory();
  const L = armoryLayout(a.owned.length, a.notOwned.length);
  const open = (w: ArmoryWeapon) => router.push({ pathname: "/wale/weapon", params: { id: w.id } });
  return (
    <DesignCanvas width={FW} height={L.height} colors={["#B8DBE7", "#D5E9F3"]} testID="wale-weapons">
      <At x={0} y={0} w={FW} h={55} style={[glass(0, "rgba(255,255,255,0.2)"), { borderTopWidth: 0, borderLeftWidth: 0, borderRightWidth: 0, borderBottomLeftRadius: 14, borderBottomRightRadius: 14 }]} testID="wale-weapons-header" />
      <At x={12} y={12}>
        <T size={21} weight={700} style={{ lineHeight: 30 }} testID="wale-weapons-title">
          Weapons
        </T>
      </At>
      <Tap x={352.5} y={12} w={37.5} h={37.5} label="Close" onPress={() => back()} style={{ backgroundColor: "rgba(255,255,255,0.75)", borderRadius: 9, borderWidth: 1, borderColor: W.pink }} testID="wale-weapons-close">
        <LineIcon name="x" size={35} stroke={1.5} />
      </Tap>

      <At x={16} y={73.5}>
        <T size={16} weight={700} style={{ lineHeight: 24 }} testID="wale-weapons-owned-heading">
          Owned
        </T>
      </At>
      <At x={FW - 16.5 - 120} y={78} w={120} style={{ alignItems: "flex-end" }}>
        <T size={9.5} weight={500} color={W.inkSoft} align="right" testID="wale-weapons-owned-count">
          {countLabel(a.owned.length)}
        </T>
      </At>
      {a.owned.map((w, i) => (
        <Card key={w.id} w={w} x={COL_X[i % 3]} y={L.ownedTop + Math.floor(i / 3) * ROW_PITCH} onPress={() => open(w)} />
      ))}

      <At x={16} y={L.notHeadingY - 12}>
        <T size={16} weight={700} style={{ lineHeight: 24 }} testID="wale-weapons-notowned-heading">
          Not owned
        </T>
      </At>
      <At x={FW - 16.5 - 120} y={L.notHeadingY - 6} w={120} style={{ alignItems: "flex-end" }}>
        <T size={9.5} weight={500} color={W.inkSoft} align="right" testID="wale-weapons-notowned-count">
          {countLabel(a.notOwned.length)}
        </T>
      </At>
      {a.notOwned.map((w, i) => (
        <Card key={w.id} w={w} x={COL_X[i % 3]} y={L.notTop + Math.floor(i / 3) * ROW_PITCH} onPress={() => open(w)} bare={i >= 6} />
      ))}

      <At x={16} y={L.totalsY - 7}>
        <T size={9.5} weight={400} color={W.inkSoft} testID="wale-weapons-totals">
          {armoryFooter(a)}
        </T>
      </At>
      <At x={FW - 16.5 - 160} y={L.totalsY - 7} w={160} style={{ alignItems: "flex-end" }}>
        <T size={9.5} weight={400} color={W.inkSoft}>
          {a.source === "snapshot" ? `${a.factionName} · offline copy` : "End of collection"}
        </T>
      </At>
      <View style={{ position: "absolute", left: 0, top: L.lineY, width: FW, height: 1, backgroundColor: "rgba(255,255,255,0.7)" }} />
      <WaleFooter y={L.footerY} w={FW} path="COSQUEST  /  ARMORY / COLLECTION" x={17.5} testID="wale-weapons-footer" />
    </DesignCanvas>
  );
}

// ---------- the weapon page ----------

/**
 * The one attack panel (Wale 59328), the same for every weapon (his note of 11 Nov). A picture of the layout, not
 * live buttons: his own button art with its pale halo, each in the box it fills in the frame. ATTACK is last so it
 * sits over the small ones' halos, as on his sheet.
 */
const PANEL: { id: string; src: number; x: number; y: number; s: number }[] = [
  { id: "shield", src: require("@/assets/images/waleui/panel_shield.png"), x: 284.7, y: 335, s: 56 },
  { id: "shoot", src: require("@/assets/images/waleui/panel_shoot.png"), x: 229, y: 353, s: 46 },
  { id: "rain", src: require("@/assets/images/waleui/panel_rain.png"), x: 202.5, y: 405.2, s: 43 },
  { id: "dash", src: require("@/assets/images/waleui/panel_dash.png"), x: 218.1, y: 463.1, s: 39.8 },
  { id: "attack", src: require("@/assets/images/waleui/panel_attack.png"), x: 262.9, y: 408.9, s: 98.2 },
];

/** His art on the weapon page and the box each fills in the 403 x 946 frame. */
const WEB = { src: require("@/assets/images/waleui/weapon_web.png"), x: 1.5, y: 200, w: 400, h: 390 };
const ARCHER = { src: require("@/assets/images/waleui/weapon_hero.png"), x: 62.75, y: 196, w: 208, h: 390 };

/** An upgrade core tile in his shape and colours (46 x 46, teal, a dark diamond). Cores are not in the data model, so the three are shown faint. */
function CoreTile() {
  return (
    <View style={{ width: 46, height: 46, borderRadius: 6, backgroundColor: "#2DB3A4", overflow: "hidden", alignItems: "center", justifyContent: "center", opacity: 0.45 }}>
      <View style={{ position: "absolute", left: 0, top: 40, width: 46, height: 6, backgroundColor: "#1F9488" }} />
      <Svg width={16} height={20} viewBox="0 0 16 20">
        <Path d="M8 1 L15 10 L8 19 L1 10 Z" fill="#0F6F68" />
      </Svg>
    </View>
  );
}

export function WeaponDetailScreen({ id }: { id?: string | null }) {
  const a: Armory = useArmory();
  const w = findWeapon(a, id);
  const [buying, setBuying] = useState(false);
  const fh = useFactionHero();
  if (!w) return <DesignCanvas width={FW} height={946} testID="wale-weapon">{null}</DesignCanvas>;
  const btn = w.button;
  const buy = async () => {
    if (buying) return;
    setBuying(true);
    const r = await buyArmoryWeapon(w.id, w.name);
    setBuying(false);
    if (Platform.OS === "web") console.log(`[wale-ui] ${r.text}`);
    else Alert.alert(r.ok ? w.name : "Not yet", r.text);
  };
  // his action band (EQUIPPED / TRY) and the path line stay on screen above the home bar on a phone shorter than his frame (build 27)
  const footer = (
    <>
      {/* actions */}
      <Band y={809} h={88} w={FW} color="rgba(255,255,255,0.4)" />
      {/* the left button: a label only (equipped, owned, locked, soon), or the real claim / buy when the ladder allows it */}
      <Tap x={16} y={825.5} w={187} h={55.5} label={btn.kind === "buy" ? `${btn.label} ${w.name}` : btn.label} disabled={btn.kind !== "buy" || buying} onPress={btn.kind === "buy" ? buy : undefined} style={[glass(12, "rgba(255,255,255,0.6)"), { borderColor: btn.kind === "buy" ? W.pink : "#B7CED9", flexDirection: "row", gap: 7, opacity: buying ? 0.6 : 1 }]} testID="wale-weapon-equipped">
        {btn.kind === "buy" ? null : <LineIcon name={btn.kind === "equipped" || btn.kind === "owned" ? "check-circle" : "lock"} size={15} color={W.inkSoft} />}
        <T size={12} weight={700} color={btn.kind === "buy" ? W.pink : W.inkSoft} style={{ lineHeight: 16 }}>
          {buying ? "ONE MOMENT" : btn.label}
        </T>
      </Tap>
      <Tap
        x={215.5}
        y={825.5}
        w={171.5}
        h={55.5}
        label={`Try ${w.name}`}
        onPress={() => (fight3dAvailable() ? router.push("/fight3d?mode=arena") : notBuiltYet("The practice fight on this build"))}
        style={{ backgroundColor: W.pink, borderRadius: 12, flexDirection: "row", gap: 10 }}
        testID="wale-weapon-try"
      >
        <T size={17} weight={700} color="#FFFFFF" spacing={0.5} style={{ lineHeight: 22 }}>
          TRY
        </T>
        <LineIcon name="arrow-right" size={30} color="#FFFFFF" stroke={1.8} />
      </Tap>
      <WaleFooter y={921.5} w={FW} path={`COSQUEST / ARMORY / ${w.name.toUpperCase()}`} testID="wale-weapon-footer" />
    </>
  );

  return (
    <DesignCanvas width={FW} height={946} colors={["#BBDDE9", "#DCEDF5", "#E4F1F8"]} testID="wale-weapon" footer={{ y: 809, children: footer }}>
      <Band y={0} h={83.5} w={FW} line="bottom" />
      <At x={16} y={22.5}>
        <T size={8} weight={700} color={W.inkSoft} spacing={1.2} style={{ lineHeight: 10 }} testID="wale-weapon-kicker">
          COSQUEST / ARMORY
        </T>
      </At>
      <At x={16} y={33}>
        <T size={21} weight={700} style={{ lineHeight: 30 }} testID="wale-weapon-title">
          Weapons
        </T>
      </At>
      <Tap x={339.5} y={18} w={47.5} h={47.5} label="Close" onPress={() => back("/wale/weapons")} style={{ backgroundColor: "rgba(255,255,255,0.75)", borderRadius: 12, borderWidth: 1, borderColor: W.pink }} testID="wale-weapon-close">
        <LineIcon name="x" size={25} stroke={1.6} />
      </Tap>

      <At x={20} y={104} w={58} h={58} style={{ borderRadius: 8, backgroundColor: "#0B6E76", alignItems: "center", justifyContent: "center", overflow: "hidden" }} testID="wale-weapon-thumb">
        <Image source={standIn(w.tier)} style={{ width: 74, height: 74 }} contentFit="contain" />
      </At>
      <At x={90} y={107} w={300}>
        <T size={w.name.length > 16 ? 16 : 27} weight={800} upper lines={1} style={{ lineHeight: w.name.length > 16 ? 34 : 34 }} testID="wale-weapon-name">
          {w.name}
        </T>
      </At>
      <At x={90} y={145} w={300} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <View style={{ width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: W.pink }} />
        <T size={8.5} weight={700} color={W.pink} spacing={0.5} style={{ lineHeight: 12 }} testID="wale-weapon-type">
          {w.typeLine}
        </T>
      </At>
      <At x={20} y={173} w={363} style={{ alignItems: "center" }}>
        <T size={12} weight={400} italic color={W.inkSoft} testID="wale-weapon-tagline">
          {w.tagline || `${a.factionName} ladder, ${w.tierLabel.toLowerCase()} tier`}
        </T>
      </At>

      {/* his street web, the player's faction hero (his archer when the faction is unknown) and his attack panel */}
      <Art {...WEB} source={WEB.src} testID="wale-weapon-web" />
      <At x={ARCHER.x} y={ARCHER.y} w={ARCHER.w} h={ARCHER.h} pointerEvents="none" testID="wale-weapon-hero">
        {fh ? (
          <Image source={fh.full} style={{ width: ARCHER.w, height: ARCHER.h }} contentFit="contain" contentPosition="bottom" accessible accessibilityRole="image" accessibilityLabel={`Your hero: ${fh.name}`} />
        ) : (
          <Image source={ARCHER.src} style={{ width: ARCHER.w, height: ARCHER.h }} contentFit="fill" accessible accessibilityRole="image" accessibilityLabel="Your hero drawing a bow" />
        )}
      </At>
      {PANEL.map((b) => (
        <Art key={b.id} x={b.x} y={b.y} w={b.s} h={b.s} source={b.src} testID={`wale-weapon-panel-${b.id}`} />
      ))}

      {/* stats */}
      <At x={16} y={591} w={371} h={78} style={glass(14, "rgba(255,255,255,0.55)")} testID="wale-weapon-stats" />
      <At x={32} y={604}>
        <T size={8.5} weight={600} color={W.inkSoft} spacing={1}>
          COMPLEXITY
        </T>
      </At>
      {[0, 1, 2, 3, 4].map((i) => (
        <At key={i} x={32 + i * 21} y={629} w={17.5} h={19.5} style={{ borderRadius: 3, backgroundColor: i < w.complexity ? W.pink : "#B7CED9" }} testID={i === 0 ? "wale-weapon-pip" : undefined} />
      ))}
      <At x={138} y={634}>
        <T size={9.5} weight={500} color={W.inkSoft} testID="wale-weapon-complexity">{`${w.complexity}/5`}</T>
      </At>
      <View style={{ position: "absolute", left: 214, top: 607, width: 1, height: 48, backgroundColor: "rgba(40,66,78,0.12)" }} />
      <At x={233} y={604}>
        <T size={8.5} weight={600} color={W.inkSoft} spacing={1}>
          HEALTH
        </T>
      </At>
      <At x={233} y={629} w={140} h={22} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <LineIcon name="shield" size={21} color={W.pink} stroke={1.8} />
        <T size={13} weight={500} color={W.slate} style={{ lineHeight: 26 }} testID="wale-weapon-health">
          Not set
        </T>
      </At>

      {/* upgrade cores */}
      <At x={16} y={696}>
        <T size={10.5} weight={700} spacing={1} testID="wale-weapon-cores-heading">
          UPGRADE CORES
        </T>
      </At>
      <Tap x={316.5} y={694} w={67} h={18} label="View all upgrade cores" onPress={() => notBuiltYet("Upgrade cores")} style={{ flexDirection: "row", justifyContent: "flex-end", gap: 5 }} testID="wale-weapon-view-all">
        <T size={9} weight={700} color={W.pink} spacing={0.4} testID="wale-weapon-view-all-text">
          VIEW ALL
        </T>
        <LineIcon name="chevron-right" size={14} color={W.pink} stroke={2.6} />
      </Tap>
      {COL_X.map((x, i) => (
        <At key={i} x={x} y={727} w={117} h={63} style={[glass(12, "rgba(255,255,255,0.4)"), { alignItems: "center", justifyContent: "center" }]} testID={`wale-weapon-core-${i}`}>
          <CoreTile />
        </At>
      ))}

    </DesignCanvas>
  );
}
