// Prizes for members (app and website): my prizes, and claiming one.
const express = require('express');
const { requireAuth, requireCompletedOnboarding } = require('../middleware/auth');
const { asyncHandler: a } = require('../utils/asyncHandler');
const prizes = require('../utils/prizes');

const router = express.Router();
const member = [requireAuth, requireCompletedOnboarding];

function answer(res, error) {
  if (error.status) return res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
  throw error;
}

router.get('/prizes', ...member, a(async (req, res) => res.json({ prizes: await prizes.mine(req.user._id) })));
router.post(
  '/prizes/:prizeId/claim',
  ...member,
  a(async (req, res) => {
    if (!require('mongoose').isValidObjectId(req.params.prizeId)) return res.status(404).json({ error: 'Prize not found.' });
    try {
      const c = await prizes.claim(req.user._id, req.params.prizeId, req.body || {});
      return res.json({ prize: prizes.masked(await c.populate('quest', 'title')) });
    } catch (error) {
      return answer(res, error);
    }
  })
);

module.exports = router;
