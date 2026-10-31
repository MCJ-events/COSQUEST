// Rules for /api/admin routes (src/routes/adminRoutes.js) and member reports
// (src/routes/reportRoutes.js). Types and limits only; the controllers check
// who may do what.
const { string, isoDate, objectId, oneOfValues, scalarQuery } = require('../middleware/validate');
const Report = require('../models/Report');

module.exports = {
  login: [
    string('email', { required: true, min: 3, max: 254, trim: true, label: 'email', message: 'email and password are required.' }),
    string('password', { required: true, min: 1, max: 200, message: 'email and password are required.' }),
  ],
  overview: [
    ...scalarQuery('from', 'to'),
    isoDate('from', { in: 'query', label: 'from' }),
    isoDate('to', { in: 'query', label: 'to' }),
  ],
  createReport: [
    oneOfValues('targetType', Report.TARGET_TYPES, { required: true, label: 'targetType' }),
    objectId('targetId', { label: 'targetId' }),
    oneOfValues('reason', Report.REASONS, { required: true, label: 'reason' }),
    string('statement', { max: 1000, label: 'statement' }),
  ],
};
