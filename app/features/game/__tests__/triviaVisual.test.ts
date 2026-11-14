// Trivia's big pictures (features/game/triviaVisual.ts): which size a screen gets, the topic plate
// (never a faction), the reveal line with the server's key, the cards after the reveal, the results'
// picture and topics, and how a share card goes to each platform. Shapes from
// cosquest-review/realism-20261111/experiments/trivia-visual/CONTRACT.md.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { contrast, over } from "../lookTokens.ts";
import { runReveal, type RunPoint } from "../run.ts";
import { TRIVIA } from "../triviaLook.ts";
import {
  CINEMA,
  artColor,
  artUri,
  attemptArts,
  bestArt,
  canShareQuestion,
  cardMark,
  isTopicTile,
  pickArtSize,
  questionArt,
  revealLine,
  rightChoice,
  rightOf,
  rightOrder,
  shareFileName,
  shareMessage,
  sharePlan,
  topicLabel,
  topicsPlayed,
} from "../triviaVisual.ts";
import type { RoamAttempt, TriviaArt } from "../wire.ts";

const art = (h: string, color = "#1d2a35"): TriviaArt => ({
  w: 768,
  h: 1344,
  color,
  alt: "A lone hooded traveller on a dune ridge under two setting suns",
  src: { l: `https://srv/v1/trivia/art/${h}-l.webp`, m: `https://srv/v1/trivia/art/${h}-m.webp`, s: `https://srv/v1/trivia/art/${h}-s.webp` },
});
const pt = (idx: number, o: Partial<RunPoint> = {}): RunPoint => ({ idx, id: `p${idx}`, name: `P${idx}`, value: 100, done: false, earned: 0, hidden: false, forbidden: false, ...o });
const challenge = (c: RoamAttempt["challenge"]): Pick<RoamAttempt, "challenge"> => ({ challenge: c });
const q = (id: string, a?: TriviaArt) => ({ id, q: `${id}?`, choices: ["Cherries", "Strawberries", "Oranges", "Apples"], difficulty: 1, art: a ?? null });

describe("words over a picture pass AA, even over a white one", () => {
  const white = "#FFFFFF";
  const scrim = over(CINEMA.scrimMid, white);
  const card = over(CINEMA.glass, scrim);
  it("white and muted words on the scrim and on a dark glass card", () => {
    assert.ok(contrast(CINEMA.ink, scrim) >= 4.5, `ink on scrim ${contrast(CINEMA.ink, scrim).toFixed(2)}`);
    assert.ok(contrast(CINEMA.ink, card) >= 7, "ink on a card");
    assert.ok(contrast(over(CINEMA.muted, card), card) >= 4.5, "muted on a card");
  });
  it("the top bar's words over the top scrim", () => {
    assert.ok(contrast(CINEMA.ink, over(CINEMA.scrimTop, white)) >= 4.5);
  });
  it("a miss reads on a card, white reads on the magenta", () => {
    assert.ok(contrast(CINEMA.miss, card) >= 4.5);
    assert.ok(contrast(CINEMA.ink, TRIVIA.accent) >= 4.5);
  });
});

describe("the picture's size", () => {
  it("follows the contract's widths on a high tier phone", () => {
    // An iPhone 15: 393 pt at 3x is 1179 px.
    assert.equal(pickArtSize({ width: 393, scale: 3, tier: "high" }), "l");
    // 360 pt at 2x: 720 px.
    assert.equal(pickArtSize({ width: 360, scale: 2, tier: "high" }), "m");
    // 320 pt at 1x: 320 px.
    assert.equal(pickArtSize({ width: 320, scale: 1, tier: "high" }), "s");
    assert.equal(pickArtSize({ width: 300, scale: 3, tier: "high" }), "l");
    assert.equal(pickArtSize({ width: 299, scale: 2, tier: null }), "s");
  });
  it("counts the width a tall screen draws the picture at (cover scales to the height)", () => {
    // 290 pt wide but 1100 pt tall at 1x: the picture is drawn 628 pt wide.
    assert.equal(pickArtSize({ width: 290, height: 1100, scale: 1, tier: "high" }), "m");
    assert.equal(pickArtSize({ width: 290, height: 400, scale: 1, tier: "high" }), "s");
  });
  it("never gives a mid or low phone the large picture", () => {
    assert.equal(pickArtSize({ width: 393, scale: 3, tier: "mid" }), "m");
    assert.equal(pickArtSize({ width: 412, scale: 2.6, tier: "low" }), "m");
    assert.equal(pickArtSize({ width: 320, scale: 1, tier: "low" }), "s");
  });
  it("the web (no tier) goes by the screen", () => {
    assert.equal(pickArtSize({ width: 1280, scale: 1, tier: null }), "l");
  });
  it("a scale of 0 or less counts as 1", () => {
    assert.equal(pickArtSize({ width: 700, scale: 0, tier: "high" }), "m");
  });
});

describe("the picture's address and colour", () => {
  it("picks the size asked, stepping to a neighbour when one is missing", () => {
    const a = art("ab");
    assert.equal(artUri(a, "m"), a.src.m);
    assert.equal(artUri({ ...a, src: { s: a.src.s } }, "l"), a.src.s);
    assert.equal(artUri({ ...a, src: { l: a.src.l } }, "s"), a.src.l);
    assert.equal(artUri(null, "l"), null);
    assert.equal(artUri({ ...a, src: {} }, "l"), null);
  });
  it("shows the server's colour, or the fallback when it is not a colour", () => {
    assert.equal(artColor(art("x", "#1d2a35"), "#000000"), "#1d2a35");
    assert.equal(artColor(art("x", "red; x"), "#000000"), "#000000");
    assert.equal(artColor(null, "#101010"), "#101010");
  });
  it("finds each question's picture, and put-in-order's on the challenge", () => {
    const blitz = challenge({ questions: [q("a", art("1")), q("b", art("2"))] });
    assert.equal(questionArt(blitz, 1)?.src.l, art("2").src.l);
    assert.equal(questionArt(blitz, 9)?.src.l, art("2").src.l, "past the end: the last one");
    assert.equal(questionArt(challenge({ prompt: "Order", beats: [], art: art("seq") }))?.src.l, art("seq").src.l);
    assert.equal(questionArt(challenge({ questions: [q("a")] })), null);
    assert.equal(attemptArts(blitz).length, 2);
    assert.equal(attemptArts(null).length, 0);
  });
});

describe("the topic plate", () => {
  it("names the topic, never a faction", () => {
    assert.equal(topicLabel({ topic: "film", topic_name: "Film" }), "FILM");
    assert.equal(topicLabel({ topic: "anime", topic_name: "Anime & manga" }), "ANIME & MANGA");
    assert.equal(topicLabel({ topic: "true_crime" }), "TRUE CRIME", "an unknown id with no name still reads");
    assert.equal(topicLabel({ realm: "marvel" } as never), "DAILY TRIVIA");
    assert.equal(topicLabel(null), "DAILY TRIVIA");
  });
  it("knows a topic tile", () => {
    assert.equal(isTopicTile(pt(0, { topic: "film" })), true);
    assert.equal(isTopicTile(pt(0, { realm: "anime" })), false);
  });
});

describe("the reveal", () => {
  it("reads the server's key, else what the marks prove", () => {
    assert.equal(rightChoice({ correct: [2], marks: [false] }, 0, 1), 2);
    assert.equal(rightChoice({ marks: [true] }, 0, 3), 3);
    assert.equal(rightChoice({ marks: [false] }, 0, 3), null);
    assert.equal(rightChoice({ correct: [-1], marks: [false] }, 0, 3), null);
    assert.equal(rightChoice(null, 0, null), null);
  });
  it("lights the right card on a miss when the server names it (runReveal)", () => {
    assert.deepEqual(runReveal("trivia", { reveal: { marks: [false], correct: [0] } }, 2, []), { correct: [0], marks: [false] });
    assert.deepEqual(runReveal("blitz", { reveal: { marks: [true, false], correct: [1, 2] } }, null, [1, 3]), { correct: [1, 2], marks: [true, false] });
  });
  it("says the line: right, a miss naming the answer, late, and build 28's without a key", () => {
    const hit = { late: false, earned: 200, correct: 1, total: 1 };
    const miss = { late: false, earned: 0, correct: 0, total: 1 };
    assert.deepEqual(revealLine(hit, "Cherries", "Cherries"), { tone: "right", text: "Correct! Cherries it is." });
    assert.deepEqual(revealLine(hit, "Cherries", null), { tone: "right", text: "Correct! Cherries it is." });
    assert.deepEqual(revealLine(miss, "Apples", "Cherries"), { tone: "miss", text: "It was Cherries." });
    assert.deepEqual(revealLine(miss, "Apples", null), { tone: "miss", text: "Not this time." });
    assert.deepEqual(revealLine({ ...miss, late: true }, null, "Cherries"), { tone: "late", text: "Time's up. It was Cherries." });
    assert.equal(revealLine({ late: false, earned: 90, correct: 3, total: 5 }, null, null).text, "3 of 5 right.");
    assert.equal(revealLine({ late: false, earned: 300, correct: 5, total: 5 }, null, null).text, "All 5 right!");
    assert.equal(revealLine({ late: true, earned: 0, correct: 0, total: 5 }, null, null).tone, "late");
  });
  it("marks the cards: the pick waits, then the right one lights, a wrong pick keeps its rim, the rest dim", () => {
    assert.equal(cardMark(0, null, null, null), "idle");
    assert.equal(cardMark(1, 1, null, null), "picked");
    assert.equal(cardMark(0, 1, null, null), "waiting");
    assert.equal(cardMark(1, 1, "right", 1), "right");
    assert.equal(cardMark(1, 1, "right", null), "right");
    assert.equal(cardMark(1, 1, "wrong", 0), "wrong");
    assert.equal(cardMark(0, 1, "wrong", 0), "missed-right");
    assert.equal(cardMark(2, 1, "wrong", 0), "dim");
    assert.equal(cardMark(0, null, "late", 0), "missed-right");
  });
  it("gives put-in-order's right order, as text", () => {
    const beats = [
      { id: "a", text: "First" },
      { id: "b", text: "Second" },
    ];
    assert.deepEqual(rightOrder({ correct_text: ["First", "Second"] }, beats), ["First", "Second"]);
    assert.deepEqual(rightOrder({ correct_order: ["b", "a"] }, beats), ["Second", "First"]);
    assert.equal(rightOrder({ correct_order: ["z"] }, beats), null);
    assert.equal(rightOrder({}, beats), null);
  });
});

describe("the results", () => {
  const run = { points: [pt(0, { done: true, earned: 200, topic_name: "Film" }), pt(1, { done: true, earned: 0, topic_name: "Space & sci-fi" }), pt(2, { done: true, earned: 400, topic_name: "Film" }), pt(3, { topic_name: "Comics" })] };
  it("lists the topics played once each, in deal order", () => {
    assert.deepEqual(topicsPlayed(run), ["Film", "Space & sci-fi"]);
    assert.deepEqual(topicsPlayed(null), []);
  });
  it("counts the right answers out of the run", () => {
    assert.deepEqual(rightOf(run), { right: 2, total: 4 });
  });
  it("takes the picture of the question that paid most, else the last seen", () => {
    assert.equal(bestArt(run, { 0: art("a"), 2: art("c"), 1: art("b") })?.src.l, art("c").src.l);
    assert.equal(bestArt(run, { 1: art("b") })?.src.l, art("b").src.l);
    assert.equal(bestArt(run, {}), null);
    assert.equal(bestArt({ points: [] }, { 7: art("z") })?.src.l, art("z").src.l);
  });
});

describe("sharing", () => {
  it("puts the link on the end of the line once", () => {
    assert.equal(shareMessage("Film trivia on CosQuest: Who? Can you get it? https://s/q/1", "https://s/q/1"), "Film trivia on CosQuest: Who? Can you get it? https://s/q/1");
    assert.equal(shareMessage("I scored 900 on CosQuest trivia.", "https://s/x"), "I scored 900 on CosQuest trivia. https://s/x");
    assert.equal(shareMessage("", "https://s/x"), "https://s/x");
  });
  it("hands the card over per platform, never posting anything itself", () => {
    const card = { image_url: "https://s/q/1.png" };
    assert.equal(sharePlan("ios", card, false), "file");
    assert.equal(sharePlan("android", card, false), "message");
    assert.equal(sharePlan("web", card, true), "web-files");
    assert.equal(sharePlan("web", card, false), "web-open");
    assert.equal(sharePlan("ios", { image_url: null }, false), "message", "an old server's run share has no picture");
  });
  it("names the saved file safely", () => {
    assert.equal(shareFileName("Qx12_ab", "q"), "cosquest-q-Qx12_ab.png");
    assert.equal(shareFileName("../../etc", "story"), "cosquest-story-etc.png");
    assert.equal(shareFileName("", "q"), "cosquest-q-card.png");
  });
  it("offers a question's card only on an answered topic tile", () => {
    assert.equal(canShareQuestion({ topic: "film", answered: true }), true);
    assert.equal(canShareQuestion({ topic: "film", answered: false }), false);
    assert.equal(canShareQuestion({ topic: null, answered: true }), false);
  });
});
