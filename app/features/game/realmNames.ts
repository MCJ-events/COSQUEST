// The map's five realms under the brief's faction names (build 21). The game server still
// keys realms by their old ids (anime, marvel, dc, movies, gaming) and the live server still
// NAMES them that way until its FACTION_NAMES change is deployed; "Marvel" and "DC" are other
// companies' trademarks and were on screen ("ROOKIE OF HOUSE MARVEL", the faction war, the
// public trivia board). The ids stay (they are the wire and the stored data); every name a
// player sees goes through here. Pure, so node tests it.
//
// The mapping is features/world/factionLink.ts GAME_TO_CHAT, except DC: that table puts Marvel
// AND DC into Icons, but two realms with one name collide where realms are listed side by side
// (the faction war, room sides keyed by name on the server). DC shows as Everborns (its Warden
// voice is "mythic", "old legends") until Wale and Mark say otherwise. Celestials has no realm.

export const REALM_NAMES: Record<string, string> = {
  anime: "Ascendants",
  marvel: "Icons",
  dc: "Everborns",
  movies: "Blockbusters",
  gaming: "Controllers",
};

const LEGACY_LABELS: Record<string, string> = { anime: "anime", marvel: "marvel", dc: "dc", movies: "movies", gaming: "gaming" };

/** A realm id's name: "marvel" -> "Icons"; an unknown id title-cased; none -> "No faction". */
export function realmName(id: string | null | undefined): string {
  if (!id) return "No faction";
  const k = id.toLowerCase();
  return REALM_NAMES[k] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

/** A name the server sent: an old realm label ("Marvel", "DC") becomes the faction's; anything else as sent. */
export function cleanRealmLabel(name: string): string {
  const k = LEGACY_LABELS[name.trim().toLowerCase()];
  if (k) return REALM_NAMES[k];
  const g = /^(Guardian of|Keeper of|House) (Anime|Marvel|DC|Movies|Gaming)$/i.exec(name.trim());
  if (g) return `${g[1]} ${REALM_NAMES[g[2].toLowerCase()]}`;
  return name;
}

/** Keys whose string value is a faction's display name in the game server's answers. */
const NAME_KEYS = new Set(["faction_name", "realm_name", "faction_attacked_name", "by_faction_name", "holder_name", "siege_faction_name", "holder"]);

/**
 * JSON.parse reviver for the game server's answers: old realm labels in faction-name fields,
 * a realm's {id, name} entry (the config's factions), realm_names maps and "Guardian of Marvel".
 * Ids are never touched ("holder": "marvel" stays; only "holder": "Marvel" with a capital is a name).
 */
export function realmReviver(this: unknown, key: string, value: unknown): unknown {
  if (typeof value !== "string" || value === "") return value;
  const holder = this as Record<string, unknown> | null;
  if (NAME_KEYS.has(key)) return key === "holder" && value === value.toLowerCase() ? value : cleanRealmLabel(value);
  if (key === "name" && holder && typeof holder.id === "string" && LEGACY_LABELS[holder.id]) return cleanRealmLabel(value);
  if (key === "name" || key === "guardian") return /^(Guardian|Keeper) of /i.test(value) ? cleanRealmLabel(value) : value;
  if (holder && Object.prototype.hasOwnProperty.call(holder, key) && LEGACY_LABELS[key] && key !== "" && isRealmMap(holder)) return cleanRealmLabel(value);
  return value;
}

function isRealmMap(o: Record<string, unknown>): boolean {
  const keys = Object.keys(o);
  return keys.length > 0 && keys.every((k) => LEGACY_LABELS[k]);
}
