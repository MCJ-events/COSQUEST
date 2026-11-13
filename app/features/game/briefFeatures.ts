// What Wale's build brief still lacked after 9 Nov, on the app side (13 Nov 2026):
//   referrals         a personal code and link, redeem a friend's code
//   venue challenges  carnival and costume booths at a CosQuest event: the station's QR code,
//                     an optional photo, then event staff approve it on their own phone
//   comic puzzles     put 3 to 5 comic panels in story order against the clock, at a puzzle station
//
// Against costquest-backend (branch brief-features-20261113, BRIEF-FEATURES.md):
//   GET  /v1/brief/flags                                   every Build Brief flag, public
//   GET  /v1/referrals/me, POST /v1/referrals/redeem
//   GET  /v1/events/{gid}/stations[/mine], POST .../checkin, .../stations/{sid}/photo|complete|puzzle|puzzle/submit
//   POST /v1/events/{gid}/staff/join, GET .../staff/queue, POST .../staff/completions/{cid}/verify
//   GET  /v1/venue/staff/events
//
// Every feature is off on the server until an operator names it, and a route of a feature that is
// off answers 404. The screens ask /v1/brief/flags first and show nothing new while a flag is off.
// The server judges everything (codes, distances, puzzle answers, rewards); this file only asks and
// shapes the answers. Words: the currency is "Costcoin" (the payment brief's spelling).
//
// Pure: the client is injected (tested in features/game/__tests__/briefFeatures.test.ts).
import { type GameClient, GameError } from "./client.ts";

// ---------- flags ----------

export type BriefFlags = {
  stations_v2: boolean;
  venue_challenges: boolean;
  comic_puzzles: boolean;
  referrals: boolean;
  event_friends: boolean;
  seasons: boolean;
  faction_switch_v2: boolean;
};

export const FLAGS_OFF: BriefFlags = {
  stations_v2: false,
  venue_challenges: false,
  comic_puzzles: false,
  referrals: false,
  event_friends: false,
  seasons: false,
  faction_switch_v2: false,
};

/** The flags out of the server's answer; anything missing or not `true` is off. */
export function parseFlags(raw: unknown): BriefFlags {
  const f = raw && typeof raw === "object" ? (raw as { flags?: unknown }).flags : null;
  const o = f && typeof f === "object" ? (f as Record<string, unknown>) : {};
  const out = { ...FLAGS_OFF };
  for (const k of Object.keys(out) as (keyof BriefFlags)[]) out[k] = o[k] === true;
  return out;
}

/** GET /v1/brief/flags. A server without the route (404) has every flag off. */
export async function fetchBriefFlags(client: GameClient): Promise<BriefFlags> {
  try {
    return parseFlags(await client.retrying(() => client.request<unknown>("GET", "v1/brief/flags")));
  } catch (e) {
    if (e instanceof GameError && e.status === 404) return { ...FLAGS_OFF };
    throw e;
  }
}

/** The Invite screen (feature `referrals`). */
export const showReferrals = (f: BriefFlags | null | undefined) => !!f?.referrals;
/** The Events screen and its stations (typed stations, `stations_v2`). */
export const showEvents = (f: BriefFlags | null | undefined) => !!f?.stations_v2;
/** Carnival and costume booths with a code, a photo and staff (needs stations too). */
export const showVenueChallenges = (f: BriefFlags | null | undefined) => !!f?.stations_v2 && !!f?.venue_challenges;
/** Comic panel puzzle stations (needs stations too). */
export const showPuzzles = (f: BriefFlags | null | undefined) => !!f?.stations_v2 && !!f?.comic_puzzles;

/**
 * The flags, asked at most once a minute (they change by an operator's hand, not by the second).
 * A failed ask keeps the last answer, or all off when there is none: a screen never shows a feature
 * because the network failed.
 */
export function createFlagCache(load: () => Promise<BriefFlags>, ttlMs = 60_000, now: () => number = Date.now) {
  let value: BriefFlags | null = null;
  let at = -Infinity;
  let inflight: Promise<BriefFlags> | null = null;
  return {
    peek(): BriefFlags | null {
      return value;
    },
    async get(force = false): Promise<BriefFlags> {
      if (!force && value && now() - at < ttlMs) return value;
      if (inflight) return inflight;
      inflight = (async () => {
        try {
          value = await load();
          at = now();
        } catch {
          value = value ?? { ...FLAGS_OFF };
        } finally {
          inflight = null;
        }
        return value as BriefFlags;
      })();
      return inflight;
    },
    clear() {
      value = null;
      at = -Infinity;
    },
  };
}

// ---------- referrals ----------

export type RewardKind = "none" | "costcoin" | "cosmetic";

export type ReferralReward = {
  kind: RewardKind | string;
  costcoin?: number | null;
  cosmetic_id?: string | null;
  cosmetic_name?: string | null;
};

export type ReferralStatus = "pending" | "rewarded" | "unrewarded" | "void" | string;

export type Recruit = { handle: string; status: ReferralStatus; redeemed_at?: string | null; qualified_at?: string | null };

export type ReferralMe = {
  code: string;
  link: string;
  share_text: string;
  reward: ReferralReward | null;
  referee_reward?: ReferralReward | null;
  counts?: Partial<Record<"pending" | "rewarded" | "unrewarded" | "void", number>> | null;
  cap?: { total?: number | null; per_day?: number | null } | null;
  referred_by?: { code: string; handle?: string | null; status: ReferralStatus } | null;
  can_redeem: boolean;
  redeem_until?: string | null;
  recruits?: Recruit[] | null;
};

export type RedeemResult = { status: ReferralStatus; referrer_handle?: string | null; qualify?: string | null };

/** Your code, your link and who joined with it (feature `referrals`). Signed: read scope. */
export async function fetchReferralMe(client: GameClient): Promise<ReferralMe> {
  const key = client.deviceKey();
  return client.retrying(() => client.request<ReferralMe>("GET", "v1/referrals/me", { query: { device_key: key }, signed: true }));
}

/** Use a friend's code. `installId` is the phone's vendor id (the server keeps only a salted hash). */
export async function redeemReferral(client: GameClient, code: string, installId: string | null): Promise<RedeemResult> {
  const body: Record<string, unknown> = { device_key: client.deviceKey(), code: normaliseReferralCode(code) };
  if (installId) body.install_id = installId;
  return client.request<RedeemResult>("POST", "v1/referrals/redeem", { body, signed: true });
}

/** What a code field holds: capitals and digits, twelve at most. */
export function normaliseReferralCode(input: string | null | undefined): string {
  return (input ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
}

/** "50 Costcoin" or the cosmetic's name; null when there is no reward (nothing is said about it then). */
export function rewardText(r: ReferralReward | null | undefined): string | null {
  if (!r) return null;
  if (r.kind === "costcoin" && typeof r.costcoin === "number" && r.costcoin > 0) return `${Math.round(r.costcoin).toLocaleString("en-US")} Costcoin`;
  if (r.kind === "cosmetic" && (r.cosmetic_name || r.cosmetic_id)) return String(r.cosmetic_name || r.cosmetic_id);
  return null;
}

/** The line under your code, or null when the reward is none. */
export function rewardLine(me: Pick<ReferralMe, "reward" | "referee_reward"> | null | undefined): string | null {
  const mine = rewardText(me?.reward);
  if (!mine) return null;
  const theirs = rewardText(me?.referee_reward);
  return theirs
    ? `When a friend you invite finishes their first quest, you get ${mine} and they get ${theirs}.`
    : `When a friend you invite finishes their first quest, you get ${mine}.`;
}

export function referralStatusText(s: ReferralStatus): string {
  switch (s) {
    case "pending":
      return "Joined, first quest to go";
    case "rewarded":
      return "First quest done";
    case "unrewarded":
      return "First quest done";
    case "void":
      return "Not counted";
    default:
      return String(s);
  }
}

const REDEEM_REASONS: Record<string, string> = {
  unknown_code: "That code isn't anyone's. Check it and try again.",
  own_code: "That's your own code. Ask a friend for theirs.",
  already_referred: "You've already used a friend's code.",
  too_late: "Codes can only be used in your first days of playing.",
  device_used: "A code has already been used on this phone.",
  install_id_required: "Codes can only be used in the app on a phone.",
};

/** A sentence for a refused redeem. */
export function redeemErrorText(e: unknown): string {
  if (e instanceof GameError) {
    if (e.kind === "network") return "Can't reach CosQuest right now.";
    const reason = typeof e.detail?.reason === "string" ? (e.detail.reason as string) : e.message;
    return REDEEM_REASONS[reason] ?? (reason && !/^The server returned/.test(reason) ? reason : "That didn't work. Try again.");
  }
  return "That didn't work. Try again.";
}

// ---------- events and stations ----------

export type StationType = "gps" | "carnival" | "puzzle" | "costume" | "boss" | string;
export type Need = "off" | "optional" | "required";

export type Station = {
  id: string;
  lat: number;
  lng: number;
  station_type: StationType;
  name: string;
  radius_m: number;
  xp: number;
  quest_points: number;
  verify: "location" | "manual" | "puzzle" | string;
  instructions?: string | null;
  qr?: Need | string | null;
  photo?: Need | string | null;
  staff_verified?: boolean | null;
  puzzle?: boolean | null;
};

export type CompletionStatus = "verified" | "pending" | "rejected";

export type MyCompletion = {
  station_id: string;
  station_type?: StationType;
  status: CompletionStatus | string;
  claim_code?: string | null;
  xp?: number | null;
  quest_points?: number | null;
  attempts?: number | null;
  can_retry?: boolean | null;
  submitted_at?: string | null;
  verified_at?: string | null;
  note?: string | null;
};

export type CompleteResult = {
  id?: number | string;
  station_id?: string;
  station_type?: StationType;
  status: CompletionStatus | string;
  xp: number;
  quest_points: number;
  claim_code?: string | null;
  attempts?: number | null;
  repeat?: boolean;
  verify?: string;
};

export type CheckinResult = { checked_in: boolean; already: boolean; game_id: string; title?: string | null; at?: string | null };

export type Spot = { lat: number; lng: number; accuracy_m: number };

const ev = (gid: string, rest = "") => `v1/events/${encodeURIComponent(gid)}${rest}`;
const st = (gid: string, sid: string, rest = "") => ev(gid, `/stations/${encodeURIComponent(sid)}${rest}`);

/** The event's stations (public). Off (404) is an empty list. */
export async function fetchStations(client: GameClient, gameId: string): Promise<Station[]> {
  const got = await client.retrying(() => client.request<{ stations?: Station[] | null }>("GET", ev(gameId, "/stations")));
  return Array.isArray(got.stations) ? got.stations : [];
}

/** Your completions at this event: pending ones carry the claim code to show staff. Signed: read scope. */
export async function fetchMyStations(client: GameClient, gameId: string): Promise<MyCompletion[]> {
  const key = client.deviceKey();
  const got = await client.retrying(() =>
    client.request<{ completions?: MyCompletion[] | null }>("GET", ev(gameId, "/stations/mine"), { query: { device_key: key }, signed: true }),
  );
  return Array.isArray(got.completions) ? got.completions : [];
}

/** Check in at a live event you joined, from inside the venue. */
export async function checkIn(client: GameClient, gameId: string, at: Spot): Promise<CheckinResult> {
  return client.request<CheckinResult>("POST", ev(gameId, "/checkin"), { body: { device_key: client.deviceKey(), ...at }, signed: true });
}

/** A JPEG for a station that takes a photo; answers the id to send with the completion. */
export async function uploadStationPhoto(client: GameClient, gameId: string, stationId: string, imageB64: string): Promise<{ photo_id: string }> {
  return client.request<{ photo_id: string }>("POST", st(gameId, stationId, "/photo"), {
    body: { device_key: client.deviceKey(), image_b64: imageB64, mime: "image/jpeg" },
    signed: true,
    timeoutMs: 45_000,
  });
}

/** Done at a station: from inside its radius, with the booth's code and the photo when it takes them. */
export async function completeStation(
  client: GameClient,
  gameId: string,
  stationId: string,
  at: Spot,
  extra: { stationCode?: string | null; photoId?: string | null } = {},
): Promise<CompleteResult> {
  const body: Record<string, unknown> = { device_key: client.deviceKey(), ...at };
  const code = normaliseStationCode(extra.stationCode);
  if (code) body.station_code = code;
  if (extra.photoId) body.photo_id = extra.photoId;
  return client.request<CompleteResult>("POST", st(gameId, stationId, "/complete"), { body, signed: true });
}

/** A booth's code as typed: capitals and digits, eight at most (the printed code is six). */
export function normaliseStationCode(input: string | null | undefined): string {
  return (input ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

/** What the server says is missing ("station_code" or "photo"), from a refusal. */
export function needFrom(e: unknown): "station_code" | "photo" | null {
  if (!(e instanceof GameError)) return null;
  const need = e.detail?.need;
  return need === "station_code" || need === "photo" ? need : null;
}

export const STATION_LABEL: Record<string, string> = {
  gps: "Check-in point",
  carnival: "Carnival challenge",
  puzzle: "Comic panel puzzle",
  costume: "Costume check",
  boss: "Boss encounter",
};

export function stationLabel(type: StationType): string {
  return STATION_LABEL[type] ?? String(type);
}

/** Where a station stands for you, which decides what its screen shows. */
export type StationStep = "start" | "pending" | "done" | "retry" | "rejected";

export function stationStep(c: MyCompletion | null | undefined): StationStep {
  if (!c) return "start";
  if (c.status === "verified") return "done";
  if (c.status === "pending") return "pending";
  if (c.status === "rejected") return c.can_retry ? "retry" : "rejected";
  return "start";
}

/** The short status chip on a station row. */
export function stepText(step: StationStep): string {
  switch (step) {
    case "done":
      return "DONE";
    case "pending":
      return "WITH STAFF";
    case "retry":
      return "TRY AGAIN";
    case "rejected":
      return "NOT ACCEPTED";
    default:
      return "";
  }
}

/** Whether this station is played through the station flow (code, photo, staff) rather than at once. */
export function isStaffStation(s: Station): boolean {
  return s.staff_verified === true || s.verify === "manual";
}

export function isPuzzleStation(s: Station): boolean {
  return s.puzzle === true || s.verify === "puzzle";
}

export function wantsCode(s: Station): boolean {
  return s.qr === "optional" || s.qr === "required";
}

export function wantsPhoto(s: Station): boolean {
  return s.photo === "optional" || s.photo === "required";
}

/** Largest photo the server takes (600 KB decoded), and the size of a base64 string decoded. */
export const PHOTO_MAX_BYTES = 600 * 1024;

export function base64Bytes(b64: string): number {
  const s = b64.replace(/\s+/g, "");
  const pad = s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0;
  return Math.floor((s.length * 3) / 4) - pad;
}

export function photoFits(b64: string): boolean {
  return base64Bytes(b64) <= PHOTO_MAX_BYTES;
}

/** A station refusal as a sentence (the server's own reason when it gave one). */
export function stationErrorText(e: unknown): string {
  if (e instanceof GameError) {
    if (e.kind === "network") return "Can't reach CosQuest right now.";
    if (e.kind === "not_signed_in") return e.message;
    const reason = typeof e.detail?.reason === "string" ? (e.detail.reason as string) : e.message;
    if (reason === "completed already" || reason === "completed") return "You've done this one.";
    if (reason === "Not Found" || /^The server returned/.test(reason)) return "This isn't open right now.";
    return reason;
  }
  return "Something went wrong. Try again.";
}

// ---------- staff ----------

export type StaffEvent = { game_id: string; title: string; status: string; starts_at?: string | null; ends_at?: string | null; pending: number };

export type QueueItem = {
  id: number | string;
  claim_code: string;
  handle: string;
  station_id: string;
  station_name: string;
  station_type: StationType;
  status: CompletionStatus | string;
  submitted_at: string;
  attempts?: number | null;
  qr_ok?: boolean | null;
  distance_m?: number | null;
  photo_url?: string | null;
};

export type BoothCode = { id: string; name: string; station_type: StationType; code: string; qr_text: string };

export type StaffQueue = { game_id: string; title: string; completions: QueueItem[]; stations: BoothCode[] };

/** Become staff at an event with the code its organiser gave you. */
export async function joinStaff(client: GameClient, gameId: string, code: string): Promise<{ staff: boolean; game_id: string; title?: string | null }> {
  return client.request("POST", ev(gameId, "/staff/join"), { body: { device_key: client.deviceKey(), code: normaliseStationCode(code) }, signed: true });
}

/** The events you are staff at. Off (404) is none. */
export async function fetchStaffEvents(client: GameClient): Promise<StaffEvent[]> {
  const key = client.deviceKey();
  try {
    const got = await client.retrying(() => client.request<{ events?: StaffEvent[] | null }>("GET", "v1/venue/staff/events", { query: { device_key: key }, signed: true }));
    return Array.isArray(got.events) ? got.events : [];
  } catch (e) {
    if (e instanceof GameError && e.status === 404) return [];
    throw e;
  }
}

/** The staff queue (pending by default) and the booths' codes. 403 `not_staff` when you are not. */
export async function fetchStaffQueue(client: GameClient, gameId: string, status: CompletionStatus = "pending"): Promise<StaffQueue> {
  const key = client.deviceKey();
  const got = await client.retrying(() =>
    client.request<StaffQueue>("GET", ev(gameId, "/staff/queue"), { query: { device_key: key, status }, signed: true }),
  );
  return { ...got, completions: Array.isArray(got.completions) ? got.completions : [], stations: Array.isArray(got.stations) ? got.stations : [] };
}

/** Approve (pays the player) or reject a challenge. */
export async function decideCompletion(client: GameClient, gameId: string, completionId: number | string, approve: boolean, note?: string | null): Promise<CompleteResult> {
  const body: Record<string, unknown> = { device_key: client.deviceKey(), approve };
  const n = (note ?? "").trim();
  if (n) body.note = n.slice(0, 500);
  return client.request<CompleteResult>("POST", ev(gameId, `/staff/completions/${encodeURIComponent(String(completionId))}/verify`), { body, signed: true });
}

export function isNotStaff(e: unknown): boolean {
  return e instanceof GameError && e.status === 403 && (e.detail?.reason === "not_staff" || e.message === "not_staff");
}

/** A photo link from the server: absolute as sent, or made absolute against the game server. */
export function photoUri(baseUrl: string, url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${baseUrl.replace(/\/+$/, "")}/${url.replace(/^\/+/, "")}`;
}

// ---------- comic panel puzzles ----------

export type Panel = { idx: number; caption: string; alt?: string | null; image_url?: string | null };

export type PuzzlePaper = {
  test_id: string;
  expires_at: string;
  time_limit_s: number;
  resumed?: boolean;
  puzzle: { title?: string | null; prompt?: string | null; panels: Panel[] };
};

export type PuzzleVerdict = {
  passed: boolean;
  outcome: "submitted" | "timeout" | string;
  solution?: number[] | null;
  retry_at?: string | null;
  completion?: { status: string; xp: number; quest_points: number } | null;
};

/** Open (or resume) the puzzle at a station, from inside its radius. */
export async function startPuzzle(client: GameClient, gameId: string, stationId: string, at: Spot): Promise<PuzzlePaper> {
  const got = await client.request<PuzzlePaper>("POST", st(gameId, stationId, "/puzzle"), { body: { device_key: client.deviceKey(), ...at }, signed: true });
  const panels = Array.isArray(got.puzzle?.panels) ? got.puzzle.panels : [];
  return { ...got, puzzle: { ...got.puzzle, panels } };
}

/** Send the panels in the order you put them (their shown idx, first to last). */
export async function submitPuzzle(client: GameClient, gameId: string, stationId: string, testId: string, order: number[]): Promise<PuzzleVerdict> {
  return client.request<PuzzleVerdict>("POST", st(gameId, stationId, "/puzzle/submit"), {
    body: { device_key: client.deviceKey(), test_id: testId, order },
    signed: true,
  });
}

/**
 * A tap on a panel: unplaced, it takes the next number; placed, it comes off and the ones placed
 * after it move up one, so the numbers always run 1, 2, 3 with no gaps.
 */
export function tapPanel(order: readonly number[], idx: number): number[] {
  return order.includes(idx) ? order.filter((i) => i !== idx) : [...order, idx];
}

/** The number on a panel's badge (1-based), or null when it is not placed. */
export function badgeFor(order: readonly number[], idx: number): number | null {
  const at = order.indexOf(idx);
  return at < 0 ? null : at + 1;
}

/** Every panel placed, each once: ready to send. */
export function orderComplete(order: readonly number[], panels: readonly Panel[]): boolean {
  if (order.length !== panels.length) return false;
  const ids = new Set(panels.map((p) => p.idx));
  return new Set(order).size === order.length && order.every((i) => ids.has(i));
}

/** The panels in the story's order, for showing the answer after a miss. Unknown idx are skipped. */
export function panelsInOrder(panels: readonly Panel[], order: readonly number[] | null | undefined): Panel[] {
  const by = new Map(panels.map((p) => [p.idx, p]));
  return (order ?? []).map((i) => by.get(i)).filter((p): p is Panel => !!p);
}

/** Whole seconds until `iso`, never below zero (an unreadable date is zero). */
export function secondsUntil(iso: string | null | undefined, now: number = Date.now()): number {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.ceil((t - now) / 1000));
}

/** "1:05", "0:09". */
export function clockText(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "Try again in 1 min" style wait, or null when you can now. */
export function waitText(retryAt: string | null | undefined, now: number = Date.now()): string | null {
  const s = secondsUntil(retryAt, now);
  if (s <= 0) return null;
  if (s < 60) return `Try again in ${s} s`;
  if (s < 3600) return `Try again in ${Math.ceil(s / 60)} min`;
  return `Try again in ${Math.ceil(s / 3600)} h`;
}

/** The wait the server named in a refusal (429 cooldown or daily limit). */
export function retryAtFrom(e: unknown): string | null {
  return e instanceof GameError && typeof e.detail?.retry_at === "string" ? (e.detail.retry_at as string) : null;
}

// ---------- links ----------

/** Query params of a URL, without depending on the URL global's quirks. */
function queryOf(url: string): URLSearchParams {
  const q = url.indexOf("?");
  if (q < 0) return new URLSearchParams();
  const hash = url.indexOf("#", q);
  return new URLSearchParams(url.slice(q + 1, hash < 0 ? undefined : hash));
}

/** The path segments of a cosquest:// or http(s) URL, or a bare path. */
function segmentsOf(url: string): string[] {
  let rest = url.trim();
  const scheme = rest.match(/^[a-z][a-z0-9+.-]*:\/\//i);
  if (scheme) {
    rest = rest.slice(scheme[0].length);
    if (!/^cosquest:/i.test(scheme[0])) {
      const slash = rest.indexOf("/");
      rest = slash < 0 ? "" : rest.slice(slash);
    }
  }
  return rest
    .split(/[?#]/)[0]
    .split("/")
    .filter(Boolean)
    .filter((p) => p !== "--");
}

const UUIDISH = /^[A-Za-z0-9-]{8,64}$/;

/**
 * A friend's code from a link: cosquest://referral?code=CODE, cosquest://referral/CODE, or the
 * server's page https://<host>/r/CODE. Null for anything else.
 */
export function referralCodeFromLink(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  const seg = segmentsOf(url);
  const head = (seg[0] ?? "").toLowerCase();
  let raw: string | null = null;
  if ((head === "referral" || head === "invite-code") && seg.length === 1) raw = queryOf(url).get("code");
  else if (head === "referral" && seg.length === 2) raw = seg[1];
  else if (head === "r" && seg.length === 2 && /^https?:/i.test(url.trim())) raw = seg[1];
  if (!raw) return null;
  const code = normaliseReferralCode(raw);
  return code.length >= 4 ? code : null;
}

export type StationLink = { game: string; station: string | null; code: string | null };

/**
 * An event station from a link (the booth's QR): cosquest://station?game=<id>&station=<id>&code=<code>.
 * Also cosquest://event?game=<id> (the event, no station). Null when the game is missing or malformed.
 */
export function stationFromLink(url: string | null | undefined): StationLink | null {
  if (!url || typeof url !== "string") return null;
  const seg = segmentsOf(url);
  const head = (seg[0] ?? "").toLowerCase();
  if (seg.length !== 1 || (head !== "station" && head !== "event")) return null;
  const q = queryOf(url);
  const game = q.get("game") ?? q.get("g");
  if (!game || !UUIDISH.test(game)) return null;
  if (head === "event") return { game, station: null, code: null };
  const station = q.get("station") ?? q.get("s");
  if (station !== null && !UUIDISH.test(station)) return null;
  const code = normaliseStationCode(q.get("code") ?? q.get("c"));
  return { game, station: station ?? null, code: code || null };
}

/** Where such a link opens in the app (features/world/links.ts calls this), or null. */
export function routeForBriefLink(url: string | null | undefined): string | null {
  const code = referralCodeFromLink(url);
  if (code) return `/wale/invite?code=${encodeURIComponent(code)}`;
  const s = stationFromLink(url);
  if (!s) return null;
  if (!s.station) return `/wale/event?game=${encodeURIComponent(s.game)}`;
  const parts = [`game=${encodeURIComponent(s.game)}`, `station=${encodeURIComponent(s.station)}`];
  if (s.code) parts.push(`code=${encodeURIComponent(s.code)}`);
  return `/wale/challenge?${parts.join("&")}`;
}
