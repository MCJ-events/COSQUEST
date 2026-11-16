// Finance approvers (src/controllers/adminFinanceController.js).
const { string } = require('../middleware/validate');
const { pathId } = require('./common');

const add = [
  string('username', { required: true, min: 3, max: 30, trim: true, message: 'Enter their CosQuest username.' }),
  string('reason', { required: true, min: 3, max: 500, trim: true, message: 'A reason is required.' }),
];
const remove = [pathId('userId', 'Not found.'), string('reason', { required: true, min: 3, max: 500, trim: true, message: 'A reason is required.' })];

module.exports = { add, remove };
