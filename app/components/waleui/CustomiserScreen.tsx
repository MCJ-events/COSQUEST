// Wale's customiser (Figma "Faces · Mobile", "Hair Styles · Mobile",
// "Headwear · Mobile" at 430 x 932 and "Outfits · Mobile" at 430 x 1442).
// One screen, five tabs: Faces, Hair Styles, Headwear, Outfits, Random.
//
// From his voice note of 11 Nov, over the Figma:
//   - the face grid is one character with eight variants, so the cells are
//     "Variant 1..8" of the same figure, not eight people;
//   - the customiser is NOT per faction: the same lists for everyone.
//
// The headers differ a little between his four frames (a kicker on two of
// them, a bare shirt icon on one, the wrapped "COSQ UEST" on Outfits, a white
// DONE on Hair). Each is drawn as he drew it; HEADER below is the one place to
// make them the same if he wants that.
//
// Random has a tab icon in the Figma but no frame: tapping it rolls every
// part and stays on the tab you were on.
//
// Every picture is Wale's own art, cut from his frames and placed at the box
// it has there (custArt.tsx, custArtBoxes.ts): the character in the preview,
// his eight face, hair and headwear cells, his four outfits, his tab drawings
// and his line icons. It is the same for every player.
//
// The pictures are flat. Choosing an outfit switches the Outfits preview (and
// the Wardrobe character) to that outfit. A face, hair, headwear, skin, eye or
// hair colour choice is selected and saved, but the preview stays his picture
// until the 3D parts exist. Nothing is tinted over his art.
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { EYE_COLORS, FACES, HAIR_COLORS, HAIR_STYLES, HEADWEAR, type LookKey, OUTFITS, SKIN_TONES, type Swatch, activeLook, equippedLine, lookSummary, randomLook, setPart } from "@/features/waleui/look";

import { ART, Art, type Box, Ico, previewArt } from "./custArt";
import { BOX } from "./custArtBoxes";
import { back } from "./go";
import { At, Band, DesignCanvas, T, Tap, W } from "./kit";
import { setLook, useLookSaved, useWardrobe } from "./lookStore";

const FW = 430;

export type CustomTab = "faces" | "hair" | "headwear" | "outfits";
export const CUSTOM_TABS: CustomTab[] = ["faces", "hair", "headwear", "outfits"];

const TABS: { id: CustomTab | "random"; label: string; cx: number }[] = [
  { id: "faces", label: "Faces", cx: 51 },
  { id: "hair", label: "Hair Styles", cx: 133.75 },
  { id: "headwear", label: "Headwear", cx: 215 },
  { id: "outfits", label: "Outfits", cx: 297 },
  { id: "random", label: "Random", cx: 378.75 },
];
/** His tab drawings: face, hair, cap, shirt. Random is a line icon. */
const TAB_GLYPH = { faces: ART.glyph.face, hair: ART.glyph.hair, headwear: ART.glyph.cap, outfits: ART.glyph.shirt } as const;
const TILE = { backgroundColor: "rgba(255,255,255,0.75)", borderRadius: 10 } as const;

/** The header of each frame, as he drew each one. */
const HEADER: Record<CustomTab, { title: string; kicker: boolean; shirt: "tile" | "bare" | "none"; wrappedKicker?: boolean; done: "pink" | "white" }> = {
  faces: { title: "FACES", kicker: true, shirt: "tile", done: "pink" },
  hair: { title: "HAIR STYLES", kicker: false, shirt: "bare", done: "white" },
  headwear: { title: "Headwear", kicker: true, shirt: "tile", done: "pink" },
  outfits: { title: "OUTFITS", kicker: false, shirt: "none", wrappedKicker: true, done: "pink" },
};

const COLS = [16.25, 118.75, 220.6, 322];
const CELL_W = 89.4;

function Swatches({ y, x0, list, value, onPick, id }: { y: number; x0: number; list: Swatch[]; value: number; onPick: (i: number) => void; id: string }) {
  return (
    <>
      {list.map((s, i) => (
        <Tap key={s.id} x={x0 + i * 38} y={y} w={31} h={32} label={`${s.name}`} selected={i === value} onPress={() => onPick(i)} style={{ borderRadius: 5, backgroundColor: s.color, borderWidth: i === value ? 2.5 : 1, borderColor: i === value ? W.pink : "rgba(255,255,255,0.6)", overflow: "hidden", justifyContent: "flex-start", alignItems: "stretch" }} testID={`wale-custom-${id}-${i}`}>
          <View style={{ height: 13, backgroundColor: "rgba(255,255,255,0.22)" }} />
        </Tap>
      ))}
    </>
  );
}

/**
 * One choice: his cell with his art inside, a pink rim and his tick when it is
 * the one chosen. `art` is the picture and its box on the canvas; `tick` is
 * where his tick sits, from the cell's corner. A block's children are placed
 * from inside its rim, so both are moved back by the rim's width and the art
 * stays put when the cell is chosen.
 */
function Cell({ x, y, w, h, on, label, onPress, testID, art, solid, radius = 6, tick }: { x: number; y: number; w: number; h: number; on: boolean; label: string; onPress: () => void; testID: string; art: { source: number; box: Box }; solid?: boolean; radius?: number; tick: Box }) {
  const rim = on ? 3 : 1;
  return (
    <Tap x={x} y={y} w={w} h={h} label={label} selected={on} onPress={onPress} style={{ borderRadius: radius, backgroundColor: solid ? "#FFFFFF" : "rgba(255,255,255,0.35)", borderWidth: rim, borderColor: on ? W.pink : "rgba(255,255,255,0.8)", overflow: "hidden" }} testID={testID}>
      <Art source={art.source} box={art.box} dx={x + rim} dy={y + rim} />
      {on ? (
        <View style={{ position: "absolute", left: tick[0] - rim, top: tick[1] - rim, width: tick[2], height: tick[2], borderRadius: tick[2] / 2, backgroundColor: W.pink, alignItems: "center", justifyContent: "center" }}>
          <Ico source={ART.ic.check} size={Math.round(tick[2] * 0.62)} color="#FFFFFF" />
        </View>
      ) : null}
    </Tap>
  );
}

/** His tick on the chosen cell, measured in each frame, from the cell's corner: [left, top, diameter]. */
const TICK = {
  faces: [BOX.tick.faces[0] - 16.25, BOX.tick.faces[1] - 522, 18.4, 18.4],
  hair: [BOX.tick.hair[0] - 322, BOX.tick.hair[1] - 521, 18.4, 18.4],
  headwear: [BOX.tick.headwear[0] - 16.25, BOX.tick.headwear[1] - 534.4, 23.5, 23.5],
  outfits: [BOX.tick.outfits[0] - 17.3, BOX.tick.outfits[1] - 532.7, 23.8, 23.8],
} as const satisfies Record<string, Box>;

export default function CustomiserScreen({ initialTab = "faces" }: { initialTab?: CustomTab }) {
  const [tab, setTab] = useState<CustomTab>(initialTab);
  const wardrobe = useWardrobe();
  const saved = useLookSaved();
  const look = activeLook(wardrobe);
  const pick = (key: LookKey, i: number) => setLook(setPart(look, key, i));
  const head = HEADER[tab];
  const outfits = tab === "outfits";
  const H = outfits ? 1442 : 932;
  const footY = outfits ? 1386 : 876;
  const doneY = outfits ? 1393 : 883;
  const preview = previewArt(tab, look.outfit);
  const pv = outfits ? { x: 140, y: 82 } : { x: 60, y: 96 };

  // his footer (Look saved, DONE) stays on screen above the home bar on a phone shorter than his frame (build 27)
  const footer = (
    <>
      <Band y={footY} h={56} w={FW} color="#EAF4F9" line="top" />
      <At x={16.5} y={footY + 22} w={200} style={{ flexDirection: "row", alignItems: "center", gap: 7.5 }}>
        <Ico source={ART.ic.check} size={15} color={saved ? W.pink : W.slate} />
        <T size={10.5} weight={500} color={W.inkSoft} style={{ lineHeight: 14 }} testID="wale-custom-saved">
          {saved ? "Look saved" : "Saving…"}
        </T>
      </At>
      <Tap x={286.25} y={doneY} w={128} h={39.5} label="Done" onPress={() => back("/wale/wardrobe")} style={{ borderRadius: 12, backgroundColor: head.done === "white" ? "#FFFFFF" : W.pink }} testID="wale-custom-done">
        <T size={13.5} weight={700} italic={tab === "headwear"} color={head.done === "white" ? W.pink : "#FFFFFF"} spacing={0.4} style={{ lineHeight: 18 }}>
          DONE
        </T>
      </Tap>
    </>
  );

  return (
    <DesignCanvas width={FW} height={H} colors={["#E3F1F7", "#E9F5FA"]} testID="wale-custom" footer={{ y: footY, base: "#EAF4F9", children: footer }}>
      {/* header */}
      <Band y={0} h={71} w={FW} line="bottom" />
      <Tap x={16} y={13.75} w={44} h={44} label="Back" onPress={() => back("/wale/wardrobe")} style={TILE} testID="wale-custom-back">
        <Ico source={ART.ic.chevronBack} size={23} color={W.ink} />
      </Tap>
      {head.kicker ? (
        <At x={72} y={13.5}>
          <T size={10} weight={700} color={W.pink} spacing={1.2} testID="wale-custom-kicker">
            COSQUEST
          </T>
        </At>
      ) : null}
      <At x={72} y={head.title === "Headwear" ? 30.5 : head.kicker ? 28.5 : 21}>
        <T size={21} weight={head.title === "Headwear" ? 700 : 800} style={{ lineHeight: 30 }} testID="wale-custom-title">
          {head.title}
        </T>
      </At>
      {head.shirt !== "none" ? (
        <Tap x={371} y={13.75} w={44} h={44} label="Wardrobe" onPress={() => router.replace("/wale/wardrobe")} style={head.shirt === "bare" ? undefined : TILE} testID="wale-custom-shirt">
          <Ico source={ART.ic.shirt} size={23.5} color={W.ink} />
        </Tap>
      ) : null}
      {head.wrappedKicker ? (
        <At x={370} y={19} w={44}>
          <T size={10} weight={700} color={W.pink} spacing={1.2} lines={2} style={{ lineHeight: 17 }} testID="wale-custom-kicker-right">
            {"COSQ\nUEST"}
          </T>
        </At>
      ) : null}

      {/* the look */}
      <LinearGradient colors={outfits ? ["#E3F1F7", "#EAF5FA"] : ["#B3D8E5", "#E9F5FA"]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={{ position: "absolute", left: 0, top: 71, width: FW, height: 328 }} />
      <At x={pv.x} y={pv.y} w={outfits ? 150 : 310} h={outfits ? 310 : 303} testID="wale-custom-preview">
        <Art source={preview.source} box={preview.box} dx={pv.x} dy={pv.y} label={`Your look: ${lookSummary(look)}`} testID="wale-custom-preview-art" />
      </At>
      <At x={16} y={85.6} w={86} h={24} style={{ borderRadius: 5, backgroundColor: W.chip, alignItems: "center", justifyContent: "center" }} testID="wale-custom-yourlook">
        <T size={8.5} weight={700} color="#FFFFFF" spacing={1.2} style={{ lineHeight: 12 }}>
          YOUR LOOK
        </T>
      </At>
      <At x={370} y={338} w={44} h={44} style={{ borderRadius: 22, backgroundColor: "rgba(255,255,255,0.45)", alignItems: "center", justifyContent: "center" }} testID="wale-custom-rotate">
        <Ico source={ART.ic.rotate} size={23.5} color={W.ink} />
      </At>

      {/* tabs */}
      <Band y={399} h={90} w={FW} color="#EAF5FA" line="bottom" />
      {TABS.map((t) => {
        const on = t.id === tab;
        return (
          <Tap key={t.id} x={t.cx - 38} y={404} w={76} h={72} label={t.label} selected={on} onPress={() => (t.id === "random" ? setLook(randomLook()) : setTab(t.id))} style={{ justifyContent: "flex-start" }} testID={`wale-custom-tab-${t.id}`}>
            <View testID={`wale-custom-tabtile-${t.id}`} style={{ marginTop: 4, width: 44, height: 44, borderRadius: 10, backgroundColor: on ? W.pinkTint : "#FFFFFF", borderWidth: on ? 2 : 1, borderColor: on ? W.pink : "rgba(40,66,78,0.08)", alignItems: "center", justifyContent: "center" }}>
              {t.id === "random" ? <Ico source={ART.ic.random} size={21} color={W.ink} /> : <Art source={TAB_GLYPH[t.id]} box={BOX.tabGlyph[t.id]} dx={t.cx - 22 + (on ? 2 : 1)} dy={408 + (on ? 2 : 1)} tint={on ? W.pink : "#203C48"} />}
            </View>
            <T size={9} weight={700} color={on ? W.pink : W.inkSoft} style={{ marginTop: 5, lineHeight: 12 }} testID={`wale-custom-tablabel-${t.id}`}>
              {t.label}
            </T>
          </Tap>
        );
      })}

      {/* the choices */}
      {tab === "faces" ? (
        <>
          <At x={16} y={497}>
            <T size={10} weight={700} color={W.inkSoft} spacing={0.5} testID="wale-custom-section">
              CHOOSE YOUR FACE
            </T>
          </At>
          {FACES.map((name, i) => (
            <Cell key={name} x={COLS[i % 4]} y={i < 4 ? 522 : 629.4} w={CELL_W} h={99} on={look.face === i} solid={look.face === i} label={`Face ${name.toLowerCase()}`} onPress={() => pick("face", i)} tick={TICK.faces} art={{ source: ART.faces[i], box: BOX.face[i] }} testID={`wale-custom-face-${i}`} />
          ))}
          <At x={16} y={794}>
            <T size={9.5} weight={700} color={W.inkSoft} spacing={0.4} testID="wale-custom-skin-label">
              SKIN TONE
            </T>
          </At>
          <Swatches id="skin" y={815.6} x0={16.25} list={SKIN_TONES} value={look.skin} onPick={(i) => pick("skin", i)} />
          <At x={225.6} y={794}>
            <T size={9.5} weight={700} color={W.inkSoft} spacing={0.4} testID="wale-custom-eye-label">
              EYE COLOR
            </T>
          </At>
          <Swatches id="eye" y={815.6} x0={225.6} list={EYE_COLORS} value={look.eye} onPick={(i) => pick("eye", i)} />
        </>
      ) : null}

      {tab === "hair" ? (
        <>
          <At x={16} y={497}>
            <T size={10} weight={700} color={W.inkSoft} spacing={0.5} testID="wale-custom-section">
              CHOOSE YOUR STYLE
            </T>
          </At>
          {HAIR_STYLES.map((name, i) => (
            <Cell key={name} x={COLS[i % 4]} y={i < 4 ? 521 : 628.75} w={CELL_W} h={99} radius={10} on={look.hair === i} solid={look.hair === i} label={`Hair: ${name}`} onPress={() => pick("hair", i)} tick={TICK.hair} art={{ source: ART.hair[i], box: BOX.hair[i] }} testID={`wale-custom-hair-${i}`} />
          ))}
          <At x={16} y={792}>
            <T size={9.5} weight={700} color={W.inkSoft} spacing={0.4} testID="wale-custom-haircolor-label">
              HAIR COLOR
            </T>
          </At>
          <Swatches id="haircolor" y={813.75} x0={16.25} list={HAIR_COLORS} value={look.hairColor} onPick={(i) => pick("hairColor", i)} />
        </>
      ) : null}

      {tab === "headwear" ? (
        <>
          <At x={16} y={503.5}>
            <T size={9.5} weight={700} color={W.pink} spacing={1.3} testID="wale-custom-section">
              COSQUEST · CHOOSE YOUR HEADWEAR
            </T>
          </At>
          <At x={314} y={502} w={100} style={{ alignItems: "flex-end" }}>
            <T size={10} weight={700} color={W.inkSoft} align="right" testID="wale-custom-count">{`${HEADWEAR.length} items`}</T>
          </At>
          {HEADWEAR.map((name, i) => (
            <Cell key={name} x={COLS[i % 4]} y={i < 4 ? 534.4 : 662.5} w={CELL_W} h={115} radius={10} solid on={look.headwear === i} label={`Headwear: ${name}`} onPress={() => pick("headwear", i)} tick={TICK.headwear} art={{ source: ART.headwear[i], box: BOX.headwear[i] }} testID={`wale-custom-headwear-${i}`} />
          ))}
          <At x={16.25} y={797} w={398} h={41} style={{ borderRadius: 10, backgroundColor: "rgba(255,255,255,0.7)", flexDirection: "row", alignItems: "center", paddingLeft: 14, gap: 10 }} testID="wale-custom-status">
            <Ico source={ART.ic.check} size={15} color={W.pink} />
            <T size={13.5} weight={700}>
              {equippedLine("Headwear", look.headwear)}
            </T>
          </At>
        </>
      ) : null}

      {outfits ? (
        <>
          <At x={16} y={501}>
            <T size={10} weight={700} spacing={0.4} testID="wale-custom-section">
              CHOOSE YOUR OUTFIT
            </T>
          </At>
          <At x={314} y={501} w={100} style={{ alignItems: "flex-end" }}>
            <T size={10} weight={500} color={W.slate} align="right" testID="wale-custom-count">{`${OUTFITS.length} items`}</T>
          </At>
          {OUTFITS.map((o, i) => {
            const y = i < 2 ? 532.7 : 874;
            const x = i % 2 === 0 ? 17.3 : 222.7;
            return (
              <View key={o.name}>
                <Cell x={x} y={y} w={189.7} h={299} radius={12} on={look.outfit === i} label={`${o.name}, ${o.color.name}`} onPress={() => pick("outfit", i)} tick={TICK.outfits} art={{ source: ART.outfits[i], box: BOX.cardOutfit[i] }} testID={`wale-custom-outfit-${i}`} />
                <At x={x} y={y + (i < 2 ? 310 : 312)}>
                  <T size={12} weight={700} testID={`wale-custom-outfit-label-${i}`}>
                    {look.outfit === i ? `${o.name} · Equipped` : o.name}
                  </T>
                </At>
              </View>
            );
          })}
          <At x={17} y={1218}>
            <T size={9} weight={700} color={W.inkSoft} spacing={0.4} testID="wale-custom-outfitcolor-label">
              OUTFIT COLOR
            </T>
          </At>
          <At x={17.3} y={1239} w={32} h={33} style={{ borderRadius: 5, backgroundColor: OUTFITS[look.outfit].color.color, borderWidth: 2.5, borderColor: W.pink }} testID="wale-custom-outfitcolor" />
          <At x={17} y={1289}>
            <T size={12} weight={700} testID="wale-custom-outfitcolor-name">
              {OUTFITS[look.outfit].color.name}
            </T>
          </At>
          <At x={16} y={1321} w={398} h={40} style={{ borderRadius: 10, backgroundColor: "rgba(255,255,255,0.7)", flexDirection: "row", alignItems: "center", paddingLeft: 15.5, gap: 10.5 }} testID="wale-custom-status">
            <Ico source={ART.ic.check} size={15} color={W.pink} />
            <T size={10.5} weight={500}>
              {equippedLine("Outfit", look.outfit)}
            </T>
          </At>
        </>
      ) : null}
    </DesignCanvas>
  );
}
