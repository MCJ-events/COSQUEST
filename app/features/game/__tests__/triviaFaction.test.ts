// Trivia for your faction (features/game/triviaFaction.ts): app only, the faction board lines and share card,
// and the online psychoanimus meter's lines and claim button.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { claimLabel, factionLine, factionShareCard, factionTriviaShown, type FactionBoard, meterLine, myMeter, type Psychoanimus, weightLine, youLine } from "../triviaFaction.ts";

const rows = [
  { faction: "anime", name: "Ascendants", total: 1240, players: 3, place: 1 },
  { faction: "gaming", name: "Controllers", total: 300, players: 1, place: 2 },
];
const board = (you: FactionBoard["you"], extra: Partial<FactionBoard> = {}): FactionBoard => ({ period: "today", from: "2026-11-17", to: "2026-11-17", season: null, factions: rows, you, ...extra });

describe("where faction trivia shows", () => {
  it("is in the app on phones and never on the web page", () => {
    assert.equal(factionTriviaShown("ios"), true);
    assert.equal(factionTriviaShown("android"), true);
    assert.equal(factionTriviaShown("web"), false);
    assert.equal(factionTriviaShown("windows"), false);
  });
});

describe("the faction board", () => {
  it("says points and players", () => {
    assert.equal(factionLine(rows[0]), "1,240 pts · 3 players");
    assert.equal(factionLine(rows[1]), "300 pts · 1 player");
  });
  it("asks a player with no faction to pick one, and tells the rest what they added", () => {
    assert.equal(youLine(board({ faction: null, name: null, contributed: 0, needs_faction: true })), "Pick a faction and your trivia score counts for it.");
    assert.equal(youLine(board({ faction: "anime", name: "Ascendants", contributed: 410, needs_faction: false })), "You added 410 pts to Ascendants today.");
    assert.equal(youLine(board({ faction: "gaming", name: "Controllers", contributed: 0, needs_faction: false }, { period: "week" })), "Play today's trivia to add to Controllers.");
    assert.equal(youLine(board(null)), null);
  });
  it("shares as a card only when the server draws one, naming your faction's place", () => {
    assert.equal(factionShareCard(board(null), "https://s/trivia"), null);
    const mine = factionShareCard(board({ faction: "gaming", name: "Controllers", contributed: 300, needs_faction: false }, { card_url: "https://s/card.png" }), "https://s/trivia");
    assert.deepEqual(mine, { id: "factions-today-2026-11-17", url: "https://s/trivia", image_url: "https://s/card.png", text: "Controllers is #2 in CosQuest trivia today. Play for your faction." });
    const lead = factionShareCard(board(null, { card_url: "u", period: "season" }), "l");
    assert.equal(lead?.text, "Ascendants leads CosQuest trivia this season. Play for your faction.");
  });
});

describe("the online psychoanimus meter", () => {
  const meter = (participants: number, unlocked: boolean[], next: { players_needed: number } | null) => ({
    faction: "anime", name: "Ascendants", participants, value: participants * 0.5, max: 30, fill: 0.1,
    tiers: [
      { id: "t1", at: 5, label: "An early story piece", detail: "", xp: 15, story_slot: "early-story-1", unlocked: unlocked[0] },
      { id: "t2", at: 15, label: "Bonus XP", detail: "", xp: 30, story_slot: null, unlocked: unlocked[1] },
    ],
    next: next ? { id: "t2", at: 15, label: "Bonus XP", ...next } : null,
  });
  it("says how many played and how many more open the next reward", () => {
    assert.equal(meterLine(meter(12, [true, false], { players_needed: 18 })), "12 players today · 18 more for bonus xp (1 open)");
    assert.equal(meterLine({ ...meter(1, [false, false], null), next: { id: "t1", at: 5, label: "An early story piece", players_needed: 9 } }), "1 player today · 9 more for an early story piece");
    assert.equal(meterLine(meter(80, [true, true], null)), "80 players today · every reward open");
  });
  it("says online weighs less than in person", () => {
    assert.equal(weightLine({ weight_online: 0.5, weight_in_person: 1 }), "Playing online fills it at 50% of being there in person.");
    assert.equal(weightLine({ weight_online: 0.5, weight_in_person: 0 }), "");
  });
  it("offers the claim only after you played, with what it pays", () => {
    const p = (you: Psychoanimus["you"]): Psychoanimus => ({ day: "2026-11-17", weight_online: 0.5, weight_in_person: 1, note: "", meters: [meter(12, [true, true], null)], you });
    assert.equal(claimLabel(p({ faction: "anime", played_today: true, claimed: [], claimable: ["t1", "t2"], needs_faction: false })), "Claim +45 XP");
    assert.equal(claimLabel(p({ faction: "anime", played_today: true, claimed: ["t1"], claimable: ["t2"], needs_faction: false })), "Claim +30 XP");
    assert.equal(claimLabel(p({ faction: "anime", played_today: false, claimed: [], claimable: [], needs_faction: false })), null);
    assert.equal(claimLabel(p({ faction: null, played_today: false, claimed: [], claimable: [], needs_faction: true })), null);
    assert.equal(myMeter(p({ faction: "anime", played_today: true, claimed: [], claimable: [], needs_faction: false }))?.name, "Ascendants");
    assert.equal(myMeter(p(null)), null);
  });
});
