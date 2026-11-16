// Money admin (src/controllers/adminLedgerController.js).
const { string, array, scalarQuery } = require('../middleware/validate');
const { pathId } = require('./common');

const list = [scalarQuery('book', 'account', 'kind', 'from', 'to', 'offset', 'prefix', 'status')];
const reverse = [pathId('txId', 'Ledger transaction not found.'), string('reason', { required: true, min: 3, max: 500, trim: true, message: 'A reason is required.' })];
const regionRequest = [
  array('changes', { required: true, min: 1, max: 100, of: 'object', message: 'Add between 1 and 100 region changes.' }),
  string('reason', { required: true, min: 3, max: 500, trim: true, message: 'A reason is required.' }),
];
const approve = [pathId('requestId', 'Approval request not found.'), string('note', { max: 500 })];
const reject = [pathId('requestId', 'Approval request not found.'), string('note', { required: true, min: 3, max: 500, trim: true, message: 'Say why it is rejected.' })];
const requestId = [pathId('requestId', 'Approval request not found.')];

module.exports = { list, reverse, regionRequest, approve, reject, requestId };
