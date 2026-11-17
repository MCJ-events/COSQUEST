// The homepage's buttons that land on a game sheet (Friends, Squad, Coins,
// Faction war, Ranks). Those sheets live inside the game (GameRoot's own
// state), not on a route, so the homepage leaves a request here and swipes to
// the game; GameRoot takes it once it is on screen. One request at a time,
// the newest wins. Pure (tested in __tests__/intent.test.ts).
export type WaleSheet = "friends" | "squad" | "coins" | "war" | "ranks" | "collection";

export function createSheetIntent() {
  let pending: WaleSheet | null = null;
  const listeners = new Set<() => void>();
  return {
    request(sheet: WaleSheet) {
      pending = sheet;
      listeners.forEach((l) => l());
    },
    /** The game takes the request (once). */
    take(): WaleSheet | null {
      const s = pending;
      pending = null;
      return s;
    },
    peek: () => pending,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const sheetIntent = createSheetIntent();
