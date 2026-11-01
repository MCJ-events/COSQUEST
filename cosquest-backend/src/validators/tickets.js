// Rules for the members' ticket routes (src/routes/ticketRoutes.js).
const { objectId, object, oneOfValues, scalarQuery, fail } = require('../middleware/validate');

module.exports = {
  questId: [objectId('questId', { in: 'param', message: fail(404, 'Quest not found.') })],
  // position { lat, lng, accuracy }: the phone's, for a live quest that needs you at the venue.
  checkout: [objectId('questId', { in: 'param', message: fail(404, 'Quest not found.') }), objectId('ticketTypeId', { required: false, label: 'ticketTypeId' }), object('position', { label: 'position' })],
  orderId: [objectId('orderId', { in: 'param', message: fail(404, 'Order not found.') })],
  ticketId: [objectId('ticketId', { in: 'param', message: fail(404, 'Ticket not found.') })],
  myTickets: [...scalarQuery('scope'), oneOfValues('scope', ['upcoming', 'past'], { in: 'query', label: 'scope' })],
};
