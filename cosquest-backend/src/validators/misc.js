// Request rules for the small routers: quests, factions, spotlight, interests
// and expertise (see src/middleware/validate.js). Messages match the
// controllers' own, so the app sees the same answers.
const { array, field, objectId, scalarQuery, fail } = require('../middleware/validate');
const common = require('./common');
const { isValidFactionKey } = require('../models/factionModel');
const { isValidInterestKey } = require('../models/interestModel');
const { isValidExpertise } = require('../models/expertiseModel');

// A malformed quest id answers as an unknown one does on that route (it used
// to reach Mongoose and fail with a 500).
const questId = (answer) => objectId('questId', { in: 'param', message: answer });

// GET /api/quests?lat=&lng=&radiusMiles=&status=&faction=&limit=. The numbers
// are checked by the controller; here they must be single values.
const coordinates = 'lat, lng, and radiusMiles must be valid numbers.';
const listQuests = [
  ...['lat', 'lng', 'radiusMiles'].map((name) => field(name, { in: 'query' }).isString().withMessage(coordinates)),
  ...scalarQuery('status', 'faction'),
  common.paging(),
];

// GET /api/leaderboard?interest=&page=&limit= - the controller refuses bad
// values; a repeated ?page= used to be read as its first value.
const pageLimit = 'page must be 1-1000 and limit must be 1-100.';
const inRange = (max) => (v) => {
  const number = Number(v || 1);
  return typeof v === 'string' && Number.isInteger(number) && number >= 1 && number <= max;
};
const leaderboard = [
  field('interest', { in: 'query' }).custom(isValidInterestKey).withMessage('Unknown interest. See GET /api/interests.'),
  field('page', { in: 'query' }).custom(inRange(1000)).withMessage(pageLimit),
  field('limit', { in: 'query' }).custom(inRange(100)).withMessage(pageLimit),
];

// PUT /api/users/me/interests { interests: [keys] }
const setInterests = [
  array('interests', { required: true, max: 50, message: 'interests must be an array of interest keys.' }).bail()
    .custom((v) => v.every(isValidInterestKey))
    .withMessage((v) => `Unknown interest key(s): ${v.filter((k) => !isValidInterestKey(k)).join(', ')}`),
];

// PATCH /api/expertise/me { expertise: key | null }
const setExpertise = [
  field('expertise', { required: true, nullable: true }).withMessage('Send expertise: a role key, or null to clear it.').bail()
    .custom((v) => v === null || isValidExpertise(v)).withMessage('Choose one of the listed expertise roles.'),
];

const factionMessage = 'factionKey must be one of the values from GET /api/factions.';

module.exports = {
  listQuests,
  getQuest: [questId(fail(404, 'Quest not found.'))],
  registerForQuest: [questId(fail(409, 'This quest is unavailable or already full.'))],
  cancelRegistration: [questId(fail(404, 'Active quest registration not found.'))],
  // GET /api/factions/:key/members?page=&limit=
  factionMembers: [
    field('key', { in: 'param', required: true }).withMessage(fail(404, 'Faction not found.')).bail()
      .custom(isValidFactionKey).withMessage(fail(404, 'Faction not found.')),
    common.paging(),
  ],
  // POST /api/users/me/faction { factionKey }
  setFaction: [
    field('factionKey', { required: true }).withMessage(factionMessage).bail()
      .custom((v) => Boolean(v) && isValidFactionKey(v)).withMessage(factionMessage),
  ],
  leaderboard,
  setInterests,
  setExpertise,
};
