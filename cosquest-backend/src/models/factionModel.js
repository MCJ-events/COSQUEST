const FACTIONS = [
  {
    key: 'ascendants',
    name: 'Ascendants',
    color: '#8B5CF6',
    description: 'Ambitious challengers who rise through courage, growth, and relentless determination.',
  },
  {
    key: 'icons',
    name: 'Icons',
    color: '#EC4899',
    description: 'Bold trendsetters whose creativity, presence, and style leave a lasting mark.',
  },
  {
    key: 'controllers',
    name: 'Controllers',
    color: '#06B6D4',
    description: 'Calculated strategists who master every challenge through skill, focus, and precision.',
  },
  {
    key: 'blockbusters',
    name: 'Blockbusters',
    color: '#F97316',
    description: 'Big-energy adventurers who thrive on action, spectacle, and unforgettable moments.',
  },
  {
    key: 'everborns',
    name: 'Everborns',
    color: '#22C55E',
    description: 'Resilient spirits who adapt, endure, and return stronger after every challenge.',
  },
  {
    key: 'celestials',
    name: 'Celestials',
    color: '#EAB308',
    description: 'Visionary explorers drawn to discovery, imagination, and limitless possibilities.',
  },
];

const FACTION_KEYS = FACTIONS.map((f) => f.key);

function isValidFactionKey(key) {
  return FACTION_KEYS.includes(key);
}

function getFaction(key) {
  return FACTIONS.find((f) => f.key === key) || null;
}

module.exports = { FACTIONS, FACTION_KEYS, isValidFactionKey, getFaction };
