// Paying on the website (src/controllers/paymentController.js).
const { objectId, string, object } = require('../middleware/validate');
const { pathId } = require('./common');

const handoff = [
  objectId('questId', { message: 'Choose a quest.' }),
  objectId('ticketTypeId', { required: false, message: 'That ticket type is not available.' }),
];
const redeem = [string('h', { required: true, min: 20, max: 2000, message: 'This checkout link is not valid.' })];
const checkout = [
  objectId('ticketTypeId', { required: false, message: 'That ticket type is not available.' }),
  object('position', { nullable: true, message: 'position must be { lat, lng, accuracy }.' }),
];
const eligibility = [objectId('questId', { in: 'query', message: 'Choose a quest.' })];
const orderId = [pathId('orderId', 'Order not found.')];

module.exports = { handoff, redeem, checkout, eligibility, orderId };
