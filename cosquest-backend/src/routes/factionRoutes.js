const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { listFactions, listFactionMembers, setFaction } = require('../controllers/factionController');

const router = express.Router();

router.get('/factions', asyncHandler(listFactions)); // public
router.get('/factions/:key/members', asyncHandler(listFactionMembers)); // public
router.post('/users/me/faction', requireAuth, asyncHandler(setFaction));

module.exports = router;
