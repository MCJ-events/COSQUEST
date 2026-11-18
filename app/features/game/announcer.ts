// The Warden announcer on the phone: the game's referee voice (Mark, 13 Nov
// 2026). The server decides every line (costquest-backend
// app/warden_announcer.py, approved templates only); the phone fetches them,
// shows each in its place and may speak it. Nothing here writes a line.
//
//   GET /v1/warden/feed     signed; the lines for this player now. 404 = the
//                           feature is off: the phone goes silent.
//   GET /v1/warden/events/X an event's title, times, lives, run sheet and its
//                           rules line (the event rules card).
//
// Where a line goes:
//   ceremony card   opening, closing and results (full screen, once each)
//   strip           everything else on the map, under the top bar
//   fight           a 3D fight's intro and verdict ride in the fight's own
//                   setup (setup.warden), not the feed
// When it is spoken: on-device speech only, never during a question, never in
// a fight (the fight speaks its own intro and verdict), never on a call, never
// when muted. A line that mentions money is never shown or spoken, whatever
// the server said (belt and braces: the server's checks refuse them first).
//
// Pure: the client and the clock are passed in (tested in
// features/game/__tests__/announcer.test.ts). announcerRuntime.ts wires it.
import { GameError, type GameClient } from "./client.ts";
import { parseServerDate } from "./wire.ts";

export type AnnouncementDisplay = "strip" | "card" | "banner";

export type Announcement = {
  id: string;
  kind: string;
  scope: "global" | "region" | "event" | "game" | "player";
  line: string;
  display: AnnouncementDisplay;
  screens: string[];
  starts_at: string;
  expires_at: string;
  template_id?: string;
  template_version?: number;
  brain?: string;
  event_id?: string | null;
};

export type AnnouncerFeed = { server_now: string; next_since: string; announcements: Announcement[] };

export type WardenEvent = {
  id: string;
  title: string;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  lives: number | null;
  rules_line: string | null;
  run_sheet: { rounds: { n: number; starts_at: string; ends_at: string }[]; lives: number; respawn_s: number; final_round: number } | null;
  server_now?: string;
};

/** Opening, closing and results: the full-screen ceremony card. */
export const CEREMONY_KINDS: ReadonlySet<string> = new Set([
  "calendar_open",
  "calendar_close",
  "season_open",
  "season_close",
  "game_live",
  "game_live_lives",
  "game_finished",
  "game_settled",
  "last_faction_standing",
  "final_round",
  "event_winner",
  "event_winner_number",
  "event_no_winner",
]);

/** Lines that belong to a fight or a question: never shown on the map, never spoken by the map. */
const NOT_ON_THE_MAP: ReadonlySet<string> = new Set(["proctor_handoff", "proctor_handoff_protected"]);

/** How often the feed is asked: the map once a minute, a live event every 5 s. */
export const POLL_MAP_MS = 60_000;
export const POLL_EVENT_MS = 5_000;
/** After a failure the wait doubles, up to 5 minutes. */
export const POLL_MAX_MS = 300_000;

// Money and promises never reach the screen or the voice (the server refuses
// them first; this is the phone's own guard).
const MONEY = /[$£€₦¥]|\b(prize|prizes|cash|money|earn|earns|earned|earning|earnings|odds|guarantee|guaranteed|payout|payouts|jackpot|winnings|bet|wager|coins?)\b/i;

/** The line as the phone may show and say it, or null when it must not. */
export function cleanLine(line: unknown): string | null {
  if (typeof line !== "string") return null;
  const text = line.replace(/\s+/g, " ").trim();
  if (!text || text.length > 220 || MONEY.test(text)) return null;
  return text;
}

/** Is the announcer on for this player (/v1/roam/me features.announcer)? */
export function announcerOn(me: { features?: Record<string, unknown> | null } | null | undefined): boolean {
  return me?.features?.announcer === true;
}

function parseAnnouncement(raw: unknown): Announcement | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  const line = cleanLine(a.line);
  if (typeof a.id !== "string" || typeof a.kind !== "string" || !line) return null;
  if (parseServerDate(a.starts_at as string) === null || parseServerDate(a.expires_at as string) === null) return null;
  const display = a.display === "strip" || a.display === "card" || a.display === "banner" ? a.display : "strip";
  return {
    id: a.id,
    kind: a.kind,
    scope: (a.scope as Announcement["scope"]) ?? "global",
    line,
    display,
    screens: Array.isArray(a.screens) ? a.screens.filter((s): s is string => typeof s === "string") : [],
    starts_at: a.starts_at as string,
    expires_at: a.expires_at as string,
    event_id: typeof a.event_id === "string" ? a.event_id : null,
  };
}

export function parseFeed(raw: unknown): AnnouncerFeed | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  if (typeof f.server_now !== "string" || !Array.isArray(f.announcements)) return null;
  return {
    server_now: f.server_now,
    next_since: typeof f.next_since === "string" ? f.next_since : f.server_now,
    announcements: f.announcements.map(parseAnnouncement).filter((a): a is Announcement => a !== null),
  };
}

/**
 * One ask of the feed. Null when the feature is off (404): the caller goes
 * silent. Other errors throw (the caller backs off).
 */
export async function fetchFeed(
  client: Pick<GameClient, "request" | "deviceKey">,
  opts: { since?: string | null; lat?: number | null; lng?: number | null; eventId?: string | null } = {},
): Promise<AnnouncerFeed | null> {
  const query: Record<string, string | number | undefined> = { device_key: client.deviceKey() };
  if (opts.since) query.since = opts.since;
  if (opts.lat != null && opts.lng != null) {
    query.lat = Math.round(opts.lat * 1e5) / 1e5;
    query.lng = Math.round(opts.lng * 1e5) / 1e5;
  }
  if (opts.eventId) query.event_id = opts.eventId;
  try {
    const raw = await client.request<unknown>("GET", "v1/warden/feed", { query, signed: true, timeoutMs: 8000 });
    const feed = parseFeed(raw);
    if (!feed) throw new GameError("decoding", "The server sent something unexpected.", 200);
    return feed;
  } catch (e) {
    if (e instanceof GameError && e.status === 404) return null;
    throw e;
  }
}

/** An event as the Warden runs it (the rules card). Null when off or unknown. */
export async function fetchWardenEvent(client: Pick<GameClient, "request">, eventId: string): Promise<WardenEvent | null> {
  try {
    const raw = await client.request<WardenEvent>("GET", `v1/warden/events/${encodeURIComponent(eventId)}`, { timeoutMs: 8000 });
    if (!raw || typeof raw !== "object" || typeof raw.id !== "string") return null;
    return { ...raw, rules_line: cleanLine(raw.rules_line), title: typeof raw.title === "string" ? raw.title : "" };
  } catch (e) {
    if (e instanceof GameError && e.status === 404) return null;
    throw e;
  }
}

/** The next wait: 5 s at a live event, a minute on the map, doubling after failures. */
export function pollDelayMs(ctx: { liveEvent: boolean; failures: number }): number {
  const base = ctx.liveEvent ? POLL_EVENT_MS : POLL_MAP_MS;
  if (ctx.failures <= 0) return base;
  return Math.min(POLL_MAX_MS, base * 2 ** Math.min(ctx.failures, 8));
}

// ---------- what is showing ----------

export type AnnouncerView = {
  /** The map's strip: the newest line for the map that is not a ceremony. */
  strip: Announcement | null;
  /** The next ceremony card not yet shown. */
  ceremony: Announcement | null;
};

/**
 * The lines the phone holds, by id, with the server's clock (the phone's may
 * be wrong). `ingest` adds a feed's lines; nothing is ever shown twice.
 */
export class AnnouncerBook {
  private items = new Map<string, Announcement>();
  private order: string[] = [];
  private shown = new Set<string>();
  private spoken = new Set<string>();
  /** Server time minus phone time, ms. */
  skewMs = 0;
  since: string | null = null;

  ingest(feed: AnnouncerFeed, phoneNow: number): Announcement[] {
    const server = parseServerDate(feed.server_now);
    if (server !== null) this.skewMs = server - phoneNow;
    this.since = feed.next_since;
    const fresh: Announcement[] = [];
    for (const a of feed.announcements) {
      if (this.items.has(a.id)) continue;
      this.items.set(a.id, a);
      this.order.push(a.id);
      fresh.push(a);
    }
    return fresh;
  }

  /** Withdraw a line (the venue socket's announce_cancel). */
  cancel(id: string): void {
    this.items.delete(id);
    this.order = this.order.filter((x) => x !== id);
  }

  /** Lines live now by the server's clock, oldest first. */
  live(phoneNow: number): Announcement[] {
    const now = phoneNow + this.skewMs;
    const out: Announcement[] = [];
    for (const id of this.order) {
      const a = this.items.get(id);
      if (!a) continue;
      const start = parseServerDate(a.starts_at) ?? 0;
      const end = parseServerDate(a.expires_at) ?? 0;
      if (start <= now && now < end) out.push(a);
    }
    return out;
  }

  /** Forget lines long expired, so a long session does not grow without end. */
  prune(phoneNow: number): void {
    const now = phoneNow + this.skewMs;
    for (const id of [...this.order]) {
      const a = this.items.get(id);
      if (a && (parseServerDate(a.expires_at) ?? 0) < now - 3_600_000) this.cancel(id);
    }
  }

  view(phoneNow: number, opts: { eventId?: string | null } = {}): AnnouncerView {
    const live = this.live(phoneNow);
    const ceremony = live.find((a) => CEREMONY_KINDS.has(a.kind) && !this.shown.has(a.id)) ?? null;
    let strip: Announcement | null = null;
    for (const a of live) {
      if (CEREMONY_KINDS.has(a.kind) || NOT_ON_THE_MAP.has(a.kind)) continue;
      const here = a.screens.length === 0 || a.screens.includes("map") || (opts.eventId != null && a.event_id === opts.eventId);
      if (here) strip = a; // the newest wins
    }
    return { strip, ceremony };
  }

  markShown(id: string): void {
    this.shown.add(id);
  }

  /** True once per line: the caller speaks it now. */
  takeSpeech(id: string): boolean {
    if (this.spoken.has(id)) return false;
    this.spoken.add(id);
    return true;
  }
}

// ---------- speech ----------

export type SpeechContext = {
  /** A question is on screen (a point's challenge, a chest, a rite, a Proctor round). */
  inQuestion: boolean;
  /** A fight is on screen (the fight speaks its own intro and verdict). */
  inFight: boolean;
  muted: boolean;
  onCall: boolean;
  /** The game page is the one showing. */
  onScreen: boolean;
};

/** May the map's voice say this line now? */
export function maySpeak(a: Pick<Announcement, "kind" | "line">, ctx: SpeechContext): boolean {
  if (ctx.inQuestion || ctx.inFight || ctx.muted || ctx.onCall || !ctx.onScreen) return false;
  if (NOT_ON_THE_MAP.has(a.kind)) return false;
  return cleanLine(a.line) !== null;
}

/** May a fight's own line (intro, verdict) be said? Only in the fight, never during a question. */
export function maySpeakFightLine(line: string | null | undefined, ctx: Omit<SpeechContext, "inFight">): boolean {
  if (ctx.inQuestion || ctx.muted || ctx.onCall || !ctx.onScreen) return false;
  return cleanLine(line) !== null;
}

// ---------- the fight's lines (setup.warden on a 3D duel start) ----------

export type FightLines = { intro: string | null; win: string | null; loss: string | null };

/** The Warden's lines for a 3D fight from its setup, or null when the server sent none. */
export function fightLinesOf(setup: unknown): FightLines | null {
  const w = (setup as { warden?: unknown } | null | undefined)?.warden;
  if (!w || typeof w !== "object") return null;
  const r = w as Record<string, unknown>;
  const out = { intro: cleanLine(r.intro), win: cleanLine(r.win), loss: cleanLine(r.loss) };
  return out.intro || out.win || out.loss ? out : null;
}

// ---------- the event rules card ----------

/** "2:05", "14:59", "1 h 04 min", "2 days": the time to an event's start. */
export function countdownText(targetMs: number, nowMs: number): string {
  const s = Math.max(0, Math.floor((targetMs - nowMs) / 1000));
  if (s >= 2 * 86400) return `${Math.floor(s / 86400)} days`;
  if (s >= 3600) return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")} min`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export type RulesCard = {
  title: string;
  /** "Starts in 9:59", "Live now", "Over". */
  status: string;
  /** Milliseconds to the start (null once started or unknown). */
  startsInMs: number | null;
  rules: string[];
};

/** The event rules card from the Warden's event view, at the server's time. */
export function rulesCard(ev: WardenEvent, phoneNow: number, skewMs = 0): RulesCard {
  const now = phoneNow + skewMs;
  const start = parseServerDate(ev.starts_at);
  const rules: string[] = [];
  if (ev.rules_line) rules.push(ev.rules_line);
  else if (ev.lives) rules.push(`${ev.lives} lives each.`);
  let status: string;
  let startsInMs: number | null = null;
  if (ev.status === "live") status = "Live now";
  else if (ev.status === "finished" || ev.status === "settled") status = "Over";
  else if (ev.status === "cancelled") status = "Cancelled";
  else if (start !== null && start > now) {
    startsInMs = start - now;
    status = `Starts in ${countdownText(start, now)}`;
  } else status = "Starting";
  return { title: ev.title, status, startsInMs, rules };
}
