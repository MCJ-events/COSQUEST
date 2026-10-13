// The world's small shared state: which page is showing, what the game was
// asked to open, whether the swipe has been taught. A tiny external store
// (like components/calls/callUi.ts), so the pager, the chat's invite cards,
// deep links and the game bridge all agree without prop-drilling.
// Pure: no React Native imports (the hook lives in components/world/useWorld.ts).
import type { GameTarget } from "./deepLink.ts";

export type WorldState = {
  /** Where the pager has settled. */
  page: "chat" | "game";
  /** The game has been mounted (prewarmed or opened). */
  gameMounted: boolean;
  /** Waiting for the pager: open the game at this spot. */
  pendingTarget: GameTarget | null;
  /** Bumped by every open request, so the pager animates even to the same page. */
  openSerial: number;
  /** Bumped by every "back to chat" request. */
  closeSerial: number;
  /** A chat to open after returning to the chat page. */
  pendingChatId: string | null;
  /** The game's faction colour, once the game says who the player is. */
  factionColor: string | null;
};

export function createWorldStore(initial?: Partial<WorldState>) {
  let state: WorldState = {
    page: "chat",
    gameMounted: false,
    pendingTarget: null,
    openSerial: 0,
    closeSerial: 0,
    pendingChatId: null,
    factionColor: null,
    ...initial,
  };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<WorldState>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };
  return {
    get: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Swipe to the game (optionally opening a spot there). */
    openGame(target: GameTarget | null = null) {
      set({ pendingTarget: target, openSerial: state.openSerial + 1, gameMounted: true });
    },
    /** Swipe back to the chat (optionally into one conversation). */
    openChat(chatId: string | null = null) {
      set({ pendingChatId: chatId, closeSerial: state.closeSerial + 1 });
    },
    settled(page: "chat" | "game") {
      if (state.page !== page) set({ page });
    },
    mountGame() {
      if (!state.gameMounted) set({ gameMounted: true });
    },
    takeTarget(): GameTarget | null {
      const target = state.pendingTarget;
      if (target) set({ pendingTarget: null });
      return target;
    },
    takeChatId(): string | null {
      const chatId = state.pendingChatId;
      if (chatId) set({ pendingChatId: null });
      return chatId;
    },
    setFactionColor(color: string | null) {
      if (state.factionColor !== color) set({ factionColor: color });
    },
    reset() {
      set({ page: "chat", gameMounted: false, pendingTarget: null, pendingChatId: null, factionColor: null });
    },
  };
}

export type WorldStore = ReturnType<typeof createWorldStore>;

/** The app's one world. */
export const world = createWorldStore();

/** The game's faction colours (costquest-ios Roam/RoamStyle.swift realmColor). */
export const GAME_FACTION_COLORS: Record<string, string> = {
  anime: "#FF5C99",
  marvel: "#E33636",
  dc: "#2973ED",
  movies: "#F59E21",
  gaming: "#33C773",
};

/** The chat's faction colours (constants/factions.ts glowColour). */
export const CHAT_FACTION_COLORS: Record<string, string> = {
  ascendants: "#D633A8",
  icons: "#6E80F6",
  controllers: "#2D6ED2",
  blockbusters: "#C8D800",
  everborn: "#F92896",
  everborns: "#F92896",
  celestials: "#50BEF5",
};

/** The veil colour: the game faction if known, else the chat's, else the game's sky. */
export function factionVeilColor(gameFaction?: string | null, chatFaction?: string | null): string {
  if (gameFaction && GAME_FACTION_COLORS[gameFaction]) return GAME_FACTION_COLORS[gameFaction];
  if (chatFaction && CHAT_FACTION_COLORS[chatFaction]) return CHAT_FACTION_COLORS[chatFaction];
  return "#2B99D6";
}
