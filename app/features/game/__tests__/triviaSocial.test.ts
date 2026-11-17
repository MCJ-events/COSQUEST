// Trivia's social side (16 Nov 2026, Mark: trivia pulls people in from social media and works on
// its own as a social hub): the board as a share card, the caption of a run posted to the feed, and
// which feed posts get a Play trivia button.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { boardShareCard, boardShareText, feedCaption, shareFileName, triviaLinkIn } from "../triviaVisual.ts";

const PROD = "https://costquest.204.168.162.79.sslip.io";
const STG = "https://costquest-staging.204.168.162.79.sslip.io";

describe("the board as a share card", () => {
  it("says your place when you are on it, the open question when not, and never a faction", () => {
    assert.equal(boardShareText({ place: 3 }), "I'm #3 on today's CosQuest trivia board. Can you beat it?");
    assert.equal(boardShareText({ place: 1204, approx: true }), "I'm about #1,204 on today's CosQuest trivia board. Can you beat it?");
    assert.equal(boardShareText(null), "Today's CosQuest trivia board. Can you make it?");
    assert.equal(boardShareText({ place: 0 }), "Today's CosQuest trivia board. Can you make it?");
  });
  it("is only offered when the server drew one (its flag is on), one id a day", () => {
    assert.equal(boardShareCard({ day: "2026-11-16" }, `${PROD}/trivia`), null);
    assert.equal(boardShareCard({ day: "2026-11-16", card_url: null }, `${PROD}/trivia`), null);
    const c = boardShareCard({ day: "2026-11-16", card_url: `${STG}/v1/trivia/board/card.png?day=2026-11-16`, you: { place: 2 } }, `${STG}/trivia`);
    assert.deepEqual(c, { id: "board-2026-11-16", url: `${STG}/trivia`, image_url: `${STG}/v1/trivia/board/card.png?day=2026-11-16`, text: "I'm #2 on today's CosQuest trivia board. Can you beat it?" });
    assert.equal(shareFileName(c!.id, "board"), "cosquest-board-board-2026-11-16.png");
  });
});

describe("a run posted to the feed", () => {
  it("carries the run's line, its link once and the tag once", () => {
    assert.equal(feedCaption("Ada scored 1,240 in CosQuest trivia.", `${PROD}/share/abc12345`), `Ada scored 1,240 in CosQuest trivia. ${PROD}/share/abc12345 #CosQuestTrivia`);
    assert.equal(feedCaption(`Ada scored. ${PROD}/share/abc12345`, `${PROD}/share/abc12345`), `Ada scored. ${PROD}/share/abc12345 #CosQuestTrivia`);
    assert.equal(feedCaption("x #CosQuestTrivia", ""), "x #CosQuestTrivia");
  });
});

describe("which feed posts are trivia", () => {
  const servers = [PROD, STG, `${PROD}/play/trivia`];
  it("finds a shared run, a shared question, the trivia and play pages on our servers", () => {
    assert.equal(triviaLinkIn(`Beat me! ${PROD}/share/abc12345 #CosQuestTrivia`, servers), `${PROD}/share/abc12345`);
    assert.equal(triviaLinkIn(`${STG}/share/q/xyz98765.`, servers), `${STG}/share/q/xyz98765`);
    assert.equal(triviaLinkIn(`Play: ${PROD}/play/trivia`, servers), `${PROD}/play/trivia`);
    assert.equal(triviaLinkIn(`${PROD}/trivia`, servers), `${PROD}/trivia`);
  });
  it("ignores other sites, other paths on our servers, broken links and empty posts", () => {
    assert.equal(triviaLinkIn("https://example.com/share/abc12345", servers), null);
    assert.equal(triviaLinkIn(`${PROD}/v1/coins/history`, servers), null);
    assert.equal(triviaLinkIn(`${PROD}/trivial-thing`, servers), null);
    assert.equal(triviaLinkIn("no links here", servers), null);
    assert.equal(triviaLinkIn(null, servers), null);
    assert.equal(triviaLinkIn(`${PROD}/share/abc`, ["not a url"]), null);
  });
});
