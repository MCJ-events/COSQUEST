// The characters' 2D art (build 29, Subomi, 18 Nov 2026): every place that shows the player as a picture shows
// this, never a render of the 3D model (at the game camera nobody sees a face up close; here they do).
// Cut from each character's clean front concept view on its foreground mask by
// game3d/tools/forge_chars/char_art.py: the full figure ("card", 720 px tall), head and shoulders ("portrait",
// 384 px square) and a 1080 x 1920 card to post ("share"). The faction heroes' art is their concept art (the
// pictures their 3D models were made from); the Forge characters' is the turnaround front view the Forge pipeline
// used. Only playable characters are here (features/waleui/characters.ts; the test checks both lists match).
export type CharacterArt = { card: number; portrait: number; share: number };

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
};

export function characterArt(key: string | null | undefined): CharacterArt | null {
  return (key && ART[key]) || null;
}
