// Build 29 (fid29 combat): the Credits screen owes every CC-BY source the shipped motion comes from.
// Text checks (the screen imports react-native, which node --test cannot load): every "- Credit:" line of
// docs/game3d/fid29/ASSETS-LICENCES-combat.md is on CreditsScreen.tsx word for word, and Settings > Credits opens it
// instead of the old "not built yet" notice.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, "..", "..", "..");
const read = (p: string): string => readFileSync(join(app, p), "utf8");

function creditLines(md: string): string[] {
  return md
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- Credit:"))
    .map((l) => l.slice("- Credit:".length).trim().replace(/^"|"$/g, ""));
}

test("credits: every CC-BY source in the licence file is on the Credits screen", () => {
  const lines = creditLines(read("../docs/game3d/fid29/ASSETS-LICENCES-combat.md"));
  const screen = read("components/waleui/CreditsScreen.tsx");
  assert.ok(lines.length >= 2, `credit lines found: ${lines.length}`);
  for (const l of lines) assert.ok(screen.includes(l), `missing on the Credits screen: ${l}`);
});

test("credits: the exact CC BY 4.0 wording for the Cologne database and 100STYLE, and the CMU courtesy line", () => {
  const screen = read("components/waleui/CreditsScreen.tsx");
  assert.ok(screen.includes("Motion data from the Cologne Motion Capture Database by TH Köln (University of Applied Sciences), CC BY 4.0. Retargeted and edited."));
  assert.ok(screen.includes("The 100STYLE Dataset - Ian Mason, CC BY 4.0. Retargeted and edited."));
  assert.ok(screen.includes("mocap.cs.cmu.edu"));
  assert.ok(screen.includes("creativecommons.org/licenses/by/4.0"));
});

test("credits: Settings > Credits opens the Credits screen (no longer \"not built yet\")", () => {
  const settings = read("components/waleui/SettingsScreen.tsx");
  assert.ok(!settings.includes("notBuiltYet(\"Credits\")"));
  assert.ok(settings.includes("import CreditsScreen from \"./CreditsScreen\""));
  assert.match(settings, /l\.id === "credits" \? \(\) => setCredits\(true\)/);
  assert.match(settings, /<CreditsScreen onClose=/);
});

test("credits: the game data names the same credits as the screen", () => {
  const data = JSON.parse(read("game3d/data/anim_real.json")) as { credits: string[] };
  const screen = read("components/waleui/CreditsScreen.tsx");
  for (const c of data.credits) assert.ok(screen.includes(c), `anim_real.json credit missing on the screen: ${c}`);
});
