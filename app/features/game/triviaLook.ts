// The trivia screens' look, from Wale's trivia UI (cosquest-review/forge-quality/
// wale-docs/trivia-ui-screens, posted 4 Nov 2026): a pale sky that brightens
// downwards, frosted white cards with a white rim, one magenta accent for
// everything that is "you" (the pick, the progress, the main button), slate
// ink, and Poppins (the app's own face) instead of the map game's Lilita.
// Mark, 6 Nov: follow Wale on the UI.
//
// Pure (no React Native), so the pairings are checked against WCAG AA in
// features/game/__tests__/triviaLook.test.ts. The screens: TriviaKit.tsx,
// TriviaPlay.tsx and TriviaFrontDoor.tsx.
import { realmName } from "./realmNames.ts";
import type { RunAnswerResult, RunBoard, RunPoint, RunState } from "./run";

export const TRIVIA = {
  /** The page: sky at the top, nearly white at the bottom. */
  skyTop: "#BEDDE9",
  skyBottom: "#E6F1F6",
  /** The top bar's strip, a little lighter than the sky under it. */
  bar: "rgba(255,255,255,0.32)",
  barRule: "rgba(255,255,255,0.75)",
  /** Frosted cards and buttons. */
  glass: "rgba(255,255,255,0.55)",
  glassStrong: "rgba(255,255,255,0.82)",
  rim: "rgba(255,255,255,0.92)",
  /** Words. */
  ink: "#1F3A4A",
  muted: "#46606F",
  /** The accent: fills (white words on it) and the same hue deep enough for small words on the sky. */
  accent: "#B8418F",
  accentText: "#9E2F78",
  accentSoft: "rgba(184,65,143,0.14)",
  accentRing: "rgba(184,65,143,0.55)",
  onAccent: "#FFFFFF",
  /** A miss: a rose rim and words, never a red flood (the right answer stays the loud one). */
  miss: "#B3263F",
  missSoft: "rgba(179,38,63,0.10)",
  /** Segments still to play. */
  track: "rgba(31,58,74,0.14)",
  /** The four pastel card faces (the character cards). */
  pastel: ["#F6D3E8", "#CFE0F7", "#CBE8E0", "#E2D6F3"] as readonly string[],
  /** Darkened for a frame or a kicker on its own pastel. */
  pastelEdge: ["#B8418F", "#3E6FB8", "#2C8571", "#7353B0"] as readonly string[],
} as const;

/** Corner radii read off the screens: cards 18, buttons 12, square icon buttons 10. */
export const TRIVIA_RADIUS = { card: 18, button: 12, icon: 10, pill: 999 } as const;

/**
 * Sizes in points, measured off Wale's phone pictures (590 px wide pictures of
 * a 393 pt phone, so 1 pt is 1.5 px): the page's side margin, the top bar's
 * square buttons, the main button, the hero band over a question, an answer
 * card, the ring under the feedback line, the avatar ring on the results.
 */
export const TRIVIA_SIZE = {
  phone: 393,
  pad: 24,
  square: 43,
  button: 52,
  field: 46,
  hero: 213,
  heroMin: 120,
  answer: 87,
  answerGap: 10,
  cardGap: 16,
  starCard: 150,
  pill: 46,
  ring: 67,
  avatarRing: 100,
} as const;

/** The hero band's height: his 213 pt on his 852 pt phone, a quarter of a shorter one, never under 120. */
export function heroHeight(windowHeight: number): number {
  return Math.round(Math.min(TRIVIA_SIZE.hero, Math.max(TRIVIA_SIZE.heroMin, windowHeight * 0.25)));
}

/** One of two cards side by side inside the page margins. */
export function halfWidth(windowWidth: number, gap: number): number {
  return Math.floor((Math.min(windowWidth, 560) - 2 * TRIVIA_SIZE.pad - gap) / 2);
}

/** Answer letters, as on the cards. */
export const LETTERS = ["A", "B", "C", "D", "E", "F"] as const;

export function letterOf(i: number): string {
  return LETTERS[i] ?? String(i + 1);
}

/** "06 / 10": the question counter is two digits wide, as on the screens. */
export function twoDigits(n: number): string {
  return n < 10 && n >= 0 ? `0${n}` : String(n);
}

/** "00:20": the question's own clock. */
export function stopwatch(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${twoDigits(Math.floor(s / 60))}:${twoDigits(s % 60)}`;
}

/** The points a player can open in turn: not done, not hidden (a hidden bonus needs Radar first). */
export function playable(run: Pick<RunState, "points"> | null | undefined): RunPoint[] {
  return (run?.points ?? []).filter((p) => !p.done && !p.hidden);
}

/**
 * The next question in a trivia run, in the order the server dealt them, so a
 * run reads as Question 1, 2, 3 rather than a board to choose from (Wale's
 * flow). `after` is the point just played: the next one after it, wrapping round.
 */
export function nextTriviaPoint(run: Pick<RunState, "points"> | null | undefined, after?: number | null): RunPoint | null {
  const open = playable(run).sort((a, b) => a.idx - b.idx);
  if (!open.length) return null;
  if (after == null) return open[0];
  return open.find((p) => p.idx > after) ?? open[0];
}

/** "Question 6 / 10": the one on screen is the one after those already played. */
export function questionNumber(run: Pick<RunState, "points"> | null | undefined): { n: number; total: number } {
  const points = run?.points ?? [];
  const done = points.filter((p) => p.done).length;
  return { n: Math.min(points.length, done + 1), total: points.length };
}

/** One segment per question: played (right or not), the one on screen, or still to come. */
export type Segment = "done" | "now" | "todo";

export function segments(run: Pick<RunState, "points"> | null | undefined, current: number | null): Segment[] {
  const points = run?.points ?? [];
  const done = points.filter((p) => p.done).length;
  // Played ones fill from the left, whatever order they were played in, so the bar only ever grows.
  return points.map((_, i) => (i < done ? "done" : i === done && current !== null ? "now" : "todo"));
}

/**
 * The line under the answers once the server has marked it (Wale: "Correct!
 * Cherries it is."). The server never says which choice was right on a miss,
 * so a miss says so without naming the answer.
 */
export function feedbackLine(r: Pick<RunAnswerResult, "late" | "earned" | "correct" | "total">, pickedText: string | null): { tone: "right" | "miss" | "late"; text: string } {
  if (r.late) return { tone: "late", text: "Time's up on that one." };
  if (r.total > 1) {
    const all = r.correct === r.total;
    return { tone: r.correct > 0 ? "right" : "miss", text: all ? `All ${r.total} right!` : `${r.correct} of ${r.total} right.` };
  }
  if (r.earned > 0 || r.correct > 0) return { tone: "right", text: pickedText ? `Correct! ${pickedText} it is.` : "Correct!" };
  return { tone: "miss", text: "Not this time." };
}

/** "~2 min": what a run costs, for the bar under the Start button. */
export function runLength(questions: number, minutes: number): string {
  return `${questions} questions · up to ${minutes} min`;
}

/**
 * The plate on the hero band. Wale's names the question's subject ("WRECK-IT
 * RALPH"); a question carries no subject, and the tile's generated name has
 * nothing to do with it, so the plate names the tile's realm, or the game.
 */
export function heroPlate(point: Pick<RunPoint, "realm">): string {
  return point.realm ? realmName(point.realm).toUpperCase() : "DAILY TRIVIA";
}

/** Where the main button goes after an answer: the next question, the board (a hidden bonus is left), or the score. */
export function afterAnswer(run: Pick<RunState, "points" | "finished"> | null | undefined, justPlayed: number): "next" | "board" | "score" {
  if (!run || run.finished) return "score";
  if (nextTriviaPoint(run, justPlayed)) return "next";
  return run.points.some((p) => !p.done && p.idx !== justPlayed) ? "board" : "score";
}

/** How many questions paid: the "n / 10" on the results card. */
export function scoredCount(run: Pick<RunState, "points">): number {
  return run.points.filter((p) => p.done && p.earned > 0).length;
}

export type StarCard = { place: number; handle: string; score: number; you: boolean };

/**
 * The four cards on the start screen. Wale's are characters to pick; there is
 * no character mechanic, so they show today's top four players (null: a spot
 * nobody has taken yet).
 */
export function starCards(board: Pick<RunBoard, "entries"> | null | undefined, n = 4): (StarCard | null)[] {
  const top: (StarCard | null)[] = (board?.entries ?? []).slice(0, n).map((e) => ({ place: e.place, handle: e.handle, score: e.score, you: e.you }));
  while (top.length < n) top.push(null);
  return top;
}

/** "1,240 pts". */
export function pointsText(n: number): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? "pt" : "pts"}`;
}
