// Wale's trivia look (features/game/triviaLook.ts): every text pairing passes
// AA, and the pure half of the linear flow (which question is next, the
// counter, the segments, the line under the answers).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { contrast, over } from "../lookTokens.ts";
import type { RunPoint } from "../run.ts";
import { afterAnswer, feedbackLine, halfWidth, heroHeight, heroPlate, letterOf, nextTriviaPoint, pointsText, questionNumber, scoredCount, segments, starCards, stopwatch, TRIVIA, TRIVIA_SIZE, twoDigits } from "../triviaLook.ts";

const pt = (idx: number, o: Partial<RunPoint> = {}): RunPoint => ({ idx, id: `p${idx}`, name: `P${idx}`, value: 100, done: false, earned: 0, hidden: false, forbidden: false, ...o });

describe("the trivia look passes AA", () => {
  const sky = [TRIVIA.skyTop, TRIVIA.skyBottom];
  const card = over(TRIVIA.glass, TRIVIA.skyTop);
  it("ink and muted words on the sky and on a frosted card", () => {
    for (const bg of [...sky, card]) {
      assert.ok(contrast(TRIVIA.ink, bg) >= 7, `ink on ${bg}`);
      assert.ok(contrast(TRIVIA.muted, bg) >= 4.5, `muted on ${bg}`);
    }
  });
  it("the accent's small words on the sky, and white on the accent", () => {
    for (const bg of [...sky, card]) assert.ok(contrast(TRIVIA.accentText, bg) >= 4.5, `accent text on ${bg}`);
    assert.ok(contrast(TRIVIA.onAccent, TRIVIA.accent) >= 4.5);
  });
  it("a miss reads on a card", () => {
    assert.ok(contrast(TRIVIA.miss, over(TRIVIA.missSoft, card)) >= 4.5);
  });
  it("ink on every pastel character face", () => {
    for (const p of TRIVIA.pastel) assert.ok(contrast(TRIVIA.ink, p) >= 7, p);
  });
});

describe("the linear flow", () => {
  it("opens the questions in the server's order, skipping done and hidden ones", () => {
    const run = { points: [pt(3), pt(0, { done: true }), pt(1, { hidden: true }), pt(2), pt(5)] };
    assert.equal(nextTriviaPoint(run)?.idx, 2);
    assert.equal(nextTriviaPoint(run, 2)?.idx, 3);
    assert.equal(nextTriviaPoint(run, 5)?.idx, 2, "wraps round to one skipped earlier");
    assert.equal(nextTriviaPoint({ points: [pt(0, { done: true }), pt(1, { hidden: true })] }), null);
    assert.equal(nextTriviaPoint(null), null);
  });
  it("counts the question on screen after the ones played", () => {
    assert.deepEqual(questionNumber({ points: [pt(0, { done: true }), pt(1), pt(2)] }), { n: 2, total: 3 });
    assert.deepEqual(questionNumber({ points: [pt(0, { done: true })] }), { n: 1, total: 1 });
  });
  it("fills the segments from the left", () => {
    const run = { points: [pt(0), pt(1, { done: true }), pt(2), pt(3)] };
    assert.deepEqual(segments(run, 2), ["done", "now", "todo", "todo"]);
    assert.deepEqual(segments(run, null), ["done", "todo", "todo", "todo"]);
  });
});

describe("the words", () => {
  it("letters, counters and the clock", () => {
    assert.equal(letterOf(0), "A");
    assert.equal(letterOf(3), "D");
    assert.equal(twoDigits(6), "06");
    assert.equal(twoDigits(10), "10");
    assert.equal(stopwatch(20), "00:20");
    assert.equal(stopwatch(65.2), "01:06");
    assert.equal(stopwatch(-3), "00:00");
  });
  it("the line under the answers", () => {
    assert.deepEqual(feedbackLine({ late: false, earned: 200, correct: 1, total: 1 }, "Cherries"), { tone: "right", text: "Correct! Cherries it is." });
    assert.equal(feedbackLine({ late: false, earned: 0, correct: 0, total: 1 }, "Apples").tone, "miss");
    assert.ok(!feedbackLine({ late: false, earned: 0, correct: 0, total: 1 }, "Apples").text.includes("Apples"), "a miss never names the pick as the answer");
    assert.equal(feedbackLine({ late: true, earned: 0, correct: 0, total: 1 }, null).tone, "late");
    assert.equal(feedbackLine({ late: false, earned: 90, correct: 3, total: 5 }, null).text, "3 of 5 right.");
    assert.equal(feedbackLine({ late: false, earned: 300, correct: 5, total: 5 }, null).text, "All 5 right!");
  });
});

describe("Wale's measurements and the real data in his slots", () => {
  it("the hero band is his 213 pt on his phone and shrinks on a short one", () => {
    assert.equal(heroHeight(852), 213);
    assert.equal(heroHeight(932), 213);
    assert.equal(heroHeight(667), 167);
    assert.equal(heroHeight(400), TRIVIA_SIZE.heroMin);
  });
  it("two answer cards and their gap fill the page between the margins", () => {
    const w = halfWidth(393, TRIVIA_SIZE.answerGap);
    assert.equal(w, 167);
    assert.ok(2 * w + TRIVIA_SIZE.answerGap <= 393 - 2 * TRIVIA_SIZE.pad);
    assert.equal(halfWidth(1200, 16), halfWidth(560, 16));
  });
  it("the plate names the realm by its faction name, never an old label", () => {
    // A topic, never a faction (Mark, 14 Nov): an old server's realm on the tile is not shown.
    assert.equal(heroPlate({ topic: "film", topic_name: "Film" }), "FILM");
    assert.equal(heroPlate({ realm: "marvel" } as never), "DAILY TRIVIA");
    assert.equal(heroPlate({}), "DAILY TRIVIA");
  });
  it("after an answer: next question, the board when only a hidden bonus is left, else the score", () => {
    assert.equal(afterAnswer({ points: [pt(0, { done: true }), pt(1)], finished: false }, 0), "next");
    assert.equal(afterAnswer({ points: [pt(0, { done: true }), pt(1, { hidden: true })], finished: false }, 0), "board");
    assert.equal(afterAnswer({ points: [pt(0, { done: true }), pt(1, { done: true })], finished: false }, 1), "score");
    assert.equal(afterAnswer({ points: [pt(0), pt(1)], finished: true }, 0), "score");
    assert.equal(afterAnswer(null, 0), "score");
  });
  it("scored on n: only questions that paid", () => {
    assert.equal(scoredCount({ points: [pt(0, { done: true, earned: 100 }), pt(1, { done: true }), pt(2)] }), 1);
  });
  it("the four start cards are today's top four, padded with open spots", () => {
    const e = (place: number, you = false) => ({ place, handle: `h${place}`, score: 1000 - place, points_done: 10, you });
    assert.deepEqual(starCards(null), [null, null, null, null]);
    const two = starCards({ entries: [e(1), e(2, true)] });
    assert.deepEqual(two[1], { place: 2, handle: "h2", score: 998, you: true });
    assert.equal(two[2], null);
    assert.equal(starCards({ entries: [1, 2, 3, 4, 5, 6].map((n) => e(n)) }).length, 4);
  });
  it("points read with a thousands comma", () => {
    assert.equal(pointsText(1240), "1,240 pts");
    assert.equal(pointsText(1), "1 pt");
  });
});
