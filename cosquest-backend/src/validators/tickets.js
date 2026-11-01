// Rules for the members' ticket routes (src/routes/ticketRoutes.js).
const { objectId, oneOfValues, scalarQuery, fail } = require('../middleware/validate');

module.exports = {
  questId: [objectId('questId', { in: 'param', message: fail(404, 'Quest not found.') })],
  checkout: [objectId('questId', { in: 'param', message: fail(404, 'Quest not found.') }), objectId('ticketTypeId', { required: false, label: 'ticketTypeId' })],
  orderId: [objectId('orderId', { in: 'param', message: fail(404, 'Order not found.') })],
  ticketId: [objectId('ticketId', { in: 'param', message: fail(404, 'Ticket not found.') })],
  myTickets: [...scalarQuery('scope'), oneOfValues('scope', ['upcoming', 'past'], { in: 'query', label: 'scope' })],
};
