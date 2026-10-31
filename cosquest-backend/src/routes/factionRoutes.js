const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { validate } = require('../middleware/validate');
const rules = require('../validators/misc');
const { listFactions, listFactionMembers, setFaction } = require('../controllers/factionController');

const router = express.Router();

router.get('/factions', asyncHandler(listFactions)); // public
router.get('/factions/:key/members', validate(rules.factionMembers), asyncHandler(listFactionMembers)); // public
router.post('/users/me/faction', requireAuth, validate(rules.setFaction), asyncHandler(setFaction));

module.exports = router;
