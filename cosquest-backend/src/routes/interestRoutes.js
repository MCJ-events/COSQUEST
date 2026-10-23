const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { listInterests, setInterests } = require('../controllers/interestController');

const router = express.Router();

router.get('/interests', listInterests); // public
router.put('/users/me/interests', requireAuth, asyncHandler(setInterests));

module.exports = router;
