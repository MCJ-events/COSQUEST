// The faction heroes' pictures for Wale's screens (realism, 12 Nov 2026): the home hero slot, the
// weapon page and the customiser preview show the player's faction hero until the player has a
// Forge character of their own. Rendered from the game's own models and library idle by
// game3d/tools/portrait.gd ("full_px": [768, 1152]), cut to the figure; the bust is the top of
// the same render. About 0.36 MB per hero. Kofi (Blockbusters) was rendered the same way for build 23.
// Build 26: Imani, Kofi, Zuri, Lyra and Tavo re-rendered from their new hybrid models (new heads and hair;
// Lyra's new hands); Oren is unchanged.
import { useGame } from "@/features/game/runtime";
import { type FactionHero, heroForFaction } from "@/features/waleui/heroCast";
import { useAppSelector } from "@/store/hooks";

export type HeroArt = { full: number; bust: number };

const ART: Record<string, HeroArt> = {
  ascendants_zuri: { full: require("@/assets/images/heroes/ascendants_zuri_full.png"), bust: require("@/assets/images/heroes/ascendants_zuri_bust.png") },
  controllers_tavo: { full: require("@/assets/images/heroes/controllers_tavo_full.png"), bust: require("@/assets/images/heroes/controllers_tavo_bust.png") },
  icons_imani: { full: require("@/assets/images/heroes/icons_imani_full.png"), bust: require("@/assets/images/heroes/icons_imani_bust.png") },
  everborn_oren: { full: require("@/assets/images/heroes/everborn_oren_full.png"), bust: require("@/assets/images/heroes/everborn_oren_bust.png") },
  blockbusters_kofi: { full: require("@/assets/images/heroes/blockbusters_kofi_full.png"), bust: require("@/assets/images/heroes/blockbusters_kofi_bust.png") },
  celestials_lyra: { full: require("@/assets/images/heroes/celestials_lyra_full.png"), bust: require("@/assets/images/heroes/celestials_lyra_bust.png") },
};

export function heroArt(key: string | null | undefined): HeroArt | null {
  return (key && ART[key]) || null;
}

/** The player's faction, from the game's "me", else the chat profile. */
export function usePlayerFaction(): string | null {
  const gameFaction = useGame((s) => s.me?.faction ?? null);
  const chatFaction = useAppSelector((s) => ((s.user.user ?? s.auth.user) as { faction?: string | { id?: string } | null } | null)?.faction ?? null);
  return gameFaction ?? (typeof chatFaction === "string" ? chatFaction : (chatFaction?.id ?? null));
}

/** The player's faction hero and its pictures; null when the faction is unknown or has no picture yet. */
export function useFactionHero(): (FactionHero & HeroArt) | null {
  const hero = heroForFaction(usePlayerFaction());
  const art = heroArt(hero?.key);
  return hero && art ? { ...hero, ...art } : null;
}
