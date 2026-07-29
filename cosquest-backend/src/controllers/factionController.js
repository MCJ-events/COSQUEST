const { FACTIONS, isValidFactionKey } = require('../models/factionModel');
const userModel = require('../models/userModel');

// GET /api/factions (public - no auth required, same as the front-end's onboarding step 2 list)
function listFactions(req, res) {
  return res.json({ factions: FACTIONS, factionless: { key: 'none', name: 'Factionless' } });
}

// POST /api/users/me/faction  (onboarding step 2)
async function setFaction(req, res) {
  const { factionKey } = req.body;
  if (!factionKey || !isValidFactionKey(factionKey)) {
    return res.status(400).json({ error: 'factionKey must be one of the values from GET /api/factions, or "none".' });
  }
  const updated = await userModel.updateUser(req.userId, (user) => {
    user.faction = factionKey;
  });
  return res.json({ user: userModel.sanitize(updated) });
}

module.exports = { listFactions, setFaction };
