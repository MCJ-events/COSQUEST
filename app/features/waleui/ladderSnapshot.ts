// A snapshot of the weapon ladder and ranks from the game server's seed
// (costquest-backend app/progression_seed.json, branch build21-faction-names,
// read 11 Nov 2026). The Armory shows the server's own ladder whenever it
// answers (features/waleui/armory.ts); this copy is only the offline fallback,
// so the screen never falls back to the mock-up names in Wale's Figma
// (Speedshot, Hornbow...). Every number on the server is a draft the team
// edits through the admin API, so nothing here is a price or a threshold a
// player is charged against. Regenerate from the seed when the names change.
//
// Build 30 (release checklist section 3): ten names that echo other companies' characters or
// props are renamed here, the offline fallback, pending Wale's approval; the live names come from
// the server and are changed there through the admin API (cosquest-review/release-fixes-30):
//   Mutation Claw > Riftfang Claw, War-Suit Mk II > Bulwark Frame Mk II, Psi-Edge Blade > Mindglass Blade,
//   World-Breaker Fists > Quakeforge Fists (icons); Levitation Cloak > Driftweave Cloak, Elderwood Phoenix
//   Wand > Emberroot Wand (everborns); Sandwalker Crysblade > Duneglass Sabre (celestials); Adamant Claws >
//   Ironbark Talons, Willpower Signet Ring > Oathstone Signet, Web-Sling Gauntlets > Skyhook Gauntlets (blockbusters).
import type { ProgRank, ProgWeapon } from "../game/progression.ts";

export const SNAPSHOT_FACTIONS: { id: string; name: string }[] = [{"id": "ascendants", "name": "Ascendants"}, {"id": "controllers", "name": "Controllers"}, {"id": "icons", "name": "Icons"}, {"id": "everborns", "name": "Everborns"}, {"id": "celestials", "name": "Celestials"}, {"id": "blockbusters", "name": "Blockbusters"}];

export const SNAPSHOT_RANKS: ProgRank[] = [
  {"number": 1, "name": "Initiate", "xp_threshold": 0, "pass_mark_pct": null, "test_kind": "entry", "weapon_tier": 0},
  {"number": 2, "name": "Disciple", "xp_threshold": 500, "pass_mark_pct": 70, "test_kind": "rank", "weapon_tier": 1},
  {"number": 3, "name": "Awakened", "xp_threshold": 1500, "pass_mark_pct": 75, "test_kind": "rank", "weapon_tier": 2},
  {"number": 4, "name": "Elite", "xp_threshold": 3500, "pass_mark_pct": 80, "test_kind": "rank", "weapon_tier": 3},
  {"number": 5, "name": "Champion", "xp_threshold": 7000, "pass_mark_pct": 82, "test_kind": "rank", "weapon_tier": 4},
  {"number": 6, "name": "Commander", "xp_threshold": 13000, "pass_mark_pct": 85, "test_kind": "rank", "weapon_tier": 5},
  {"number": 7, "name": "Sovereign", "xp_threshold": 23000, "pass_mark_pct": 88, "test_kind": "rank", "weapon_tier": 6},
  {"number": 8, "name": "Transcendent", "xp_threshold": 38000, "pass_mark_pct": 90, "test_kind": "rank", "weapon_tier": 7},
  {"number": 9, "name": "Omega", "xp_threshold": 60000, "pass_mark_pct": 93, "test_kind": "rank", "weapon_tier": 8},
  {"number": 10, "name": "Eternal", "xp_threshold": 90000, "pass_mark_pct": 95, "test_kind": "eternal_gauntlet", "weapon_tier": 9},
];

export const SNAPSHOT_WEAPONS: ProgWeapon[] = [
  {"id": "ascendants-t0", "faction": "ascendants", "tier": 0, "tier_label": "Starter", "name": "Ember Dagger", "cc_price": null, "starter": true, "account_bound_capstone": false},
  {"id": "ascendants-t1", "faction": "ascendants", "tier": 1, "tier_label": "Standard", "name": "Void Kunai", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "ascendants-t2", "faction": "ascendants", "tier": 2, "tier_label": "Standard", "name": "Frostbrand Blade", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "ascendants-t3", "faction": "ascendants", "tier": 3, "tier_label": "Rare", "name": "Stormfang Twin Katanas", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "ascendants-t4", "faction": "ascendants", "tier": 4, "tier_label": "Signature", "name": "Inferno Katana", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "ascendants-t5", "faction": "ascendants", "tier": 5, "tier_label": "Elder", "name": "Spiritbound Tanto", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "ascendants-t6", "faction": "ascendants", "tier": 6, "tier_label": "Ascended", "name": "Eightfold Elemental Fan", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "ascendants-t7", "faction": "ascendants", "tier": 7, "tier_label": "Exalted", "name": "Dragonveil Naginata", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "ascendants-t8", "faction": "ascendants", "tier": 8, "tier_label": "Mythic", "name": "Aether Wings", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "ascendants-t9", "faction": "ascendants", "tier": 9, "tier_label": "Eternal", "name": "Ascendant Overdrive Form", "cc_price": null, "starter": false, "account_bound_capstone": true},
  {"id": "controllers-t0", "faction": "controllers", "tier": 0, "tier_label": "Starter", "name": "Recruit Sidearm", "cc_price": null, "starter": true, "account_bound_capstone": false},
  {"id": "controllers-t1", "faction": "controllers", "tier": 1, "tier_label": "Standard", "name": "Precision Rifle", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "controllers-t2", "faction": "controllers", "tier": 2, "tier_label": "Standard", "name": "Tactical Crossbow", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "controllers-t3", "faction": "controllers", "tier": 3, "tier_label": "Rare", "name": "Critical-Strike Dual Blasters", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "controllers-t4", "faction": "controllers", "tier": 4, "tier_label": "Signature", "name": "Guardian Shield", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "controllers-t5", "faction": "controllers", "tier": 5, "tier_label": "Elder", "name": "Overclocked Railgun", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "controllers-t6", "faction": "controllers", "tier": 6, "tier_label": "Ascended", "name": "Stealth-Field Cloak", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "controllers-t7", "faction": "controllers", "tier": 7, "tier_label": "Exalted", "name": "Auto-Turret Deployable", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "controllers-t8", "faction": "controllers", "tier": 8, "tier_label": "Mythic", "name": "Overwatch Drone Array", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "controllers-t9", "faction": "controllers", "tier": 9, "tier_label": "Eternal", "name": "Apex Command Exosuit", "cc_price": null, "starter": false, "account_bound_capstone": true},
  {"id": "icons-t0", "faction": "icons", "tier": 0, "tier_label": "Starter", "name": "Iron Knuckles", "cc_price": null, "starter": true, "account_bound_capstone": false},
  {"id": "icons-t1", "faction": "icons", "tier": 1, "tier_label": "Standard", "name": "Adaptive Gauntlet", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "icons-t2", "faction": "icons", "tier": 2, "tier_label": "Standard", "name": "Genius Tech Blaster", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "icons-t3", "faction": "icons", "tier": 3, "tier_label": "Rare", "name": "Riftfang Claw", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "icons-t4", "faction": "icons", "tier": 4, "tier_label": "Signature", "name": "Titan Golem", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "icons-t5", "faction": "icons", "tier": 5, "tier_label": "Elder", "name": "Bulwark Frame Mk II", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "icons-t6", "faction": "icons", "tier": 6, "tier_label": "Ascended", "name": "Mindglass Blade", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "icons-t7", "faction": "icons", "tier": 7, "tier_label": "Exalted", "name": "Quakeforge Fists", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "icons-t8", "faction": "icons", "tier": 8, "tier_label": "Mythic", "name": "Omega Exo-Suit", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "icons-t9", "faction": "icons", "tier": 9, "tier_label": "Eternal", "name": "Legacy Armor", "cc_price": null, "starter": false, "account_bound_capstone": true},
  {"id": "everborns-t0", "faction": "everborns", "tier": 0, "tier_label": "Starter", "name": "Apprentice Wand", "cc_price": null, "starter": true, "account_bound_capstone": false},
  {"id": "everborns-t1", "faction": "everborns", "tier": 1, "tier_label": "Standard", "name": "Runeblade", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "everborns-t2", "faction": "everborns", "tier": 2, "tier_label": "Standard", "name": "Bloodline Sigil Staff", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "everborns-t3", "faction": "everborns", "tier": 3, "tier_label": "Rare", "name": "Ancient Grimoire", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "everborns-t4", "faction": "everborns", "tier": 4, "tier_label": "Signature", "name": "Mystic Essence Scythe", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "everborns-t5", "faction": "everborns", "tier": 5, "tier_label": "Elder", "name": "Driftweave Cloak", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "everborns-t6", "faction": "everborns", "tier": 6, "tier_label": "Ascended", "name": "Ringbound Sigil", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "everborns-t7", "faction": "everborns", "tier": 7, "tier_label": "Exalted", "name": "Portal Key", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "everborns-t8", "faction": "everborns", "tier": 8, "tier_label": "Mythic", "name": "Bloodline Awakening Relic", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "everborns-t9", "faction": "everborns", "tier": 9, "tier_label": "Eternal", "name": "Emberroot Wand", "cc_price": null, "starter": false, "account_bound_capstone": true},
  {"id": "celestials-t0", "faction": "celestials", "tier": 0, "tier_label": "Starter", "name": "Cadet Plasma Pistol", "cc_price": null, "starter": true, "account_bound_capstone": false},
  {"id": "celestials-t1", "faction": "celestials", "tier": 1, "tier_label": "Standard", "name": "Photon Blade", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "celestials-t2", "faction": "celestials", "tier": 2, "tier_label": "Standard", "name": "Gravity Gauntlets", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "celestials-t3", "faction": "celestials", "tier": 3, "tier_label": "Rare", "name": "Nova Cannon", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "celestials-t4", "faction": "celestials", "tier": 4, "tier_label": "Signature", "name": "Starforge Lance", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "celestials-t5", "faction": "celestials", "tier": 5, "tier_label": "Elder", "name": "Drift-Runner Blaster", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "celestials-t6", "faction": "celestials", "tier": 6, "tier_label": "Ascended", "name": "Duneglass Sabre", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "celestials-t7", "faction": "celestials", "tier": 7, "tier_label": "Exalted", "name": "Warp-Vambraces", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "celestials-t8", "faction": "celestials", "tier": 8, "tier_label": "Mythic", "name": "Singularity Core", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "celestials-t9", "faction": "celestials", "tier": 9, "tier_label": "Eternal", "name": "Celestial Ascension Armor", "cc_price": null, "starter": false, "account_bound_capstone": true},
  {"id": "blockbusters-t0", "faction": "blockbusters", "tier": 0, "tier_label": "Starter", "name": "Stunt Blade", "cc_price": null, "starter": true, "account_bound_capstone": false},
  {"id": "blockbusters-t1", "faction": "blockbusters", "tier": 1, "tier_label": "Standard", "name": "Grapple-Line Gauntlet", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "blockbusters-t2", "faction": "blockbusters", "tier": 2, "tier_label": "Standard", "name": "Riot Aegis Shield", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "blockbusters-t3", "faction": "blockbusters", "tier": 3, "tier_label": "Rare", "name": "Storm Warhammer", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "blockbusters-t4", "faction": "blockbusters", "tier": 4, "tier_label": "Signature", "name": "Solar Flight Cape", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "blockbusters-t5", "faction": "blockbusters", "tier": 5, "tier_label": "Elder", "name": "Ironbark Talons", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "blockbusters-t6", "faction": "blockbusters", "tier": 6, "tier_label": "Ascended", "name": "Oathstone Signet", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "blockbusters-t7", "faction": "blockbusters", "tier": 7, "tier_label": "Exalted", "name": "Skyhook Gauntlets", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "blockbusters-t8", "faction": "blockbusters", "tier": 8, "tier_label": "Mythic", "name": "Legend Reel", "cc_price": null, "starter": false, "account_bound_capstone": false},
  {"id": "blockbusters-t9", "faction": "blockbusters", "tier": 9, "tier_label": "Eternal", "name": "Blockbuster Cannon", "cc_price": null, "starter": false, "account_bound_capstone": true},
];
