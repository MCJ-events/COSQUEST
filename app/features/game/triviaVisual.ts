// Trivia that is "bigger than life" (Mark, 14 Nov 2026: "realistic pictures ... very visual ... big
// pictures ... take this trivia and put it on social media"). The pure half: which size of a
// question's picture this screen gets, what the topic plate says (a topic, never a faction), the line
// under the answers once the server has said which answer was right, the run's best picture and its
// topics for the results, and how a share card is handed to the phone. The server's side is
// cosquest-review/realism-20261111/experiments/trivia-visual/CONTRACT.md (flag `trivia_topics`).
// Every field here is optional on the wire: with them absent the screens are build 28's.
// Pure (no React Native), tested in __tests__/triviaVisual.test.ts.
import type { RunAnswerResult, RunPoint, RunState } from "./run.ts";
import type { RoamAttempt, TriviaArt } from "./wire.ts";

export type ArtSize = "s" | "m" | "l";

/** The quality tier the app gives a phone (features/game/lookTier.ts); null where it does not apply (the web). */
export type ArtTier = "high" | "mid" | "low" | null;

/**
 * The size of a question's picture for this screen. The picture covers the whole screen, so what
 * counts is the width it is drawn at: the screen's, or wider on a phone taller than the picture
 * (cover scales to the height). Then the contract's rule: 900 px and up `l`, 600 and up `m`, else `s`.
 * A mid or low tier phone never gets `l` (memory, data, decode time on an older phone).
 */
export function pickArtSize(o: { width: number; height?: number | null; scale: number; tier: ArtTier; aspect?: number | null }): ArtSize {
  const aspect = o.aspect && o.aspect > 0 ? o.aspect : 768 / 1344;
  const drawn = Math.max(o.width, (o.height ?? 0) * aspect);
  const px = drawn * Math.max(1, o.scale || 1);
  const size: ArtSize = px >= 900 ? "l" : px >= 600 ? "m" : "s";
  if ((o.tier === "low" || o.tier === "mid") && size === "l") return "m";
  return size;
}

/** The address for that size, stepping down then up when the server left one out; null without a picture. */
export function artUri(art: TriviaArt | null | undefined, size: ArtSize): string | null {
  const src = art?.src;
  if (!src) return null;
  const order: ArtSize[] = size === "l" ? ["l", "m", "s"] : size === "m" ? ["m", "s", "l"] : ["s", "m", "l"];
  for (const k of order) if (src[k]) return src[k] as string;
  return null;
}

/** A picture's colour to show before it arrives: the server's, when it is a colour. */
export function artColor(art: TriviaArt | null | undefined, fallback: string): string {
  const c = art?.color ?? "";
  return /^#[0-9a-f]{6}$/i.test(c) || /^#[0-9a-f]{3}$/i.test(c) ? c : fallback;
}

/** The picture behind question `i` of an attempt: its own, or the challenge's (put-in-order has one for all). */
export function questionArt(attempt: Pick<RoamAttempt, "challenge"> | null | undefined, i = 0): TriviaArt | null {
  const qs = attempt?.challenge.questions ?? [];
  const q = qs[Math.min(Math.max(0, i), qs.length - 1)];
  return q?.art ?? attempt?.challenge.art ?? null;
}

/** Every picture in an attempt (a quick-fire has five): fetched together as it opens. */
export function attemptArts(attempt: Pick<RoamAttempt, "challenge"> | null | undefined): TriviaArt[] {
  const out: TriviaArt[] = [];
  for (const q of attempt?.challenge.questions ?? []) if (q.art) out.push(q.art);
  if (attempt?.challenge.art) out.push(attempt.challenge.art);
  return out;
}

/**
 * The plate over a question: the topic ("FILM"), or "DAILY TRIVIA". Never a faction: Mark, 14 Nov,
 * "the trivia is not related in any way to the factions. It's related to the topic." An old server
 * still sends a realm on a trivia tile; it is not shown.
 */
export function topicLabel(t: { topic?: string | null; topic_name?: string | null } | null | undefined): string {
  const name = (t?.topic_name ?? "").trim();
  if (name) return name.toUpperCase();
  const id = (t?.topic ?? "").trim();
  if (id) return id.replace(/[_-]+/g, " ").toUpperCase();
  return "DAILY TRIVIA";
}

/** Whether a tile is dealt by topic (the server's `trivia_topics` is on): the big picture screen. */
export function isTopicTile(p: Pick<RunPoint, "topic"> | null | undefined): boolean {
  return !!p?.topic;
}

/** The right choice of question `i`, when the server said so (topic tiles); else what the marks prove (your pick, when it was right). */
export function rightChoice(reveal: RunAnswerResult["reveal"] | null | undefined, i: number, picked: number | null): number | null {
  const c = reveal?.correct?.[i];
  if (typeof c === "number" && c >= 0) return c;
  if (reveal?.marks?.[i] && picked !== null && picked >= 0) return picked;
  return null;
}

export type RevealLine = { tone: "right" | "miss" | "late"; text: string };

/**
 * The line under the answers (Wale: "Correct! Cherries it is."). With the server's key a miss names
 * the answer ("It was Cherries."); without it, as build 28 ("Not this time.").
 */
export function revealLine(r: Pick<RunAnswerResult, "late" | "earned" | "correct" | "total">, picked: string | null, right: string | null): RevealLine {
  if (r.total > 1) {
    if (r.late && r.correct === 0) return { tone: "late", text: "Time's up on that one." };
    const all = r.correct === r.total;
    return { tone: r.correct > 0 ? "right" : "miss", text: all ? `All ${r.total} right!` : `${r.correct} of ${r.total} right.` };
  }
  if (r.late) return { tone: "late", text: right ? `Time's up. It was ${right}.` : "Time's up on that one." };
  if (r.earned > 0 || r.correct > 0) {
    const name = right ?? picked;
    return { tone: "right", text: name ? `Correct! ${name} it is.` : "Correct!" };
  }
  return { tone: "miss", text: right ? `It was ${right}.` : "Not this time." };
}

/** What each answer card shows after the reveal. */
export type CardMark = "idle" | "picked" | "right" | "wrong" | "missed-right" | "dim";

/**
 * One card once the player has picked: while the server marks it the pick is lit and the rest wait;
 * after, the right one is lit (yours or not), your wrong pick keeps a rose rim, the rest dim away.
 */
export function cardMark(i: number, picked: number | null, verdict: "right" | "wrong" | "late" | null, right: number | null): CardMark {
  if (verdict === null) return picked === null ? "idle" : picked === i ? "picked" : "dim";
  if (right !== null && i === right) return picked === i ? "right" : "missed-right";
  if (picked === i) return verdict === "right" ? "right" : "wrong";
  return "dim";
}

/** The topics a run played, in the order dealt, once each ("Film", "Space & sci-fi"). */
export function topicsPlayed(run: Pick<RunState, "points"> | null | undefined): string[] {
  const out: string[] = [];
  for (const p of [...(run?.points ?? [])].sort((a, b) => a.idx - b.idx)) {
    const name = (p.topic_name ?? "").trim();
    if (p.done && name && !out.includes(name)) out.push(name);
  }
  return out;
}

/** How many questions the run got right: tiles that paid ("7 of 10 right"). */
export function rightOf(run: Pick<RunState, "points">): { right: number; total: number } {
  return { right: run.points.filter((p) => p.done && p.earned > 0).length, total: run.points.length };
}

/**
 * The run's best picture for the results: the one behind the question that paid the most, else the
 * last one seen. `seen` is each opened tile's picture by its idx.
 */
export function bestArt(run: Pick<RunState, "points"> | null | undefined, seen: Record<number, TriviaArt | null | undefined>): TriviaArt | null {
  const points = [...(run?.points ?? [])].filter((p) => seen[p.idx]).sort((a, b) => b.earned - a.earned || b.idx - a.idx);
  if (points.length) return seen[points[0].idx] ?? null;
  const any = Object.values(seen).filter(Boolean) as TriviaArt[];
  return any.length ? any[any.length - 1] : null;
}

/** "Correct! Cherries it is." for a put-in-order: the right order, as the server gave it. */
export function rightOrder(reveal: RunAnswerResult["reveal"] | null | undefined, beats: { id: string; text: string }[]): string[] | null {
  if (reveal?.correct_text?.length) return reveal.correct_text;
  const ids = reveal?.correct_order;
  if (!ids?.length) return null;
  const text = ids.map((id) => beats.find((b) => b.id === id)?.text).filter((t): t is string => !!t);
  return text.length === ids.length ? text : null;
}

// ---------- sharing ----------

/** A share card the server made (one question, or a whole run's story card). */
export type ShareCard = { id: string; url: string; image_url: string | null; text: string };

/** The line that goes with a card: the server's, with its page's link on the end once (never twice). */
export function shareMessage(text: string, url: string): string {
  const t = text.trim();
  if (!url || t.includes(url)) return t;
  return t ? `${t} ${url}` : url;
}

/**
 * How this platform hands a card over, without native modules the app does not have:
 *   ios: the PNG saved to the cache, then the share sheet with the file and the line ("file")
 *   android: the line with the link; its preview shows the card ("message")
 *   web: the PNG as a file to the browser's share sheet when it takes files ("web-files"),
 *        else the picture opened in a new tab and the line copied ("web-open")
 * No picture (an old server's run share): the line with the link everywhere.
 */
export type SharePlan = "file" | "message" | "web-files" | "web-open";

export function sharePlan(os: string, card: Pick<ShareCard, "image_url">, webCanShareFiles: boolean): SharePlan {
  if (!card.image_url) return "message";
  if (os === "ios") return "file";
  if (os === "web") return webCanShareFiles ? "web-files" : "web-open";
  return "message";
}

/** The file name a card is saved under: the share's id, kept to letters and digits. */
export function shareFileName(id: string, kind: "q" | "story"): string {
  const safe = id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || "card";
  return `cosquest-${kind}-${safe}.png`;
}

/** Whether a question can be shared: a topic tile the server has answered. */
export function canShareQuestion(o: { topic?: string | null; answered: boolean }): boolean {
  return !!o.topic && o.answered;
}
