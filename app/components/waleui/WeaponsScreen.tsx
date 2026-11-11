// Wale's Armory (Figma "weapons", 403 wide) and his weapon page ("Cosquest ·
// Speedshot mobile detail", 403 x 946).
//
// The names, tiers and owned / not owned states are the REAL faction ladder
// (features/waleui/armory.ts), not the mock-up names in the Figma. His frame
// has 2 owned and 12 not owned; a faction's ladder has 10 weapons, so the grid
// has the same cards in the same columns and rows and simply ends sooner.
//
// The weapon pictures in his frame are mock-ups. Until the real ladder
// weapons have art, each card shows one of the app's bundled weapon pictures
// by tier, tagged as a stand-in on the weapon page.
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import { View } from "react-native";

import ForgeModel from "@/components/game/ForgeModel";
import { type Armory, type ArmoryWeapon, armoryFooter, countLabel, findWeapon } from "@/features/waleui/armory";
import { useEquipped } from "@/features/game/forgeWorldDevice";
import { fight3dAvailable } from "@/features/game3d/flags";

import { useArmory } from "./data";
import { back, notBuiltYet } from "./go";
import { At, Band, DesignCanvas, Footer, type IconName, IconTile, PlaceholderTag, PreviewSlot, T, Tap, W, glass } from "./kit";

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

function Card({ w, x, y, onPress }: { w: ArmoryWeapon; x: number; y: number; onPress: () => void }) {
  const owned = w.state === "owned";
  return (
    <Tap x={x} y={y} w={CARD_W} h={CARD_H} label={`${w.name}, ${w.tierLabel}, ${w.status.toLowerCase()}`} onPress={onPress} style={[glass(14, owned ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.3)"), owned ? { borderColor: W.pink } : null, { alignItems: "stretch", justifyContent: "flex-start" }]} testID={`wale-weapons-card-${w.tier}`}>
      <View style={{ position: "absolute", left: 9.5, top: 16, width: 97, height: 78, borderRadius: 8, backgroundColor: owned ? "#9B45D6" : "#3C1466", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
        {owned || w.state === "available" ? <Image source={standIn(w.tier)} style={{ width: 70, height: 70 }} contentFit="contain" /> : <Ionicons name="lock-closed-outline" size={26} color="rgba(255,255,255,0.55)" />}
      </View>
      <View style={{ position: "absolute", left: 9.5, top: 104, width: 99 }}>
        <T size={9} weight={700} lines={2} upper style={{ lineHeight: 12 }}>
          {w.name}
        </T>
      </View>
      <View style={{ position: "absolute", left: 9.5, top: 141, width: 99, flexDirection: "row", alignItems: "center", gap: 3 }}>
        <Ionicons name={owned ? "checkmark" : w.state === "available" ? "arrow-up" : "lock-closed"} size={8} color={owned || w.state === "available" ? W.pink : W.inkSoft} />
        <T size={7} weight={700} color={owned || w.state === "available" ? W.pink : W.inkSoft} style={{ lineHeight: 10 }}>
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
      <IconTile x={352.5} y={12} size={37.5} icon="close" label="Close" tone="pink" radius={9} iconSize={24} onPress={() => back()} testID="wale-weapons-close" />

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
        <Card key={w.id} w={w} x={COL_X[i % 3]} y={L.notTop + Math.floor(i / 3) * ROW_PITCH} onPress={() => open(w)} />
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
      <Footer y={L.footerY} w={FW} path="COSQUEST  /  ARMORY / COLLECTION" x={17.5} testID="wale-weapons-footer" />
    </DesignCanvas>
  );
}

// ---------- the weapon page ----------

/** The one attack panel (Wale 59328), the same for every weapon (his note of 11 Nov). A picture of the layout, not live buttons. */
const PANEL: { id: string; cx: number; cy: number; d: number; color: string; icon: IconName }[] = [
  { id: "attack", cx: 312, cy: 458, d: 97, color: "#A63BD9", icon: "flash" },
  { id: "shield", cx: 312.7, cy: 363, d: 55, color: "#4FB52E", icon: "shield-checkmark" },
  { id: "shoot", cx: 252, cy: 376, d: 45, color: "#2E9BD6", icon: "play-forward" },
  { id: "rain", cx: 224, cy: 426.7, d: 42, color: "#D33A2C", icon: "rainy" },
  { id: "dash", cx: 238, cy: 483, d: 38, color: "#E8791E", icon: "flash-outline" },
];

export function WeaponDetailScreen({ id }: { id?: string | null }) {
  const a: Armory = useArmory();
  const w = findWeapon(a, id);
  const equipped = useEquipped();
  if (!w) return <DesignCanvas width={FW} height={946} testID="wale-weapon">{null}</DesignCanvas>;
  const owned = w.state === "owned";
  return (
    <DesignCanvas width={FW} height={946} colors={["#BBDDE9", "#DCEDF5", "#E4F1F8"]} testID="wale-weapon">
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
      <IconTile x={339.5} y={18} size={47.5} icon="close" label="Close" tone="pink" radius={12} iconSize={22} onPress={() => back("/wale/weapons")} testID="wale-weapon-close" />

      <At x={20} y={104} w={58} h={58} style={{ borderRadius: 8, backgroundColor: "#0B6E76", alignItems: "center", justifyContent: "center", overflow: "hidden" }} testID="wale-weapon-thumb">
        <Image source={standIn(w.tier)} style={{ width: 50, height: 50 }} contentFit="contain" />
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

      {/* the hero with the weapon */}
      <At x={62} y={205} w={210} h={395} testID="wale-weapon-hero">
        {equipped.avatar ? <ForgeModel id={equipped.avatar} held spin style={{ width: 210, height: 395 }} size={395} accessibilityLabel={`Your hero holding ${w.name}`} /> : <PreviewSlot w={210} h={395} shape="body" label={`Your hero holding ${w.name} (placeholder figure)`} />}
      </At>
      {!equipped.avatar ? (
        <At x={170} y={250} w={90} h={90} pointerEvents="none">
          <Image source={standIn(w.tier)} style={{ width: 90, height: 90 }} contentFit="contain" />
        </At>
      ) : null}
      <PlaceholderTag x={20} y={196} text="WEAPON ART: STAND-IN" />
      {PANEL.map((b) => (
        <At key={b.id} x={b.cx - b.d / 2} y={b.cy - b.d / 2} w={b.d} h={b.d} style={{ borderRadius: b.d / 2, backgroundColor: b.color, borderWidth: Math.max(2, b.d * 0.07), borderColor: "rgba(255,255,255,0.85)", alignItems: "center", justifyContent: "center" }} testID={`wale-weapon-panel-${b.id}`} pointerEvents="none">
          <Ionicons name={b.icon} size={b.d * 0.5} color="#FFFFFF" />
        </At>
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
        <Ionicons name="shield-outline" size={20} color={W.pink} />
        <T size={13} weight={500} color={W.inkSoft} style={{ lineHeight: 26 }} testID="wale-weapon-health">
          Not set
        </T>
      </At>
      <PlaceholderTag x={300} y={636} text="NO SERVER FIELD" />

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
        <Ionicons name="chevron-forward" size={10} color={W.pink} />
      </Tap>
      {COL_X.map((x, i) => (
        <At key={i} x={x} y={727} w={117} h={63} style={[glass(12, "rgba(255,255,255,0.4)"), { alignItems: "center", justifyContent: "center" }]} testID={`wale-weapon-core-${i}`}>
          <View style={{ width: 46, height: 46, borderRadius: 7, borderWidth: 1, borderStyle: "dashed", borderColor: W.slate, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="diamond-outline" size={18} color={W.slate} />
          </View>
        </At>
      ))}
      <PlaceholderTag x={150} y={716} text="CORES: NOT IN THE DATA MODEL" />

      {/* actions */}
      <Band y={809} h={88} w={FW} color="rgba(255,255,255,0.4)" />
      <Tap x={16} y={825.5} w={187} h={55.5} label={w.equipped ? "Equipped" : owned ? "Owned" : w.status} disabled style={[glass(12, "rgba(255,255,255,0.6)"), { borderColor: "#B7CED9", flexDirection: "row", gap: 7 }]} testID="wale-weapon-equipped">
        <Ionicons name={w.equipped || owned ? "checkmark-circle-outline" : "lock-closed-outline"} size={16} color={W.inkSoft} />
        <T size={12} weight={700} color={W.inkSoft} style={{ lineHeight: 16 }}>
          {w.equipped ? "EQUIPPED" : owned ? "OWNED" : "LOCKED"}
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
        <Ionicons name="arrow-forward" size={20} color="#FFFFFF" />
      </Tap>
      <Footer y={921.5} w={FW} path={`COSQUEST / ARMORY / ${w.name.toUpperCase()}`} testID="wale-weapon-footer" />
    </DesignCanvas>
  );
}
