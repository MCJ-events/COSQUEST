/**
 * Faction ranks: the ladder and "what rank is this person".
 *
 * Rank is visual only (a badge beside the name). It comes from the user's
 * points (User.pointsBalance), unless an orchestrator set it by hand
 * (User.rankOverride = a ladder key), in which case it carries
 * `overridden: true`.
 *
 * The whole ladder can be replaced without a code change with the env var
 * RANKS_JSON: a JSON array of { key, name, short?, level?, chevrons?, bars?,
 * star?, minPoints }. A bad RANKS_JSON is logged and the default ladder is used.
 *
 * GET /api/ranks returns the full ladder (with minPoints); message senders and
 * member lists carry the person's rank without minPoints.
 */

// PLACEHOLDER point levels (minPoints): awaiting Mark Jones's real ladder.
// Names and insignia are agreed; only the minPoints numbers are guesses.
const DEFAULT_LADDER = [
  { key: 'private', name: 'Private', short: 'PVT', level: 1, chevrons: 1, bars: 0, star: false, minPoints: 0 },
  { key: 'corporal', name: 'Corporal', short: 'CPL', level: 2, chevrons: 2, bars: 0, star: false, minPoints: 500 },
  { key: 'sergeant', name: 'Sergeant', short: 'SGT', level: 3, chevrons: 3, bars: 0, star: false, minPoints: 1500 },
  { key: 'staff_sergeant', name: 'Staff Sergeant', short: 'SSG', level: 4, chevrons: 3, bars: 1, star: false, minPoints: 3500 },
  { key: 'lieutenant', name: 'Lieutenant', short: 'LT', level: 5, chevrons: 0, bars: 1, star: false, minPoints: 7000 },
  { key: 'captain', name: 'Captain', short: 'CPT', level: 6, chevrons: 0, bars: 2, star: false, minPoints: 12000 },
  { key: 'major', name: 'Major', short: 'MAJ', level: 7, chevrons: 0, bars: 0, star: true, minPoints: 20000 },
  { key: 'commander', name: 'Commander', short: 'CDR', level: 8, chevrons: 0, bars: 1, star: true, minPoints: 35000 },
];

function count(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

// One RANKS_JSON entry -> a full rank, or null if it is unusable.
function normalize(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const key = typeof entry.key === 'string' ? entry.key.trim() : '';
  const name = typeof entry.name === 'string' ? entry.name.trim() : '';
  const minPoints = Number(entry.minPoints);
  if (!key || !name || !Number.isFinite(minPoints) || minPoints < 0) return null;
  return {
    key,
    name,
    short: typeof entry.short === 'string' && entry.short.trim() ? entry.short.trim() : name.slice(0, 3).toUpperCase(),
    level: Number.isInteger(entry.level) && entry.level > 0 ? entry.level : null,
    chevrons: count(entry.chevrons),
    bars: count(entry.bars),
    star: entry.star === true,
    minPoints,
  };
}

// Lowest rung first, levels 1..n when not given.
function parseLadder(raw) {
  let list;
  try {
    list = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(list) || !list.length) return null;
  const ranks = list.map(normalize);
  if (ranks.some((rank) => !rank)) return null;
  if (new Set(ranks.map((rank) => rank.key)).size !== ranks.length) return null;
  ranks.sort((a, b) => a.minPoints - b.minPoints);
  if (ranks[0].minPoints !== 0) return null; // everyone needs a rank
  return ranks.map((rank, index) => ({ ...rank, level: rank.level || index + 1 }));
}

let cached = { raw: undefined, ladder: DEFAULT_LADDER };

/** The ladder, lowest rank first (RANKS_JSON if set and valid, else the default). */
function getLadder() {
  const raw = process.env.RANKS_JSON || '';
  if (raw === cached.raw) return cached.ladder;
  let ladder = DEFAULT_LADDER;
  if (raw) {
    const parsed = parseLadder(raw);
    if (parsed) ladder = parsed;
    else console.warn('[ranks] RANKS_JSON is not a valid rank list (needs key, name, minPoints; one rank at 0 points) - using the default ladder.');
  }
  cached = { raw, ladder };
  return ladder;
}

function publicRank(rank, overridden) {
  const { minPoints, ...rest } = rank;
  return overridden ? { ...rest, overridden: true } : rest;
}

/**
 * A user's rank, for previews: { key, name, short, level, chevrons, bars, star }
 * (+ overridden: true when set by hand). Needs `pointsBalance` and
 * `rankOverride` on the user document (see SENDER_FIELDS in chatController).
 */
function rankFor(user) {
  if (!user) return null;
  const ladder = getLadder();
  if (user.rankOverride) {
    const manual = ladder.find((rank) => rank.key === user.rankOverride);
    if (manual) return publicRank(manual, true);
  }
  const points = Number(user.pointsBalance) || 0;
  let current = ladder[0];
  for (const rank of ladder) if (rank.minPoints <= points) current = rank;
  return publicRank(current, false);
}

module.exports = { DEFAULT_LADDER, getLadder, rankFor, parseLadder };
