// The Warden: the game's announcer. A port of costquest-ios Warden/WardenVoice.swift
// (WardenMoment), Warden/WardenLines.swift (the authored lines) and
// Warden/WardenMoments.swift (the facts for each moment).
//
// Build 24: the Warden is an impartial announcer, not a companion, and it is
// silent unless the server turns `features.announcer` on (announcerOn). The
// authored lines are neutral statements of fact, one register for everyone;
// they are what is said before a model is loaded and whenever a generated
// line fails its check. The variant is seeded by the
// facts exactly as on iOS, so the same moment gets the same line on both.
// Pure (tested in features/game/__tests__).
import type { QuestPoint, RoamDaily, RoamMe, RoamVerdict } from "./wire.ts";

/**
 * The Warden is an impartial announcer (build 24): one neutral register for
 * every player, whatever their faction. The faction styles (arcade, mythic,
 * hype, trailer, quippy) are gone; the type stays so the model input keeps
 * its "style: neutral" field as trained.
 */
export type WardenStyle = "neutral";

/** Always "neutral": a player's faction no longer changes how the Warden speaks. */
export function wardenStyle(_faction?: string | null): WardenStyle {
  return "neutral";
}

/**
 * Whether the server has the announcer on (/v1/roam/me features.announcer):
 * `true`, or an object with `on` or `enabled` true. Absent, false or null is
 * silent, and production does not send the key, so the Warden says nothing.
 */
export function announcerOn(me: { features?: Record<string, unknown> | null } | null | undefined): boolean {
  const a = me?.features?.announcer;
  if (a === true) return true;
  if (!a || typeof a !== "object") return false;
  const o = a as { on?: unknown; enabled?: unknown };
  return o.on === true || o.enabled === true;
}

type FactPair = [string, string | null | undefined];

export class WardenMoment {
  readonly kind: string;
  readonly style: WardenStyle;
  readonly facts: [string, string][];
  readonly salt: string;
  /** A line that is said as written (a Game Warden site's own, from checked facts): no model, no template. */
  readonly fixed: string | null;

  constructor(kind: string, style: WardenStyle, facts: FactPair[], salt = "", fixed: string | null = null) {
    this.kind = kind;
    this.style = style;
    this.facts = facts.filter((f): f is [string, string] => typeof f[1] === "string" && f[1].length > 0);
    this.salt = salt;
    this.fixed = fixed;
  }

  /** The exact input line the model was fine-tuned on (costquest-qlm/warden/make_inputs.py). */
  get input(): string {
    return [["moment", this.kind], ["style", this.style], ...this.facts].map(([k, v]) => `${k}: ${v}`).join(" | ");
  }

  get key(): string {
    return `${this.input}#${this.salt}`;
  }

  fact(k: string): string | undefined {
    return this.facts.find(([key]) => key === k)?.[1];
  }

  get maxTokens(): number {
    return 40;
  }

  static readonly system =
    "You are the Warden, the impartial announcer of CostQuest. State one short line in a neutral voice, using only the given facts.";

  /** The Qwen3 chat prompt with thinking off, as the voice was trained. */
  get prompt(): string {
    return (
      `<|im_start|>system\n${WardenMoment.system}<|im_end|>\n` +
      `<|im_start|>user\n${this.input}<|im_end|>\n` +
      "<|im_start|>assistant\n<think>\n\n</think>\n\n"
    );
  }
}

/** Swift's `(seed &* 31 &+ scalar) & 0x7fffffff` over the input's unicode scalars. */
export function lineSeed(input: string): number {
  let seed = 0;
  for (const ch of input) {
    const cp = ch.codePointAt(0) ?? 0;
    // seed < 2^31, so seed * 31 + cp < 2^36: exact in a double; mask the low 31 bits.
    seed = (seed * 31 + cp) % 2147483648;
  }
  return seed;
}

/** The authored line for a moment (WardenLines.fallback). */
export function fallbackLine(m: WardenMoment): string {
  if (m.fixed) return m.fixed;
  const name = m.fact("name") ?? "traveller";
  const place = m.fact("place") ?? "this place";
  let options: string[];
  switch (m.kind) {
    case "arrive":
      options = [`${place}. Challenge open, ${name}.`, `${name} has reached ${place}. The shrine is open.`];
      break;
    case "correct":
      options = [`Correct, ${name}.`, `Right answer, ${name}.`];
      break;
    case "wrong":
      options = [`Incorrect, ${name}.`, "Not correct. The next point is open."];
      break;
    case "siege_won": {
      const from = m.fact("taken_from") ?? "the rival";
      options = [`${place} is taken from ${from}. It now holds for ${name}.`, `The Guardian is defeated. ${place} changes hands.`];
      break;
    }
    case "siege_lost": {
      const holder = m.fact("holder") ?? "the rival";
      options = [`${place} holds for ${holder}.`, "The Guardian held. The siege can be tried again after the rest."];
      break;
    }
    case "late":
      options = [`Time is up, ${name}.`, "Time is up. No answer counted."];
      break;
    case "levelup": {
      const level = m.fact("level") ?? "up";
      options = [`${name} reaches level ${level}.`, `Level ${level}, ${name}.`];
      break;
    }
    case "rankup": {
      const rank = m.fact("rank") ?? "a new rank";
      options = [`${name} is now ${rank}.`, `New rank for ${name}: ${rank}.`];
      break;
    }
    case "streak":
      options = [`Streak: ${m.fact("streak") ?? "another day"}, ${name}.`];
      break;
    case "daily_done": {
      const q = m.fact("quest") ?? "Today's quest";
      options = [`${q}: complete.`, `Quest complete, ${name}: ${q}.`];
      break;
    }
    case "hint":
      options = [`Hint used, ${name}.`, "Hint applied."];
      break;
    default:
      options = [`${name}.`];
  }
  return options[lineSeed(m.input) % options.length];
}

// ---------- the facts for each moment (WardenMoments.swift) ----------

export type MomentContext = {
  me: RoamMe | null;
  playerName: string;
};

const NEUTRAL: WardenStyle = "neutral";

export function arriveMoment(ctx: MomentContext, p: QuestPoint): WardenMoment {
  const s = ctx.me?.standing;
  const facts: FactPair[] = [
    ["name", ctx.playerName],
    ["place", p.name],
    ["tier", p.tier],
    ["challenge", p.challenge],
    ["questions", p.realm],
    ["level", s ? String(s.level) : null],
  ];
  if (s && !s.max_level && s.level_span - s.into_level < 200) facts.push(["to_next", `${s.level_span - s.into_level} XP`]);
  if (ctx.me && ctx.me.streak.days >= 2) facts.push(["streak", `${ctx.me.streak.days} days`]);
  if (ctx.me?.streak.played_today === false) facts.push(["first_point_today", "yes"]);
  return new WardenMoment("arrive", NEUTRAL, facts, ctx.me?.day ?? "");
}

export function reactionMoment(
  ctx: MomentContext,
  correct: boolean,
  point: { name: string },
  kind: string,
  verdict?: RoamVerdict | null,
): WardenMoment {
  const facts: FactPair[] = [["name", ctx.playerName], ["place", point.name], ["challenge", kind]];
  if (verdict) {
    if (kind === "blitz") facts.push(["score", `${verdict.correct} of ${verdict.total}`]);
    if (correct && verdict.answer_run >= 2) facts.push(["run", `${verdict.answer_run} right in a row`]);
    if (correct) facts.push(["xp_gained", String(verdict.reward.xp)]);
  }
  return new WardenMoment(correct ? "correct" : "wrong", NEUTRAL, facts, verdict?.attempt_id ?? "");
}

export function lateMoment(ctx: MomentContext, point: { name: string }): WardenMoment {
  return new WardenMoment("late", NEUTRAL, [["name", ctx.playerName], ["place", point.name]]);
}

export function levelMoment(ctx: MomentContext, after: { level: number; rank: string }, rankUp: boolean): WardenMoment {
  if (rankUp) {
    return new WardenMoment("rankup", NEUTRAL, [["name", ctx.playerName], ["rank", after.rank], ["level", String(after.level)]]);
  }
  return new WardenMoment("levelup", NEUTRAL, [["name", ctx.playerName], ["level", String(after.level)], ["rank", after.rank]]);
}

export function dailyMoment(ctx: MomentContext, d: RoamDaily): WardenMoment {
  return new WardenMoment("daily_done", NEUTRAL, [["name", ctx.playerName], ["quest", d.title], ["reward", `${d.reward.xp} XP`]]);
}

export function hintMoment(ctx: MomentContext, kind: string): WardenMoment {
  return new WardenMoment("hint", NEUTRAL, [["name", ctx.playerName], ["hint", kind === "fifty" ? "50/50" : "extra time"]]);
}

/** Arriving at a Game Warden site: the site's own arrive line, as the server wrote it from its facts. */
export function siteArriveMoment(ctx: MomentContext, p: QuestPoint, line: string): WardenMoment {
  return new WardenMoment("arrive", NEUTRAL, [["name", ctx.playerName], ["place", p.name]], p.id, line);
}

/**
 * Where a line comes from. The on-device model plugs in here (features/game/
 * wardenModel.ts); without it every line is the authored one, instantly.
 */
export type LineWriter = (m: WardenMoment) => Promise<string | null>;

export async function lineFor(m: WardenMoment, writer?: LineWriter | null): Promise<{ text: string; fromModel: boolean }> {
  if (writer) {
    try {
      const text = await writer(m);
      if (text && text.trim()) return { text: text.trim(), fromModel: true };
    } catch {
      // The game never waits on the model: fall through to the authored line.
    }
  }
  return { text: fallbackLine(m), fromModel: false };
}
