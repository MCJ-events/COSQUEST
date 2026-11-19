// The characters' 2D art (build 29, Subomi, 18 Nov 2026): every place that shows the player as a picture shows
// this, never a render of the 3D model (at the game camera nobody sees a face up close; here they do).
// Cut from each character's clean front concept view on its foreground mask by
// game3d/tools/forge_chars/char_art.py: the full figure ("card", 720 px tall), head and shoulders ("portrait",
// 384 px square) and a 1080 x 1920 card to post ("share"). The faction heroes' art is their concept art (the
// pictures their 3D models were made from); the Forge characters' is the turnaround front view the Forge pipeline
// used (build 30: Bram too). Only playable characters are here (features/waleui/characters.ts; the test checks both lists match).
import type { ForgeEntry } from "@/features/game/forgeWorld";
import { figureUrl, thumbUrl } from "@/features/game/forgeWorldDevice";

/** A bundled picture (require) or a URL. */
export type ArtSource = number | { uri: string };
/** card: the full figure; portrait: head and shoulders; share: the 9:16 card to post (a catalogue character: its
 *  full figure, there is no server-made card yet). */
export type CharacterArt = { card: ArtSource; portrait: ArtSource; share: ArtSource };

const ART: Record<string, CharacterArt> = {
  ascendants_zuri: {
    card: require("@/assets/images/characters/ascendants_zuri_card.png"),
    portrait: require("@/assets/images/characters/ascendants_zuri_portrait.png"),
    share: require("@/assets/images/characters/ascendants_zuri_share.jpg"),
  },
  controllers_tavo: {
    card: require("@/assets/images/characters/controllers_tavo_card.png"),
    portrait: require("@/assets/images/characters/controllers_tavo_portrait.png"),
    share: require("@/assets/images/characters/controllers_tavo_share.jpg"),
  },
  icons_imani: {
    card: require("@/assets/images/characters/icons_imani_card.png"),
    portrait: require("@/assets/images/characters/icons_imani_portrait.png"),
    share: require("@/assets/images/characters/icons_imani_share.jpg"),
  },
  everborn_oren: {
    card: require("@/assets/images/characters/everborn_oren_card.png"),
    portrait: require("@/assets/images/characters/everborn_oren_portrait.png"),
    share: require("@/assets/images/characters/everborn_oren_share.jpg"),
  },
  celestials_lyra: {
    card: require("@/assets/images/characters/celestials_lyra_card.png"),
    portrait: require("@/assets/images/characters/celestials_lyra_portrait.png"),
    share: require("@/assets/images/characters/celestials_lyra_share.jpg"),
  },
  blockbusters_kofi: {
    card: require("@/assets/images/characters/blockbusters_kofi_card.png"),
    portrait: require("@/assets/images/characters/blockbusters_kofi_portrait.png"),
    share: require("@/assets/images/characters/blockbusters_kofi_share.jpg"),
  },
  forge_courier: {
    card: require("@/assets/images/characters/forge_courier_card.png"),
    portrait: require("@/assets/images/characters/forge_courier_portrait.png"),
    share: require("@/assets/images/characters/forge_courier_share.jpg"),
  },
  forge_bram: {
    card: require("@/assets/images/characters/forge_bram_card.png"),
    portrait: require("@/assets/images/characters/forge_bram_portrait.png"),
    share: require("@/assets/images/characters/forge_bram_share.jpg"),
  },
};

export function characterArt(key: string | null | undefined): CharacterArt | null {
  return (key && ART[key]) || null;
}

/**
 * Build 31: a catalogue character's 2D art, from the catalogue itself: `portrait.full` (the full figure on a clear
 * page) and `portrait.url` (the head-and-shoulders bust). For the Forge characters those are their turnaround art
 * (an admin uploads them with the portrait route), not a render of the model. Without a full figure the card falls
 * back to the bust, then the build's thumbnail; null when the entry has no picture at all.
 */
export function catalogueArt(entry: Pick<ForgeEntry, "portrait" | "thumbnail"> | null | undefined): CharacterArt | null {
  const full = figureUrl(entry, 512);
  const bust = thumbUrl(entry, 256);
  const card = full ?? thumbUrl(entry, 512);
  if (!card || !bust) return null;
  return { card: { uri: card }, portrait: { uri: bust }, share: { uri: full ?? card } };
}
