// The Guardian Duel's flow, the pure half (costquest-ios Features/DuelFeature.swift:
// DuelView, DuelSFX, VersusCard, DuelResultView, DuelModes; BattlePauseView.swift).
// Everything the screens decide in words and numbers lives here so it can be
// tested under `node --test`; components/game/DuelScreen.tsx only draws it.
//
// Pure: no React Native. Siblings are imported with the .ts extension.
import { GameError, type GameClient } from "./client.ts";
import { resolveDuelRenderer, resolveIslandsOff } from "./config.ts";
import { DuelEventType } from "./duel/types.ts";
import { type SiegeReward, siegeDrop } from "./siege.ts";
import type { DuelFighterPeek, DuelFinished, DuelOutcome, DuelPay, DuelStart, QuestPoint, RoamExtra } from "./wire.ts";

// ---------------------------------------------------------------------
// Modes and copy
// ---------------------------------------------------------------------

/** Which /v1/duel/start mode a screen asks for (DuelRequest: .point, .raid, .siege). */
export type DuelMode = "point" | "raid" | "siege";

/** The `raid` boolean the screen has always taken, and the new `mode`: mode wins. */
export function duelModeOf(mode: DuelMode | undefined, raid: boolean | undefined): DuelMode {
  return mode ?? (raid ? "raid" : "point");
}

/**
 * A Siege fought as a duel: mode "siege" of /v1/duel/start, target the point
 * (DuelModel.start .siege). Needs a fix, as the server judges reach.
 */
export async function siegeDuelStart(
  client: Pick<GameClient, "duelStart">,
  point: Pick<QuestPoint, "id">,
  fix: { lat: number; lng: number; accuracy: number } | null,
): Promise<DuelStart> {
  if (!fix) throw new GameError("http", "Waiting for your location.");
  return client.duelStart({ mode: "siege", target: point.id, lat: fix.lat, lng: fix.lng, accuracy_m: fix.accuracy });
}

/** DuelModes.difficulty: the Guardian is below, level with or above you. */
export function duelDifficulty(tier: string): string {
  return tier === "epic" ? "Hard" : tier === "rare" ? "Even" : "Easy";
}

/** DuelModes.guardian: the Guardian a point announces, or a fair name for one. */
export function guardianName(p: Pick<QuestPoint, "name" | "extra">): string {
  const g = p.extra?.guardian;
  return g ? g : `Keeper of ${p.name}`;
}

export function weaponName(w: string | null | undefined): string {
  switch (w) {
    case "fists":
      return "Fists";
    case "polearm":
      return "Polearm";
    case "blaster":
      return "Blaster";
    case "arcane":
      return "Arcane";
    default:
      return "Blade";
  }
}

export function stanceName(id: string | null | undefined): string {
  switch (id) {
    case "aggressive":
      return "Aggressive";
    case "counter":
      return "Counter";
    case "turtle":
      return "Turtle";
    default:
      return "Default";
  }
}

/** The blocks a start carries beside (or inside) its setup (DuelStart.init(from:)). */
export type DuelStartExtras = {
  siege?: { siege_id?: string | null; point_id?: string | null; point_name?: string | null; faction_attacked?: string | null; faction_attacked_name?: string | null } | null;
  trial?: { faction: string; faction_name?: string | null; rung: number } | null;
  raid?: { raid_id?: string | null; boss_name?: string | null; hp_max?: number | null } | null;
};

function extrasOf(start: DuelStart): DuelStartExtras {
  const top = start as unknown as DuelStartExtras;
  const inner = (start.setup ?? {}) as DuelStartExtras;
  return { siege: top.siege ?? null, trial: top.trial ?? null, raid: top.raid ?? inner.raid ?? null };
}

/** The VS card's heading (VersusCard.title). */
export function versusTitle(start: DuelStart, factionName: (id: string) => string): string {
  const x = extrasOf(start);
  if (x.siege) return `Siege · ${x.siege.point_name ?? "Quest Point"}`;
  if (x.trial) return `Guardian Trials · ${x.trial.faction_name ?? factionName(x.trial.faction)} · rung ${x.trial.rung}`;
  if (x.raid) return `Boss raid · ${x.raid.boss_name ?? "The boss"}`;
  if (start.point) return `Duel · ${start.point.point_name ?? "Quest Point"}`;
  if (start.mode === "run") return "Quest Run · fight for the point";
  return "Duel";
}

/** VersusCard.subline: "Level 4 · Blade · Counter · Relic name". */
export function versusSubline(f: DuelFighterPeek): string {
  const parts = [`Level ${f.level ?? 1}`, weaponName(f.weapon_class)];
  if (f.ai?.stance) parts.push(stanceName(f.ai.stance));
  if (f.relic?.name) parts.push(f.relic.name);
  return parts.join(" · ");
}

/** The two fighters as the VS card reads them (the setup's p1 and p2). */
export function fightersOf(start: DuelStart): { p1: DuelFighterPeek; p2: DuelFighterPeek } | null {
  const p1 = start.setup?.p1;
  const p2 = start.setup?.p2;
  return p1 && typeof p1.name === "string" && p2 && typeof p2.name === "string" ? { p1, p2 } : null;
}

/** BattlePauseView's title: the Guardian, else the place, else a plain "The fight". */
export function pauseTitle(start: DuelStart | null | undefined): string {
  if (!start) return "The fight";
  const x = extrasOf(start);
  return start.point?.guardian ?? start.point?.point_name ?? x.siege?.point_name ?? "The fight";
}

/** The place under the pause title (BattlePauseView.place). */
export function pausePlace(start: DuelStart | null | undefined): string | null {
  if (!start) return null;
  return start.point?.point_name ?? extrasOf(start).siege?.point_name ?? null;
}

/** The pause page's controls help, for the 2D arena's gestures (BattlePauseView.controls, as this arena plays). */
export const DUEL_CONTROLS_2D: readonly { name: string; text: string }[] = [
  { name: "Move", text: "Drag anywhere to walk toward or away from the Guardian." },
  { name: "Attack", text: "Tap for a combo." },
  { name: "Dash", text: "Flick toward the Guardian to dash in with a lunge." },
  { name: "Dodge", text: "Flick away from the Guardian to roll back. Roll as a red glow fires for a perfect dodge." },
  { name: "Guard", text: "Hold to block. Keep holding to charge a heavy, let go to throw it." },
  { name: "Skills", text: "Tap Special or Ultimate once its bar is full. The bar fills from landed hits and blocks." },
];

/** BattlePauseView.controls, word for word: how the Unity scene is played. */
export const DUEL_CONTROLS_UNITY: readonly { name: string; text: string }[] = [
  { name: "Move", text: "Left thumb, anywhere on the left. Push to the rim to sprint." },
  { name: "Attack", text: "Tap for a combo. Hold to charge a spin. Attack while sprinting to lunge." },
  { name: "Dodge", text: "Flick on the right side to roll that way, or tap Dodge. Roll as a red area fires for a perfect dodge." },
  { name: "Guard", text: "Hold to block. Press it just as a hit lands to parry." },
  { name: "Skills", text: "Drag from a skill to aim, let go to cast. Ultimate fills from combos, parries and perfect dodges." },
];

// ---------------------------------------------------------------------
// Sound and haptics (DuelSFX)
// ---------------------------------------------------------------------

export type DuelSound = "fanfare" | "whoosh" | "hit" | "tap";
export type DuelHaptic = "success" | "error" | "heavy" | "medium" | "light";
export type DuelCue = { sound: DuelSound | null; haptic: DuelHaptic | null };

/**
 * DuelSFX.play: the scene's cue strings, by substring, onto the game's own
 * sounds and haptics. Unity sends them; the order matters (a "ko" or
 * "victory" beats everything, "heavy"/"break" beat "hit").
 */
export function cueFor(cue: string): DuelCue {
  const c = cue.toLowerCase();
  if (c.includes("ko") || c.includes("victory")) return { sound: "fanfare", haptic: "success" };
  if (c.includes("special")) return { sound: "whoosh", haptic: "heavy" };
  if (c.includes("heavy") || c.includes("break")) return { sound: "hit", haptic: "heavy" };
  if (c.includes("hit")) return { sound: "hit", haptic: "medium" };
  if (c.includes("block")) return { sound: "tap", haptic: "light" };
  if (c.includes("dash") || c.includes("dodge") || c.includes("swing") || c.includes("whoosh")) return { sound: "whoosh", haptic: null };
  if (c.includes("defeat")) return { sound: null, haptic: "error" };
  return { sound: "tap", haptic: null };
}

/** A hit's hit-stop beyond this many ticks is a heavy blow (the arena's shake threshold). */
export const HEAVY_HIT_STOP = 6;

/**
 * What the 2D sim's events play, at the moments Unity's cues do: a hit Medium
 * (Heavy when it is a heavy blow), a block Light, a guard break Heavy, a
 * special Heavy with a whoosh, a dash or dodge a whoosh, the K.O. the fanfare
 * and Success. Everything else is silent.
 */
export function cueForSimEvent(type: number, hitStop: number | undefined): DuelCue {
  switch (type) {
    case DuelEventType.Hit:
      return (hitStop ?? 0) > HEAVY_HIT_STOP ? cueFor("hit_heavy") : cueFor("hit");
    case DuelEventType.Blocked:
      return cueFor("block");
    case DuelEventType.GuardBreak:
      return cueFor("guard_break");
    case DuelEventType.SpecialStart:
      return cueFor("special");
    case DuelEventType.DashStart:
      return cueFor("dash");
    case DuelEventType.DodgeStart:
      return cueFor("dodge");
    case DuelEventType.KO:
      return cueFor("ko");
    default:
      return { sound: null, haptic: null };
  }
}

/** The haptic and sound the SERVER's verdict plays (DuelView.report): won Success + fanfare, lost Error, held nothing. */
export function verdictCue(status: string): DuelCue {
  if (status === "won") return { sound: "fanfare", haptic: "success" };
  if (status === "lost") return { sound: null, haptic: "error" };
  return { sound: null, haptic: null };
}

// ---------------------------------------------------------------------
// The result (DuelResultView)
// ---------------------------------------------------------------------

/** What a verdict may carry beyond wire.ts's DuelOutcome (DuelOutcome in DuelFeature.swift). */
export type DuelOutcomeFull = Omit<DuelOutcome, "reward"> & {
  reward?: SiegeReward | null;
  siege?: { point_name?: string | null } | null;
  trial?: { faction: string; faction_name?: string | null; rung: number; rungs?: number | null; name?: string | null; cleared?: number | null; first_clear?: boolean | null } | null;
  raid?: { damage?: number | null; hp_left?: number | null; hp_max?: number | null; defeated?: boolean | null; reward?: DuelPay | null } | null;
  run?: { earned?: number | null; speed_mult?: number | null; surged?: boolean | null; stake_result?: { won: boolean; stake: number } | null } | null;
};

export function asFull(o: DuelOutcome): DuelOutcomeFull {
  return o as unknown as DuelOutcomeFull;
}

export function resultTitle(status: string): string {
  return status === "won" ? "VICTORY" : status === "held" ? "CHECKING" : "DEFEAT";
}

/** DuelResultView.subtitle: the line under the title, by mode. */
export function resultSubtitle(o: DuelOutcomeFull, start: DuelStart | null | undefined, factionName: (id: string) => string): string | null {
  const won = o.status === "won";
  if (o.status === "held") return o.message ?? "This fight is being checked. If it was fair, it will count.";
  if (o.mode === "point") {
    const place = start?.point?.point_name ?? "this place";
    const guardian = start?.point?.guardian ?? "Its Guardian";
    return won ? `${guardian} is beaten. ${place} answers to your faction.` : `${guardian} holds ${place}. It rests for 10 minutes, then you can go again.`;
  }
  if (o.mode === "raid") {
    const boss = (start ? extrasOf(start).raid?.boss_name : null) ?? "The boss";
    if (o.raid?.defeated === true) return `${boss} is down. Everyone who landed a hit is paid.`;
    return `Every hit you landed counts toward the crew's. Bring ${boss} down before it leaves.`;
  }
  if (o.mode === "run") return won ? "Point taken at full value." : "The Guardian held, but every hit still scored.";
  const place = o.siege?.point_name;
  if (o.siege && place) {
    return won ? `${place} is yours. Your faction holds it now.` : `${place} stands. Its Guardian is on guard for 10 minutes.`;
  }
  const t = o.trial;
  if (t) {
    const name = t.faction_name ?? factionName(t.faction);
    const cleared = t.cleared ?? 0;
    const rungs = t.rungs ?? 8;
    if (won && (t.first_clear === false || !o.reward)) return `${name} Trials · rung ${t.rung} beaten again.`;
    return won ? `${name} Trials · ${cleared} of ${rungs} cleared.` : `${t.name ?? "The Guardian"} holds rung ${t.rung}. Study it and go again.`;
  }
  return null;
}

/** The fighter's HP as the card shows it: a share 0...1 and a whole percent. */
export function hpShare(hp: number, max: number): { share: number; percent: number } {
  const share = Math.max(0, hp) / Math.max(1, max);
  return { share, percent: Math.round(share * 100) };
}

/** DuelOutcome.pay: whatever this fight paid, from whichever part of the verdict carries it. */
export function payOf(o: DuelOutcomeFull): DuelPay | null {
  if (o.reward) return { xp: o.reward.xp ?? null, faction_points: o.reward.faction_points ?? null };
  return o.point?.reward ?? o.raid?.reward ?? null;
}

export function payIsEmpty(p: DuelPay | null | undefined): boolean {
  return !p || ((p.xp ?? 0) <= 0 && (p.faction_points ?? 0) <= 0);
}

/** The Relic drop, wherever the verdict put it (a siege's reward, else the point's extras). */
export function dropOf(o: DuelOutcomeFull): RoamExtra | null {
  const fromReward = siegeDrop(o.reward);
  if (fromReward?.relic) return fromReward;
  const fromPoint = o.point?.extras?.find((e) => e.kind === "relic") ?? null;
  return fromPoint?.relic ? fromPoint : null;
}

/** What features added to the fight, in words (not the Relic: it has its own card). */
export function extraLines(o: DuelOutcomeFull): string[] {
  return (o.point?.extras ?? o.reward?.extras ?? [])
    .filter((e) => e.kind !== "relic")
    .map((e) => [e.title, e.subtitle].filter((s): s is string => !!s).join(" · "));
}

export function backLabel(o: Pick<DuelOutcome, "mode">): string {
  return o.mode === "run" ? "Back to the run" : "Back to the map";
}

/** The banner the map shows after the player leaves the result (RoamHomeView's onDone handlers), or null. */
export function bannerAfter(o: DuelOutcomeFull | null | undefined, mode: DuelMode, pointName: string): { title: string; subtitle: string } | null {
  if (!o) return null;
  if (mode === "raid") return o.raid?.defeated === true ? { title: "Boss defeated!", subtitle: pointName } : null;
  if (o.status !== "won") return null;
  return mode === "siege" ? { title: "Taken!", subtitle: pointName } : { title: "Guardian beaten!", subtitle: pointName };
}

/** What the screen says out loud for a verdict (VoiceOver). */
export function verdictAnnouncement(o: DuelOutcomeFull, start: DuelStart | null | undefined, factionName: (id: string) => string): string {
  const sub = resultSubtitle(o, start, factionName);
  return sub ? `${resultTitle(o.status)}. ${sub}` : resultTitle(o.status);
}

// ---------------------------------------------------------------------
// Unity on the device
// ---------------------------------------------------------------------

export type UnityPieces = {
  /** CostQuestUnityView is non-null (the build has Unity). */
  hasView: boolean;
  /** nativeHelpers.unityStartDuel exists, and the module can emit onUnityEvent. */
  hasBridge: boolean;
};

/**
 * Which renderer draws this fight. Unity only when the build has all of it
 * (the view and the bridge), the build asks for it (EXPO_PUBLIC_DUEL_RENDERER=unity,
 * config.resolveDuelRenderer) and the island "unityDuel" is not turned off
 * (EXPO_PUBLIC_GAME_2D, config.resolveIslandsOff). Otherwise the 2D sim.
 */
export function chooseDuelRenderer(i: { rendererFlag: string | null | undefined; islandsOffRaw: string | null | undefined; unity: UnityPieces }): "unity" | "rn" {
  const hasUnity = i.unity.hasView && i.unity.hasBridge;
  if (resolveDuelRenderer(i.rendererFlag, hasUnity) !== "unity") return "rn";
  return resolveIslandsOff(i.islandsOffRaw).has("unityDuel") ? "rn" : "unity";
}

/**
 * The setup as the JSON text Unity reads, with the 62-bit seed exact: the
 * parsed `setup.seed` is a rounded double, so the digits (`seed_text`) are
 * spliced into the text and never go through a number. Throws on a seed that
 * is not whole digits.
 */
export function unitySetupJson(start: Pick<DuelStart, "setup" | "seed_text">): string {
  const digits = start.seed_text;
  if (typeof digits !== "string" || !/^-?\d+$/.test(digits)) throw new Error("The fight came without an exact seed.");
  const marker = "@@cq-seed-digits@@";
  const text = JSON.stringify({ ...start.setup, seed: marker });
  return text.replace(`"${marker}"`, digits);
}

/** What one Unity event means to the duel screen. */
export type UnityDuelAction =
  | { kind: "ready" }
  | { kind: "sfx"; cue: string }
  | { kind: "finished"; payload: DuelFinished | null }
  | { kind: "quit"; payload: DuelFinished | null };

const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The finish body Unity writes: {result, inputs: [[tick, code(, arg)]], hash}, or null if unreadable. */
export function parseFinished(json: string): DuelFinished | null {
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRec(v) || !isRec(v.result) || !Array.isArray(v.inputs) || typeof v.hash !== "string") return null;
  const r = v.result;
  if (!isInt(r.winner) || !isInt(r.ticks) || !isInt(r.p1_hp) || !isInt(r.p2_hp)) return null;
  const inputs: number[][] = [];
  for (const row of v.inputs) {
    if (!Array.isArray(row) || !row.every(isInt)) return null;
    inputs.push(row as number[]);
  }
  return { result: { winner: r.winner, ticks: r.ticks, p1_hp: r.p1_hp, p2_hp: r.p2_hp }, inputs, hash: v.hash };
}

/** A cue is sent bare ("hit_heavy") or as {"name": "..."} / {"cue": "..."}. */
export function parseCue(json: string): string {
  try {
    const v: unknown = JSON.parse(json);
    if (isRec(v)) {
      if (typeof v.name === "string") return v.name;
      if (typeof v.cue === "string") return v.cue;
    }
    if (typeof v === "string") return v;
  } catch {
    // bare text
  }
  return json;
}

/** An onUnityEvent, as the duel sees it; null for another scene's events and kinds it ignores. */
export function unityDuelAction(e: { scene: string; kind: string; json: string }): UnityDuelAction | null {
  if (e.scene !== "duel") return null;
  switch (e.kind) {
    case "ready":
      return { kind: "ready" };
    case "sfx":
      return { kind: "sfx", cue: parseCue(e.json) };
    case "finished":
      return { kind: "finished", payload: parseFinished(e.json) };
    case "quit":
      return { kind: "quit", payload: parseFinished(e.json) };
    default:
      return null;
  }
}

/** How long Unity may take to say `ready` (40 waits of 250 ms in DuelView.watchForScene). Past it, the fight plays in 2D. */
export const SCENE_WAIT_MS = 10_000;
/** The VS card holds this long while the arena loads (DuelView.begin). */
export const VERSUS_MS = 1800;
