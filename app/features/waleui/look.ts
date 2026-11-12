// The player's look in Wale's customiser (Figma frames Wardrobe, Faces, Hair
// Styles, Headwear, Outfits; 10 to 11 Nov 2026).
//
// Wale's corrections of 11 Nov, applied here over the Figma:
//   - the face grid is ONE character with eight variants, not eight people;
//   - the customiser is the same for every faction (a faction only changes
//     the colours of the UI), so nothing here is keyed by faction.
//
// A look is a set of indexes into the option lists below. It is saved on the
// phone (components/waleui/lookStore.ts); the server has no field for it yet
// (listed in the screens README as a missing endpoint). The pictures for the
// options are Wale's own art (components/waleui/custArt.tsx), in the same
// order as the lists below; this file stays pictures-free so it can be tested.
//
// Pure (tested in features/waleui/__tests__/look.test.ts).

export type Swatch = { id: string; name: string; color: string };

/** Colours read off Wale's frames (figma-captures, 11 Nov). */
export const SKIN_TONES: Swatch[] = [
  { id: "skin-1", name: "Light", color: "#E8BB9D" },
  { id: "skin-2", name: "Tan", color: "#B78158" },
  { id: "skin-3", name: "Warm brown", color: "#BD8D62" },
  { id: "skin-4", name: "Brown", color: "#624029" },
  { id: "skin-5", name: "Deep", color: "#321A12" },
];
export const EYE_COLORS: Swatch[] = [
  { id: "eye-1", name: "Green", color: "#6FA418" },
  { id: "eye-2", name: "Blue", color: "#3187AF" },
  { id: "eye-3", name: "Amber", color: "#995411" },
  { id: "eye-4", name: "Grey", color: "#5A7078" },
  { id: "eye-5", name: "Dark brown", color: "#381B13" },
];
export const HAIR_COLORS: Swatch[] = [
  { id: "hair-c1", name: "Blonde", color: "#E1BE61" },
  { id: "hair-c2", name: "Brown", color: "#593219" },
  { id: "hair-c3", name: "Black", color: "#12171F" },
  { id: "hair-c4", name: "Red", color: "#A84132" },
  { id: "hair-c5", name: "Lilac", color: "#B67CAC" },
  { id: "hair-c6", name: "Teal", color: "#086E6A" },
  { id: "hair-c7", name: "Magenta", color: "#880A5C" },
  { id: "hair-c8", name: "Blue", color: "#186FBA" },
  { id: "hair-c9", name: "Green", color: "#59D45E" },
];

/** Eight variants of the same character (Wale, 11 Nov), not eight characters. */
export const FACES: string[] = ["Variant 1", "Variant 2", "Variant 3", "Variant 4", "Variant 5", "Variant 6", "Variant 7", "Variant 8"];
/** In the order of his Hair Styles frame, left to right, top row first. */
export const HAIR_STYLES: string[] = ["Waves", "Short locs", "Spikes", "Long locs", "Mohawk", "Cornrows", "Twists", "Braids"];
/** In the order of his Headwear frame. */
export const HEADWEAR: string[] = ["Hood", "Goggles", "Turban wrap", "Bandana", "Beanie", "Beret", "Conical hat", "Backwards cap"];
/** Four whole outfits, each with the one colour his frame shows for it. */
export const OUTFITS: { name: string; color: Swatch }[] = [
  { name: "Outfit 1", color: { id: "outfit-c1", name: "Ice blue", color: "#74B7DB" } },
  { name: "Outfit 2", color: { id: "outfit-c2", name: "White", color: "#F1F3F5" } },
  { name: "Outfit 3", color: { id: "outfit-c3", name: "Black and gold", color: "#2A2A33" } },
  { name: "Outfit 4", color: { id: "outfit-c4", name: "Purple", color: "#8E3CC9" } },
];

export type Look = { face: number; skin: number; eye: number; hair: number; hairColor: number; headwear: number; outfit: number };
export type LookKey = keyof Look;

/** How many choices each part has. */
export const LOOK_SIZES: Record<LookKey, number> = {
  face: FACES.length,
  skin: SKIN_TONES.length,
  eye: EYE_COLORS.length,
  hair: HAIR_STYLES.length,
  hairColor: HAIR_COLORS.length,
  headwear: HEADWEAR.length,
  outfit: OUTFITS.length,
};

/** What his frames show selected: face 1, third skin tone, third eye colour, hair 4, second hair colour, headwear 1, outfit 1. */
export const DEFAULT_LOOK: Look = { face: 0, skin: 2, eye: 2, hair: 3, hairColor: 1, headwear: 0, outfit: 0 };

/** Two saved looks ("Style 1", "Style 2" in his Wardrobe frame) and which one is worn. */
export type Wardrobe = { slots: [Look, Look]; active: 0 | 1 };

export const DEFAULT_WARDROBE: Wardrobe = { slots: [DEFAULT_LOOK, DEFAULT_LOOK], active: 0 };

function clampIndex(v: unknown, size: number, fallback: number): number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v < size ? v : fallback;
}

/** A look from anything (saved JSON from an older build, a hand edit): unknown or out-of-range parts fall back to the default. */
export function cleanLook(raw: unknown): Look {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_LOOK };
  for (const k of Object.keys(LOOK_SIZES) as LookKey[]) out[k] = clampIndex(r[k], LOOK_SIZES[k], DEFAULT_LOOK[k]);
  return out;
}

export function setPart(look: Look, key: LookKey, index: number): Look {
  return { ...look, [key]: clampIndex(index, LOOK_SIZES[key], look[key]) };
}

/** RANDOMIZE and the Random tab: every part rolled. `rand` is injected so it can be tested. */
export function randomLook(rand: () => number = Math.random): Look {
  const out = { ...DEFAULT_LOOK };
  for (const k of Object.keys(LOOK_SIZES) as LookKey[]) out[k] = Math.min(LOOK_SIZES[k] - 1, Math.floor(rand() * LOOK_SIZES[k]));
  return out;
}

export function activeLook(w: Wardrobe): Look {
  return w.slots[w.active];
}

export function withActiveLook(w: Wardrobe, look: Look): Wardrobe {
  const slots: [Look, Look] = [w.slots[0], w.slots[1]];
  slots[w.active] = look;
  return { slots, active: w.active };
}

export function pickSlot(w: Wardrobe, slot: 0 | 1): Wardrobe {
  return { slots: w.slots, active: slot };
}

export function serializeWardrobe(w: Wardrobe): string {
  return JSON.stringify({ v: 1, active: w.active, slots: w.slots });
}

/** Never throws: a missing or broken save is the default wardrobe. */
export function parseWardrobe(text: string | null | undefined): Wardrobe {
  if (!text) return DEFAULT_WARDROBE;
  try {
    const raw = JSON.parse(text) as { active?: unknown; slots?: unknown };
    const slots = Array.isArray(raw.slots) ? raw.slots : [];
    return { slots: [cleanLook(slots[0]), cleanLook(slots[1])], active: raw.active === 1 ? 1 : 0 };
  } catch {
    return DEFAULT_WARDROBE;
  }
}

/** The line under a grid ("Headwear 1 equipped", "Outfit 1 equipped"), numbered as his frames number them. */
export function equippedLine(part: "Headwear" | "Outfit", index: number): string {
  return `${part} ${index + 1} equipped`;
}

/** One line for a screen reader and for the preview placeholder. */
export function lookSummary(look: Look): string {
  return [
    FACES[look.face],
    `${SKIN_TONES[look.skin].name} skin`,
    `${EYE_COLORS[look.eye].name} eyes`,
    `${HAIR_STYLES[look.hair]}, ${HAIR_COLORS[look.hairColor].name.toLowerCase()}`,
    HEADWEAR[look.headwear],
    `${OUTFITS[look.outfit].name}, ${OUTFITS[look.outfit].color.name.toLowerCase()}`,
  ].join(" · ");
}
