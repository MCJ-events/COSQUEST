const express = require('express');
const { identifyUser } = require('../middleware/identifyUser');
const { asyncHandler } = require('../utils/asyncHandler');
const { listFactions, setFaction } = require('../controllers/factionController');

const router = express.Router();

router.get('/factions', listFactions); // public
router.post('/users/me/faction', asyncHandler(identifyUser), asyncHandler(setFaction)); // email or Bearer token

module.exports = router;
