// The game's rules: the fixed, authored rulebook the Rules sheet shows
// (components/game/RulesSheet.tsx). The rules are costquest-ios
// Game/Warden.swift's rulebook, word for word. Build 24 replaced "Ask the
// Warden" with this: no model, no download, nothing spoken, just the rules.
// Pure: no React Native imports (tested in __tests__/rules.test.ts).

export type Rule = { topic: string; text: string };

/** The rulebook, rule for rule (Warden.rulebook). */
export const RULEBOOK: Rule[] = [
  {
    topic: "Cooldown",
    text: "Hits have a cooldown. A hit made before the cooldown has finished is refused. That is the rule working, not a fault.",
  },
  {
    topic: "Friendly fire",
    text: "You cannot hit a player on your own side. That is refused as friendly fire.",
  },
  {
    topic: "Range",
    text: "A hit beyond the game's range limit is refused. The phones measure the range and the server checks it.",
  },
  {
    topic: "Weapons",
    text: "You must be carrying a weapon before you can hit anyone. Weapons are picked up at marked points on the field.",
  },
  {
    topic: "Scoring",
    text: "Tokens are the score. You take them from players on other sides by hitting them, by capturing points, and by answering trivia at the marked stops.",
  },
  {
    topic: "Being downed",
    text: "Losing all your tokens puts you down. The server holds the respawn timer and lets you back in when it has run.",
  },
  {
    topic: "The venue boundary",
    text: "Everything must happen inside the venue. Anything reported from outside the boundary is refused.",
  },
  {
    topic: "Trivia",
    text: "Each trivia stop is answered once. The server marks the answer; the phone never knows which choice was right.",
  },
];

/** Above the rules: who decides. */
export const RULES_LEAD = "The server judges every action and its record is final.";
