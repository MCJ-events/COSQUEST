// Wale's Faction screen (build 24): how a player picks a faction now that the
// Warden no longer asks. His Figma has no faction screen, so this is a plain
// picker drawn in his style (components/waleui/FactionScreen.tsx), reached from
// the FACTION button on his Home. Joining goes through progression (Wale's
// brief, 7 Nov: pick -> pass that faction's entry test -> Initiate with the
// starter weapon); the entry test itself is the game's Ranks sheet.
// Pure: no React Native imports (tested in __tests__/factionPick.test.ts).
import { factionId } from "./heroCast.ts";

/** What the picker needs from a progression faction (ProgFaction). */
export type PickSource = { id: string; name: string; themes?: string | null; placeholder?: boolean | null; active?: boolean | null; sort?: number | null };

export type PickCard = {
  id: string;
  name: string;
  /** One plain line under the name: the faction's themes, or "Coming soon". */
  line: string;
  /** Not open yet (the server marks it a placeholder): shown, not pickable. */
  soon: boolean;
};

/** Words that must never reach this screen: the factions are CosQuest's own, not other companies' brands or genres. */
export const NOT_OURS = /\b(marvel|dc|anime|comic(?: book)?s?)\b/i;

function pending(f: PickSource): boolean {
  return !!f.placeholder || /not finali[sz]ed|pending|placeholder|\btbd\b/i.test(f.themes ?? "");
}

/** The six factions as cards, in the server's order. Only the name and the themes are shown (never the "realm", which names genres). */
export function pickCards(factions: readonly PickSource[]): PickCard[] {
  return factions
    .filter((f) => f.active !== false)
    .slice()
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    .map((f) => {
      const soon = pending(f);
      const themes = (f.themes ?? "").trim();
      const line = soon || !themes || NOT_OURS.test(themes) ? (soon ? "Coming soon" : "") : themes;
      return { id: f.id, name: f.name, line, soon };
    });
}

/**
 * Which card starts selected: the faction the player is joining (entry test not passed yet),
 * else the one they chose in the chat app at sign-up, if it is open; else none.
 */
export function preselect(
  cards: readonly PickCard[],
  prog: { faction?: string | null; pending?: { faction: string } | null } | null | undefined,
  chatFaction: string | { id?: string | null } | null | undefined,
): string | null {
  const open = (id: string | null | undefined) => (id ? cards.find((c) => c.id === id && !c.soon)?.id ?? null : null);
  return open(prog?.faction) ?? open(prog?.pending?.faction) ?? open(factionId(chatFaction));
}

/** The main button's job for the current state. */
export type PickAction = { kind: "join"; faction: string } | { kind: "test"; faction: string } | { kind: "ranks" } | { kind: "none" };

export function pickAction(
  selected: string | null,
  prog: { faction?: string | null; pending?: { faction: string } | null } | null | undefined,
): PickAction {
  if (prog?.faction) return { kind: "ranks" };
  if (!selected) return { kind: "none" };
  if (prog?.pending?.faction === selected) return { kind: "test", faction: selected };
  return { kind: "join", faction: selected };
}

export function actionLabel(a: PickAction, name: string | null): string {
  switch (a.kind) {
    case "ranks":
      return "SEE YOUR RANK";
    case "test":
      return "TAKE THE ENTRY TEST";
    case "join":
      return `JOIN ${(name ?? "").toUpperCase()}`.trim();
    default:
      return "PICK A FACTION";
  }
}
