const express = require('express');
const { getLadder } = require('../utils/ranks');

const router = express.Router();

// GET /api/ranks (public) - the faction rank ladder, lowest first:
// { ranks: [{ key, name, short, level, chevrons, bars, star, minPoints }] }
router.get('/ranks', (req, res) => res.json({ ranks: getLadder() }));

module.exports = router;
