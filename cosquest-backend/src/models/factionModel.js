/**
 * "none" (Factionless) is also a valid, selectable value in the front-end
 * (see the extra .fac[data-fac="none"] card in the onboarding markup) but
 * is kept out of this list since it is not a real faction record.
 */
const FACTIONS = [
  {
    key: 'marvel',
    name: 'Marvel',
    color: '#ED1D24',
    description: 'Web-slingers, mutants, and cosmic heroes — bold, witty, and always ready for a team-up.',
  },
  {
    key: 'dc',
    name: 'DC',
    color: '#0078F0',
    description: 'Gotham to Krypton — dark, epic, and larger than life. Justice never sleeps.',
  },
  {
    key: 'anime',
    name: 'Anime Realm',
    color: '#EC4899',
    description: 'Manga & anime devotees — disciplined, dramatic, and endlessly creative.',
  },
];

const FACTION_KEYS = FACTIONS.map((f) => f.key);

function isValidFactionKey(key) {
  return key === 'none' || FACTION_KEYS.includes(key);
}

function getFaction(key) {
  return FACTIONS.find((f) => f.key === key) || null;
}

module.exports = { FACTIONS, FACTION_KEYS, isValidFactionKey, getFaction };
