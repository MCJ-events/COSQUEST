// After the event (src/controllers/adminEventsController.js).
const { array } = require('../middleware/validate');
const { pathId } = require('./common');

const questId = [pathId('questId', 'Quest not found.')];
const saveResults = [pathId('questId', 'Quest not found.'), array('winners', { required: true, max: 100, of: 'object', message: 'winners must be a list of { ticketId, place, prizeNote }.' })];

module.exports = { questId, saveResults };
