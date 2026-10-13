// What a line must pass before the Warden says it: costquest-ios
// Warden/WardenCheck.swift, the same rules the training data was held to
// (costquest-qlm/warden/validate.py). The important one is facts: a small
// model will tell a player they are "four in a row" when they have a four-day
// streak, and a game that gets your own numbers wrong has lost the point.
// Pure (tested in features/game/__tests__).
import type { WardenMoment } from "./warden.ts";
import type { ModelManifest } from "./wire.ts";

/**
 * The best published variant this phone can hold: the manifest lists them best
 * first, each with the RAM it needs. `force` (a label fragment) is for test
 * builds, e.g. an emulator with less RAM than the policy wants.
 */
export function chooseVariant(manifest: ModelManifest, physicalMemory: number, force?: string | null) {
  const variants = manifest.variants?.length
    ? manifest.variants
    : [{ label: manifest.label, model: manifest.model, tokenizer: manifest.tokenizer, min_ram_bytes: manifest.min_ram_bytes }];
  if (force) return variants.find((v) => v.label.toLowerCase().includes(force.toLowerCase())) ?? null;
  return variants.find((v) => physicalMemory >= v.min_ram_bytes) ?? null;
}

const WORD_NUMBERS: Record<string, number> = (() => {
  const words =
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty".split(" ");
  const out: Record<string, number> = {};
  words.forEach((w, i) => (out[w] = i));
  out.thirty = 30;
  out.forty = 40;
  out.fifty = 50;
  out.hundred = 100;
  return out;
})();

/** Trim what the model wrote to the line itself. */
export function cleanLine(raw: string): string {
  let s = raw;
  for (const stop of ["<|im_end|>", "<|im_start|>", "\n"]) {
    const i = s.indexOf(stop);
    if (i >= 0) s = s.slice(0, i);
  }
  s = s.trim();
  if (s.length > 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
  return s;
}

export function numbersIn(text: string): Set<number> {
  const out = new Set<number>();
  const cleaned = text.replace(/,/g, "");
  for (const m of cleaned.matchAll(/[0-9]+/g)) {
    const n = Number(m[0]);
    if (Number.isSafeInteger(n)) out.add(n);
  }
  // Latin letters only: anything else fails lineProblem's script check anyway.
  for (const word of cleaned.toLowerCase().split(/[^a-z\u00c0-\u024f]+/)) {
    if (word in WORD_NUMBERS) out.add(WORD_NUMBERS[word]);
  }
  return out;
}

/** null when the line may be said; otherwise why not. */
export function lineProblem(text: string, m: WardenMoment): string | null {
  const words = text.split(/\s+/).filter(Boolean);
  const limit = m.kind === "recap" ? 45 : m.kind === "legend" ? 32 : 18;
  if (words.length < 4) return "too short";
  if (words.length > limit) return `too long (${words.length})`;
  if (/["#*]/.test(text)) return "markup";
  // (No \p{...} escapes: Hermes is not guaranteed to have them.)
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0x1f000 || (cp >= 0x2600 && cp <= 0x27bf)) return "emoji";
  }
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp > 0x24f && !(cp >= 0x2000 && cp <= 0x206f)) return "non-Latin script";
  }
  const allowed = numbersIn(m.input);
  [1, 2, 3, 4, 5].forEach((n) => allowed.add(n));
  const invented = [...numbersIn(text)].filter((n) => !allowed.has(n)).sort((a, b) => a - b);
  if (invented.length) return `invented numbers [${invented.join(", ")}]`;
  const lower = text.toLowerCase();
  for (const bad of ["prize", "money", "cash", "bet ", "$", "<think", "as an ai", "i'm an ai"]) {
    if (lower.includes(bad)) return `banned: ${bad}`;
  }
  if (m.kind === "arrive") {
    const head = m.fact("place")?.split(" ")[0];
    if (head && !lower.includes(head.toLowerCase())) return "arrive without the place";
  }
  return null;
}
