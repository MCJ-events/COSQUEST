// Wale's own art for the Wardrobe and the customiser (build 23, 12 Nov 2026).
//
// Every picture here is cut out of his Figma frames (the captures in
// cosquest-review/realism-20261111/experiments/screens/figma-captures), made
// sharper with Real-ESRGAN and cut from the background with BiRefNet. Each one
// is placed at the box it has in his frame (custArtBoxes.ts, Figma px), so the
// art sits where he put it.
//
// Three kinds of picture:
//   - the character: the close bust (Faces), the wider bust (Hair Styles and
//     Headwear), four whole-body outfits (Outfits) and the action pose (Wardrobe);
//   - the grid cells: 8 faces, 8 hair styles, 8 headwear, each the inside of his cell;
//   - glyphs, white on clear so they can be tinted: his flat tab drawings
//     (face, hair, cap, shirt), the white glyphs in the Wardrobe's round
//     buttons, and his line icons. The line icons in his frames are Lucide
//     icons (ISC licence), so they are drawn from the Lucide icon data at the
//     size and stroke his frames show.
//
// The pictures are flat: a face, hair, headwear or colour choice is saved but
// cannot change them. Only the outfit changes the character picture.
import { Image, type ImageSource } from "expo-image";

import { BOX } from "./custArtBoxes";

export type Box = readonly [number, number, number, number];
type Src = ImageSource | number;

/**
 * A picture at its box on the canvas. `dx`, `dy` are the origin of the block
 * it is drawn inside (a block's children are placed from the block's corner).
 * With `tint` the picture is drawn in that one colour.
 */
export function Art({ source, box, dx = 0, dy = 0, tint, label, testID }: { source: Src; box: Box; dx?: number; dy?: number; tint?: string; label?: string; testID?: string }) {
  return <Image source={source} testID={testID} accessible={!!label} accessibilityLabel={label} contentFit="fill" tintColor={tint} style={{ position: "absolute", left: box[0] - dx, top: box[1] - dy, width: box[2], height: box[3] }} />;
}

/** A square line icon in one colour, in the flow of a row. */
export function Ico({ source, size, color, style }: { source: Src; size: number; color: string; style?: { marginRight?: number; marginLeft?: number } }) {
  return <Image source={source} accessible={false} contentFit="contain" tintColor={color} style={[{ width: size, height: size }, style]} />;
}

export const ART = {
  previewFaces: require("@/assets/images/waleui/cust_preview_faces.png") as number,
  previewBust: require("@/assets/images/waleui/cust_preview_bust.png") as number,
  wardrobeAction: require("@/assets/images/waleui/wardrobe_hero_action.png") as number,
  /** The four whole-body outfits, in the order of his Outfits frame. */
  outfits: [
    require("@/assets/images/waleui/cust_outfit_1.png") as number,
    require("@/assets/images/waleui/cust_outfit_2.png") as number,
    require("@/assets/images/waleui/cust_outfit_3.png") as number,
    require("@/assets/images/waleui/cust_outfit_4.png") as number,
  ],
  faces: [
    require("@/assets/images/waleui/cust_face_1.png") as number,
    require("@/assets/images/waleui/cust_face_2.png") as number,
    require("@/assets/images/waleui/cust_face_3.png") as number,
    require("@/assets/images/waleui/cust_face_4.png") as number,
    require("@/assets/images/waleui/cust_face_5.png") as number,
    require("@/assets/images/waleui/cust_face_6.png") as number,
    require("@/assets/images/waleui/cust_face_7.png") as number,
    require("@/assets/images/waleui/cust_face_8.png") as number,
  ],
  hair: [
    require("@/assets/images/waleui/cust_hair_1.png") as number,
    require("@/assets/images/waleui/cust_hair_2.png") as number,
    require("@/assets/images/waleui/cust_hair_3.png") as number,
    require("@/assets/images/waleui/cust_hair_4.png") as number,
    require("@/assets/images/waleui/cust_hair_5.png") as number,
    require("@/assets/images/waleui/cust_hair_6.png") as number,
    require("@/assets/images/waleui/cust_hair_7.png") as number,
    require("@/assets/images/waleui/cust_hair_8.png") as number,
  ],
  headwear: [
    require("@/assets/images/waleui/cust_headwear_1.png") as number,
    require("@/assets/images/waleui/cust_headwear_2.png") as number,
    require("@/assets/images/waleui/cust_headwear_3.png") as number,
    require("@/assets/images/waleui/cust_headwear_4.png") as number,
    require("@/assets/images/waleui/cust_headwear_5.png") as number,
    require("@/assets/images/waleui/cust_headwear_6.png") as number,
    require("@/assets/images/waleui/cust_headwear_7.png") as number,
    require("@/assets/images/waleui/cust_headwear_8.png") as number,
  ],
  /** His flat tab drawings (white, tinted slate or pink). */
  glyph: {
    face: require("@/assets/images/waleui/cust_glyph_face.png") as number,
    hair: require("@/assets/images/waleui/cust_glyph_hair.png") as number,
    cap: require("@/assets/images/waleui/cust_glyph_cap.png") as number,
    shirt: require("@/assets/images/waleui/cust_glyph_shirt.png") as number,
  },
  /** The white glyphs in the Wardrobe's five round buttons. */
  circle: {
    face: require("@/assets/images/waleui/wardrobe_circle_face.png") as number,
    hair: require("@/assets/images/waleui/wardrobe_circle_hair.png") as number,
    headwear: require("@/assets/images/waleui/wardrobe_circle_headwear.png") as number,
    outfit: require("@/assets/images/waleui/wardrobe_circle_outfit.png") as number,
    companion: require("@/assets/images/waleui/wardrobe_circle_companion.png") as number,
  },
  /** Line icons (white, tinted). */
  ic: {
    face: require("@/assets/images/waleui/wardrobe_ic_face.png") as number,
    hair: require("@/assets/images/waleui/wardrobe_ic_hair.png") as number,
    headwear: require("@/assets/images/waleui/wardrobe_ic_headwear.png") as number,
    outfit: require("@/assets/images/waleui/wardrobe_ic_outfit.png") as number,
    companion: require("@/assets/images/waleui/wardrobe_ic_companion.png") as number,
    dice: require("@/assets/images/waleui/wardrobe_ic_dice.png") as number,
    plus: require("@/assets/images/waleui/wardrobe_ic_plus.png") as number,
    more: require("@/assets/images/waleui/wardrobe_ic_more.png") as number,
    arrowBack: require("@/assets/images/waleui/wardrobe_ic_back.png") as number,
    close: require("@/assets/images/waleui/wardrobe_ic_close.png") as number,
    chevron: require("@/assets/images/waleui/wardrobe_ic_chevron.png") as number,
    random: require("@/assets/images/waleui/cust_ic_random.png") as number,
    rotate: require("@/assets/images/waleui/cust_ic_rotate.png") as number,
    chevronBack: require("@/assets/images/waleui/cust_ic_back.png") as number,
    shirt: require("@/assets/images/waleui/cust_ic_shirt.png") as number,
    check: require("@/assets/images/waleui/cust_ic_check.png") as number,
  },
} as const;

/** The character picture and its box in the customiser preview, for a tab and the outfit worn. */
export function previewArt(tab: "faces" | "hair" | "headwear" | "outfits", outfit: number): { source: number; box: Box } {
  if (tab === "outfits") return { source: ART.outfits[outfit] ?? ART.outfits[0], box: BOX.previewOutfit[outfit] ?? BOX.previewOutfit[0] };
  return tab === "faces" ? { source: ART.previewFaces, box: BOX.previewFaces } : { source: ART.previewBust, box: BOX.previewBust };
}

/** The Wardrobe's character: his action pose for outfit 1 (the only one he drew in it), the standing picture for the others. */
export function wardrobeArt(outfit: number): { source: number; box: Box } {
  if (outfit === 0) return { source: ART.wardrobeAction, box: BOX.wardrobeHero[0] };
  return { source: ART.outfits[outfit] ?? ART.outfits[0], box: BOX.wardrobeHero[outfit] ?? BOX.wardrobeHero[0] };
}
