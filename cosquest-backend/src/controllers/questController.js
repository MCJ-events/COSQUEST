const Quest = require('../models/Quest');
const QuestRegistration = require('../models/QuestRegistration');
const { distanceMiles, serializeQuest } = require('../utils/quest');
const { statusFilter, openForRegistration } = require('../utils/questStatus');

// The signed-in person's registrations among these quests (optionalAuth).
async function registeredIds(req, quests) {
  if (!req.userId || !quests.length) return null;
  const rows = await QuestRegistration.find({ user: req.userId, status: 'registered', quest: { $in: quests.map((q) => q._id) } }, 'quest').lean();
  return new Set(rows.map((row) => String(row.quest)));
}

function parseCoordinate(value, min, max) {
  if (value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : undefined;
}

function parseLimit(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? Math.min(number, 50) : fallback;
}

// A box around the point, so the database returns only quests in the area
// (the exact distance is checked after). A degree is about 69 miles on the
// sphere distanceMiles uses, and a degree of longitude shrinks towards the
// poles. Near a pole or across the 180° line, only the latitude band is used.
function nearbyBox(lat, lng, radiusMiles) {
  const dLat = radiusMiles / 69;
  const box = { 'location.lat': { $gte: lat - dLat, $lte: lat + dLat } };
  const dLng = radiusMiles / (69 * Math.cos((lat * Math.PI) / 180));
  if (Number.isFinite(dLng) && lng - dLng >= -180 && lng + dLng <= 180) box['location.lng'] = { $gte: lng - dLng, $lte: lng + dLng };
  return box;
}

async function listQuests(req, res) {
  const { status } = req.query;
  const lat = parseCoordinate(req.query.lat, -90, 90);
  const lng = parseCoordinate(req.query.lng, -180, 180);
  const radiusMiles = Number(req.query.radiusMiles || process.env.DASHBOARD_RADIUS_MILES || 30);
  if (lat === undefined || lng === undefined || !Number.isFinite(radiusMiles) || radiusMiles <= 0) {
    return res.status(400).json({ error: 'lat, lng, and radiusMiles must be valid numbers.' });
  }

  const query = { isPublished: true };
  // Status from the clock; without one, everything except cancelled.
  // An unknown ?status= is no filter (it used to list cancelled quests too).
  const known = ['upcoming', 'live', 'completed', 'cancelled'].includes(status);
  Object.assign(query, known ? statusFilter(status) : { status: { $ne: 'cancelled' } });
  if (req.query.faction) query.faction = req.query.faction;
  // With a location: only quests in the area come from the database, each is
  // measured, and the nearest are kept (nearest first, then the limit). It
  // used to take the first 20 worldwide by start time and filter after, so
  // nearby quests were cut off. Without one: the soonest, as before.
  if (lat !== null) Object.assign(query, nearbyBox(lat, lng, radiusMiles));
  const quests = await Quest.find(query).sort({ startsAt: 1 }).limit(lat === null ? parseLimit(req.query.limit, 20) : 2000);
  const withDistance = quests.map((quest) => ({
    quest,
    distance: lat === null ? undefined : distanceMiles(lat, lng, quest.location.lat, quest.location.lng),
  }));
  const filtered = lat === null ? withDistance : withDistance.filter((item) => item.distance <= radiusMiles);
  filtered.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
  if (lat !== null) filtered.splice(parseLimit(req.query.limit, 20));
  const mine = await registeredIds(req, filtered.map(({ quest }) => quest));
  return res.json({ quests: filtered.map(({ quest, distance }) => serializeQuest(quest, { distance, ...(mine ? { isRegistered: mine.has(String(quest._id)) } : {}) })) });
}

async function getQuest(req, res) {
  const quest = await Quest.findOne({ _id: req.params.questId, isPublished: true });
  if (!quest) return res.status(404).json({ error: 'Quest not found.' });
  const mine = await registeredIds(req, [quest]);
  return res.json({ quest: serializeQuest(quest, mine ? { isRegistered: mine.has(String(quest._id)) } : {}) });
}

async function registerForQuest(req, res) {
  // Seats are counted by tickets now (src/utils/tickets.js), so this route
  // goes through them: a paid quest needs checkout, a free one gets a free
  // ticket (with its QR code). The answers keep their old shape and words.
  const priced = await Quest.findOne({ _id: req.params.questId, isPublished: true }).select('entryFee').lean();
  if (priced) {
    if (priced.entryFee?.amount > 0) {
      return res.status(402).json({ error: 'This needs a ticket: use checkout.', code: 'checkout_required' });
    }
    try {
      const result = await require('../utils/tickets').startCheckout({ user: req.user, questId: req.params.questId });
      const fresh = await Quest.findById(req.params.questId);
      return res.status(201).json({
        registration: { status: 'registered', paymentStatus: 'not_required' },
        ticket: result.ticket ? { id: String(result.ticket._id) } : null,
        quest: serializeQuest(fresh, { isRegistered: true }),
      });
    } catch (error) {
      if (error.code === 'has_ticket') return res.status(409).json({ error: 'You are already registered for this quest.' });
      if (['sold_out'].includes(error.code) || (error.status === 409 && !error.code)) return res.status(409).json({ error: 'This quest is unavailable or already full.' });
      if (error.status) return res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
      throw error;
    }
  }
  const quest = await Quest.findOneAndUpdate(
    {
      _id: req.params.questId,
      isPublished: true,
      // Open until it ends, unless it's a draft or cancelled (status from the clock).
      ...openForRegistration(),
      $expr: { $lt: ['$registrationCount', '$maxParticipants'] },
    },
    { $inc: { registrationCount: 1 } },
    { new: true }
  );
  if (!quest) return res.status(409).json({ error: 'This quest is unavailable or already full.' });

  try {
    const paymentStatus = quest.entryFee.amount > 0 ? 'pending' : 'not_required';
    const registration = await QuestRegistration.create({ quest: quest._id, user: req.userId, paymentStatus });
    return res.status(201).json({ registration: { id: String(registration._id), status: registration.status, paymentStatus }, quest: serializeQuest(quest, { isRegistered: true }) });
  } catch (error) {
    await Quest.updateOne({ _id: quest._id, registrationCount: { $gt: 0 } }, { $inc: { registrationCount: -1 } });
    if (error?.code === 11000) return res.status(409).json({ error: 'You are already registered for this quest.' });
    throw error;
  }
}

async function cancelRegistration(req, res) {
  // A ticket held for this quest: a free one is given back here (seat
  // released once); a paid one is refunded from My tickets.
  const Ticket = require('../models/Ticket');
  const ticket = await Ticket.findOne({ user: req.userId, quest: req.params.questId, status: 'valid' }).catch(() => null);
  if (ticket) {
    const Order = require('../models/Order');
    const order = await Order.findById(ticket.order);
    if (order?.status === 'paid') return res.status(409).json({ error: 'Give paid tickets back from My tickets (a refund).', code: 'use_my_tickets' });
    await require('../utils/tickets').refundOrder(ticket.order, { reason: 'Registration cancelled', by: req.user._id });
    const quest = await Quest.findById(req.params.questId);
    return res.json({ message: 'Quest registration cancelled.', quest: serializeQuest(quest, { isRegistered: false }) });
  }
  const registration = await QuestRegistration.findOneAndUpdate(
    { quest: req.params.questId, user: req.userId, status: 'registered' },
    { $set: { status: 'cancelled' } },
    { new: true }
  );
  if (!registration) return res.status(404).json({ error: 'Active quest registration not found.' });
  const quest = await Quest.findByIdAndUpdate(
    registration.quest,
    { $inc: { registrationCount: -1 } },
    { new: true }
  );
  return res.json({ message: 'Quest registration cancelled.', quest: serializeQuest(quest, { isRegistered: false }) });
}

module.exports = { listQuests, getQuest, registerForQuest, cancelRegistration };
