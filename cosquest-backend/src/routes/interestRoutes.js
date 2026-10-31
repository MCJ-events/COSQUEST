const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { validate } = require('../middleware/validate');
const rules = require('../validators/misc');
const { listInterests, setInterests } = require('../controllers/interestController');

const router = express.Router();

router.get('/interests', listInterests); // public
router.put('/users/me/interests', requireAuth, validate(rules.setInterests), asyncHandler(setInterests));

module.exports = router;
