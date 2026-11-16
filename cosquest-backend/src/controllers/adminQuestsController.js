// Quests & Events (super admin dashboard).
//
//   GET   /api/admin/quests/stats
//   GET   /api/admin/quests?tab=all|live|upcoming|draft|completed|cancelled&kind=quest|event&q=&offset=
//   GET   /api/admin/quests/:questId               the quest, registrations, counts, history
//   POST  /api/admin/quests                        create (a draft, or { publish: true })
//   PATCH /api/admin/quests/:questId               edit
//   POST  /api/admin/quests/:questId/publish | unpublish | duplicate
//   POST  /api/admin/quests/:questId/cancel        { reason }  paid tickets refunded, everyone told
//   DELETE /api/admin/quests/:questId              { reason }  only with no registrations and no payments ever
//   POST  /api/admin/quests/cover                  multipart field "cover" -> { url, publicId }
//   GET   /api/admin/geocode?q=                    address -> places with coordinates (OpenStreetMap)
//
// Status follows the clock (src/utils/questStatus.js); only draft and
// cancelled are stored. Prices are whole units of `currency` (USD default).
const crypto = require('crypto');
const mongoose = require('mongoose');
const Quest = require('../models/Quest');
const QuestRegistration = require('../models/QuestRegistration');
const TicketType = require('../models/TicketType');
const Order = require('../models/Order');
const Ticket = require('../models/Ticket');
const AuditEvent = require('../models/AuditEvent');
const notificationModel = require('../models/notificationModel');
const { isValidFactionKey } = require('../models/factionModel');
const { serializeQuest } = require('../utils/quest');
const { effectiveStatus, statusFilter } = require('../utils/questStatus');
const { recordAudit, auditJson } = require('../utils/audit');
const { storePostMedia } = require('../utils/imageHost');
const { searchPlaces } = require('../utils/geocode');
const { freeAllowed } = require('../utils/tickets');
const { personJson } = require('./adminOverviewController');
const stats = require('../utils/adminStats');

const PAGE = 25;
const DEFAULT_CURRENCY = () => (process.env.QUEST_CURRENCY || 'USD').toUpperCase();

function fail(status, message, code) {
  throw Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}
function answer(res, error) {
  if (error.status) return res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
  throw error;
}

function slugify(title) {
  const base = String(title).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'quest';
  return `${base}-${crypto.randomBytes(3).toString('hex')}`;
}

function adminQuestJson(quest) {
  return {
    ...serializeQuest(quest),
    status: effectiveStatus(quest),
    isPublished: Boolean(quest.isPublished),
    isSeedData: Boolean(quest.isSeedData),
    cancelledAt: quest.cancelledAt || null,
    cancelReason: quest.cancelReason || null,
    createdAt: quest.createdAt,
    updatedAt: quest.updatedAt,
  };
}

// The form's fields, checked and normalised. `partial` (and the `current`
// quest) for edits.
function readFields(body, { partial = false, current = null } = {}) {
  const out = {};
  const has = (key) => body[key] !== undefined;
  const need = (key) => !partial || has(key);

  if (need('title')) {
    const title = String(body.title || '').trim();
    if (title.length < 3 || title.length > 120) fail(400, 'A title needs 3-120 characters.');
    out.title = title;
  }
  if (has('description')) out.description = String(body.description || '').trim().slice(0, 2000);
  if (has('kind')) {
    if (!['quest', 'event'].includes(body.kind)) fail(400, 'kind must be quest or event.');
    out.kind = body.kind;
  }
  if (has('hostName')) out.hostName = String(body.hostName || 'CosQuest').trim().slice(0, 80) || 'CosQuest';
  if (has('coverImageUrl')) {
    const url = String(body.coverImageUrl || '');
    if (url && !/^https:\/\//.test(url)) fail(400, 'The cover image must be an https link.');
    out.coverImageUrl = url;
  }
  if (need('startsAt') || need('endsAt')) {
    if (has('startsAt')) {
      const start = new Date(body.startsAt);
      if (Number.isNaN(start.getTime())) fail(400, 'startsAt must be a date.');
      out.startsAt = start;
    } else if (!partial) fail(400, 'startsAt is required.');
    if (has('endsAt')) {
      const end = new Date(body.endsAt);
      if (Number.isNaN(end.getTime())) fail(400, 'endsAt must be a date.');
      out.endsAt = end;
    } else if (!partial) fail(400, 'endsAt is required.');
  }
  // In person (a venue on the map) or virtual (online: no venue, a place label).
  if (has('format')) {
    if (!['in_person', 'virtual'].includes(body.format)) fail(400, 'format must be in_person or virtual.');
    out.format = body.format;
  }
  if (has('placeLabel')) out.placeLabel = String(body.placeLabel || '').trim().slice(0, 80);
  const virtual = (out.format || current?.format) === 'virtual';
  if (virtual && !(out.placeLabel || current?.placeLabel)) fail(400, 'A virtual quest needs a place label, for example "Tokyo · Hanuma".');
  if (!virtual && out.format === 'in_person' && !has('location') && !Number.isFinite(current?.location?.lat)) fail(400, 'Pick the venue on the map (latitude and longitude).');
  if (!virtual && need('location')) {
    const l = body.location || {};
    const lat = Number(l.lat);
    const lng = Number(l.lng);
    if (!String(l.name || '').trim()) fail(400, 'The venue needs a name.');
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) fail(400, 'Pick the venue on the map (latitude and longitude).');
    out.location = {
      name: String(l.name).trim().slice(0, 120),
      address: String(l.address || '').trim().slice(0, 300),
      city: String(l.city || '').trim().slice(0, 80),
      country: String(l.country || '').trim().slice(0, 80),
      lat,
      lng,
    };
  }
  for (const key of ['entryFee', 'prizePool']) {
    if (need(key)) {
      const amount = Number(body[key]?.amount ?? body[key]);
      if (!Number.isFinite(amount) || amount < 0 || amount > 1000000) fail(400, `${key === 'entryFee' ? 'The entry fee' : 'The prize pool'} must be 0 or more.`);
      // Every ticket is paid (unless ALLOW_FREE_TICKETS=1): Stripe's minimum is about $0.50.
      if (key === 'entryFee' && amount < 0.5 && !freeAllowed()) fail(400, 'Every ticket is paid: the entry fee must be at least $0.50.');
      // An edit that only changes the amount keeps the quest's own currency.
      const currency = String(body[key]?.currency || current?.[key]?.currency || DEFAULT_CURRENCY()).toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) fail(400, 'The currency must be a 3-letter code such as USD.');
      out[key] = { amount: Math.round(amount * 100) / 100, currency };
    }
  }
  if (need('maxParticipants')) {
    const max = Number(body.maxParticipants);
    if (!Number.isInteger(max) || max < 1 || max > 100000) fail(400, 'Places must be a whole number from 1 to 100,000.');
    out.maxParticipants = max;
  }
  if (has('faction')) {
    if (body.faction && !isValidFactionKey(body.faction)) fail(400, 'Unknown faction.');
    out.faction = body.faction || null;
  }
  if (has('interests')) {
    if (!Array.isArray(body.interests) || body.interests.some((i) => typeof i !== 'string')) fail(400, 'interests must be a list.');
    out.interests = body.interests.slice(0, 20);
  }
  if (has('requireAtVenue')) out.requireAtVenue = Boolean(body.requireAtVenue);
  // Nobody can "be at the venue" of a virtual quest.
  if (virtual) out.requireAtVenue = false;
  if (has('venueRadiusMeters')) {
    const r = Number(body.venueRadiusMeters);
    if (!Number.isInteger(r) || r < 50 || r > 5000) fail(400, 'The venue radius must be 50-5,000 metres.');
    out.venueRadiusMeters = r;
  }
  return out;
}

function checkTimes(startsAt, endsAt) {
  if (endsAt <= startsAt) fail(400, 'It must end after it starts.');
  if (endsAt - startsAt > 30 * 24 * 60 * 60 * 1000) fail(400, 'A quest or event can last at most 30 days.');
}

const label = (quest) => quest.title;

async function questStats(req, res) {
  const { current } = stats.windows(req.query);
  const published = { isPublished: true };
  const [live, upcoming, drafts, completed, cancelled, registrations] = await Promise.all([
    Quest.countDocuments({ ...published, ...statusFilter('live') }),
    Quest.countDocuments({ ...published, ...statusFilter('upcoming') }),
    Quest.countDocuments({ $or: [{ status: 'draft' }, { isPublished: false, status: { $ne: 'cancelled' } }] }),
    Quest.countDocuments({ ...published, ...statusFilter('completed') }),
    Quest.countDocuments({ status: 'cancelled' }),
    QuestRegistration.countDocuments({ status: { $in: ['registered', 'completed', 'winner'] }, ...stats.inWindow(current) }),
  ]);
  return res.json({ live, upcoming, drafts, completed, cancelled, registrationsThisWeek: registrations });
}

async function listAdminQuests(req, res) {
  const tab = req.query.tab || 'all';
  let filter = {};
  if (tab === 'draft') filter = { $or: [{ status: 'draft' }, { isPublished: false, status: { $ne: 'cancelled' } }] };
  else if (tab === 'cancelled') filter = { status: 'cancelled' };
  else if (tab !== 'all') filter = { isPublished: true, ...statusFilter(tab) };
  if (req.query.kind === 'event') filter.kind = 'event';
  if (req.query.kind === 'quest') filter.kind = { $ne: 'event' };
  if (req.query.q) {
    const s = String(req.query.q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter = { $and: [filter, { $or: [{ title: { $regex: s, $options: 'i' } }, { 'location.name': { $regex: s, $options: 'i' } }, { 'location.city': { $regex: s, $options: 'i' } }] }] };
  }
  const offset = Math.max(0, Math.min(100000, Number.parseInt(req.query.offset, 10) || 0));
  // Upcoming and live: soonest first. Everything else: newest first.
  const sort = ['upcoming', 'live'].includes(tab) ? { startsAt: 1, _id: 1 } : { startsAt: -1, _id: -1 };
  const [rows, total] = await Promise.all([Quest.find(filter).sort(sort).skip(offset).limit(PAGE), Quest.countDocuments(filter)]);
  return res.json({ quests: rows.map(adminQuestJson), total, nextOffset: offset + rows.length < total ? offset + rows.length : null });
}

async function loadQuest(questId) {
  if (!mongoose.isValidObjectId(questId)) fail(404, 'Quest not found.');
  const quest = await Quest.findById(questId);
  if (!quest) fail(404, 'Quest not found.');
  return quest;
}

async function questDetail(req, res) {
  try {
    const quest = await loadQuest(req.params.questId);
    const [registrations, counts, history] = await Promise.all([
      QuestRegistration.find({ quest: quest._id }).sort({ createdAt: -1 }).limit(100).populate('user', 'profile email'),
      QuestRegistration.aggregate([
        { $match: { quest: quest._id } },
        { $group: { _id: { status: '$status', payment: '$paymentStatus' }, n: { $sum: 1 } } },
      ]),
      AuditEvent.find({ 'target.type': 'quest', 'target.id': String(quest._id) }).sort({ createdAt: -1 }).limit(15).populate('actor', 'profile'),
    ]);
    const tally = { registered: 0, cancelled: 0, completed: 0, winner: 0, paymentPending: 0, paid: 0 };
    counts.forEach(({ _id, n }) => {
      tally[_id.status] = (tally[_id.status] || 0) + n;
      if (_id.status === 'registered' && _id.payment === 'pending') tally.paymentPending += n;
      if (_id.payment === 'paid') tally.paid += n;
    });
    return res.json({
      quest: adminQuestJson(quest),
      counts: tally,
      registrations: registrations
        .filter((r) => r.user)
        .map((r) => ({ id: String(r._id), user: { ...personJson(r.user), email: r.user.email || null }, status: r.status, paymentStatus: r.paymentStatus, at: r.createdAt })),
      history: history.map(auditJson),
    });
  } catch (error) {
    return answer(res, error);
  }
}

async function createQuest(req, res) {
  try {
    const fields = readFields(req.body);
    checkTimes(fields.startsAt, fields.endsAt);
    const publish = req.body.publish === true;
    const quest = await Quest.create({
      kind: 'quest',
      ...fields,
      slug: slugify(fields.title),
      status: publish ? 'upcoming' : 'draft',
      isPublished: publish,
      createdBy: req.admin._id,
      updatedBy: req.admin._id,
    });
    const event = await recordAudit(req.admin, {
      action: publish ? 'quest.publish' : 'quest.create',
      area: 'quests',
      target: { type: 'quest', id: quest._id, label: label(quest) },
      after: { status: effectiveStatus(quest), kind: quest.kind, startsAt: quest.startsAt, entryFee: quest.entryFee, maxParticipants: quest.maxParticipants },
    });
    return res.status(201).json({ quest: adminQuestJson(quest), auditEvent: `EV-${event.number}` });
  } catch (error) {
    return answer(res, error);
  }
}

async function tellRegistrants(quest, message) {
  const regs = await QuestRegistration.find({ quest: quest._id, status: 'registered' }, 'user').lean();
  await Promise.all(regs.map((r) => notificationModel.createForUser(r.user, message, { type: 'system' }).catch(() => {})));
  return regs.length;
}

async function updateQuest(req, res) {
  try {
    const quest = await loadQuest(req.params.questId);
    if (quest.status === 'cancelled') fail(409, 'A cancelled quest cannot be edited. Duplicate it instead.');
    const fields = readFields(req.body, { partial: true, current: quest });
    const startsAt = fields.startsAt || quest.startsAt;
    const endsAt = fields.endsAt || quest.endsAt;
    checkTimes(startsAt, endsAt);
    if (fields.maxParticipants !== undefined && fields.maxParticipants < quest.registrationCount) {
      fail(400, `${quest.registrationCount} people are registered: places can't go below that.`);
    }
    const before = {};
    const after = {};
    for (const [key, value] of Object.entries(fields)) {
      if (JSON.stringify(quest[key]?.toObject ? quest[key].toObject() : quest[key]) === JSON.stringify(value)) continue;
      before[key] = quest[key]?.toObject ? quest[key].toObject() : quest[key];
      after[key] = value;
      quest[key] = value;
    }
    if (!Object.keys(after).length) return res.json({ quest: adminQuestJson(quest), auditEvent: null });
    // The default ticket type is the entry fee and places as sold: keep it in
    // step, or people would still pay the old price. Places never go below
    // what's sold or in someone's checkout (checked in the same update).
    if (after.entryFee || after.maxParticipants !== undefined) {
      const set = {
        ...(after.entryFee ? { price: { amount: quest.entryFee.amount, currency: quest.entryFee.currency } } : {}),
        ...(after.maxParticipants !== undefined ? { quantity: quest.maxParticipants } : {}),
      };
      const filter = { quest: quest._id, isDefault: true };
      if (set.quantity !== undefined) filter.$expr = { $lte: [{ $add: ['$sold', '$held'] }, set.quantity] };
      const synced = await TicketType.findOneAndUpdate(filter, { $set: set });
      if (!synced && set.quantity !== undefined && (await TicketType.exists({ quest: quest._id, isDefault: true }))) {
        fail(409, "More tickets are sold or being paid for than that: places can't go below it.");
      }
    }
    quest.updatedBy = req.admin._id;
    await quest.save();
    let told = 0;
    if (quest.isPublished && (after.startsAt || after.endsAt || after.location)) {
      told = await tellRegistrants(quest, `${quest.title} changed: ${after.location ? `now at ${quest.location.name}` : ''}${after.location && (after.startsAt || after.endsAt) ? ', ' : ''}${after.startsAt || after.endsAt ? `starts ${quest.startsAt.toUTCString()}` : ''}.`);
    }
    const event = await recordAudit(req.admin, {
      action: 'quest.update',
      area: 'quests',
      target: { type: 'quest', id: quest._id, label: label(quest) },
      reason: typeof req.body.reason === 'string' ? req.body.reason.trim() : '',
      before,
      after,
      meta: told ? { registrantsNotified: told } : null,
    });
    return res.json({ quest: adminQuestJson(quest), auditEvent: `EV-${event.number}` });
  } catch (error) {
    return answer(res, error);
  }
}

function setPublished(publish) {
  return async (req, res) => {
    try {
      const quest = await loadQuest(req.params.questId);
      if (quest.status === 'cancelled') fail(409, 'A cancelled quest cannot be published. Duplicate it instead.');
      if (publish && quest.endsAt <= new Date()) fail(409, 'This has already ended. Change its dates first.');
      if (!publish && quest.registrationCount > 0) fail(409, 'People are registered. Cancel it instead, so they are told.');
      if (Boolean(quest.isPublished) === publish && (publish ? quest.status !== 'draft' : quest.status === 'draft')) {
        return res.json({ quest: adminQuestJson(quest), auditEvent: null });
      }
      const before = { status: effectiveStatus(quest), isPublished: Boolean(quest.isPublished) };
      quest.isPublished = publish;
      quest.status = publish ? 'upcoming' : 'draft';
      quest.updatedBy = req.admin._id;
      await quest.save();
      const event = await recordAudit(req.admin, {
        action: publish ? 'quest.publish' : 'quest.unpublish',
        area: 'quests',
        target: { type: 'quest', id: quest._id, label: label(quest) },
        before,
        after: { status: effectiveStatus(quest), isPublished: publish },
      });
      return res.json({ quest: adminQuestJson(quest), auditEvent: `EV-${event.number}` });
    } catch (error) {
      return answer(res, error);
    }
  };
}

async function duplicateQuest(req, res) {
  try {
    const source = await loadQuest(req.params.questId);
    const copy = source.toObject();
    ['_id', 'slug', 'createdAt', 'updatedAt', 'registrationCount', 'cancelledAt', 'cancelReason', 'isSeedData', '__v'].forEach((k) => delete copy[k]);
    const quest = await Quest.create({
      ...copy,
      title: `${source.title} (copy)`.slice(0, 120),
      slug: slugify(source.title),
      status: 'draft',
      isPublished: false,
      registrationCount: 0,
      createdBy: req.admin._id,
      updatedBy: req.admin._id,
    });
    const event = await recordAudit(req.admin, {
      action: 'quest.duplicate',
      area: 'quests',
      target: { type: 'quest', id: quest._id, label: label(quest) },
      meta: { from: String(source._id) },
    });
    return res.status(201).json({ quest: adminQuestJson(quest), auditEvent: `EV-${event.number}` });
  } catch (error) {
    return answer(res, error);
  }
}

async function cancelQuest(req, res) {
  try {
    const quest = await loadQuest(req.params.questId);
    const reason = String(req.body.reason || '').trim();
    if (reason.length < 3) fail(400, 'A reason is required.', 'reason_required');
    if (quest.status === 'cancelled') fail(409, 'This is already cancelled.');
    if (effectiveStatus(quest) === 'completed') fail(409, 'This has already ended.');
    const before = { status: effectiveStatus(quest) };
    // Close it first, in one step: nobody registers after this, and a second
    // admin cancelling at the same moment gets the 409 instead of a repeat.
    const closed = await Quest.findOneAndUpdate(
      { _id: quest._id, status: { $ne: 'cancelled' } },
      { $set: { status: 'cancelled', cancelledAt: new Date(), cancelReason: reason.slice(0, 500), updatedBy: req.admin._id } },
      { new: true }
    );
    if (!closed) fail(409, 'This is already cancelled.');
    // Then tell people (their registrations still say "registered"), give
    // every ticket back (paid refunded, free cancelled, open checkouts
    // closed) and cancel what registrations are left.
    const told = await tellRegistrants(closed, `${closed.title} has been cancelled. ${reason} Paid tickets are refunded automatically.`);
    const money = await require('../utils/tickets').refundAllForQuest(closed._id, `Cancelled: ${reason}`.slice(0, 500), req.admin._id);
    await QuestRegistration.updateMany({ quest: closed._id, status: 'registered' }, { $set: { status: 'cancelled' } });
    const event = await recordAudit(req.admin, {
      action: 'quest.cancel',
      area: 'quests',
      target: { type: 'quest', id: closed._id, label: label(closed) },
      reason,
      before,
      after: { status: 'cancelled' },
      meta: { registrantsNotified: told, refunded: money.refunded, refundsFailed: money.failed },
    });
    return res.json({ quest: adminQuestJson(closed), registrantsNotified: told, refunded: money.refunded, refundsFailed: money.failed, auditEvent: `EV-${event.number}` });
  } catch (error) {
    return answer(res, error);
  }
}

/**
 * Deletes a quest for good: only when nobody is registered and no money was
 * ever involved (no paid, refunded, free or pending order). Otherwise it must
 * be cancelled, which tells people, refunds them and keeps the records.
 *
 * It is unpublished FIRST, so no checkout can start while it is checked and
 * deleted (a pending order deleted while someone is on Stripe's page could
 * not be refunded automatically); a refusal puts it back as it was. Only
 * orders that never involved money are deleted, so even a checkout that was
 * already under way keeps its order (and its payment is refunded: a quest
 * that no longer exists counts as cancelled in src/utils/tickets.js).
 */
async function deleteQuest(req, res) {
  try {
    const quest = await loadQuest(req.params.questId);
    const reason = String(req.body.reason || '').trim();
    if (reason.length < 3) fail(400, 'A reason is required.', 'reason_required');
    const wasPublished = Boolean(quest.isPublished);
    if (wasPublished) await Quest.updateOne({ _id: quest._id }, { $set: { isPublished: false } });
    const [registered, moneyOrders, liveTickets] = await Promise.all([
      QuestRegistration.countDocuments({ quest: quest._id, status: { $in: ['registered', 'completed', 'winner'] } }),
      Order.countDocuments({ quest: quest._id, status: { $in: ['paid', 'refunded', 'pending', 'free'] } }),
      Ticket.countDocuments({ quest: quest._id, status: { $in: ['valid', 'checked_in'] } }),
    ]);
    if (registered || liveTickets || moneyOrders) {
      if (wasPublished) await Quest.updateOne({ _id: quest._id }, { $set: { isPublished: true } });
      if (registered || liveTickets) fail(409, `${registered || liveTickets} ${(registered || liveTickets) === 1 ? 'person is' : 'people are'} registered: cancel it instead, so they are told.`, 'has_registrations');
      fail(409, 'It has orders or payment history: cancel it instead, so the records are kept.', 'has_orders');
    }

    const snapshot = adminQuestJson(quest);
    await Promise.all([
      TicketType.deleteMany({ quest: quest._id }),
      Order.deleteMany({ quest: quest._id, status: { $in: ['expired', 'failed', 'cancelled'] } }),
      Ticket.deleteMany({ quest: quest._id, status: { $in: ['refunded', 'cancelled'] } }),
      QuestRegistration.deleteMany({ quest: quest._id }),
    ]);
    await Quest.deleteOne({ _id: quest._id });
    const event = await recordAudit(req.admin, {
      action: 'quest.delete',
      area: 'quests',
      target: { type: 'quest', id: quest._id, label: label(quest) },
      reason,
      before: { title: snapshot.title, status: snapshot.status, startsAt: snapshot.startsAt, venue: snapshot.location?.name, entryFee: snapshot.entryFee, isSeedData: snapshot.isSeedData },
      after: { deleted: true },
    });
    return res.json({ deleted: true, auditEvent: `EV-${event.number}` });
  } catch (error) {
    return answer(res, error);
  }
}

async function uploadCover(req, res) {
  try {
    if (!req.file) fail(400, 'Choose an image (field "cover").');
    const [media] = await storePostMedia([req.file], 'image');
    return res.status(201).json({ url: media.url, publicId: media.publicId, width: media.width, height: media.height });
  } catch (error) {
    return answer(res, error);
  }
}

async function geocode(req, res) {
  try {
    return res.json({ places: await searchPlaces(req.query.q), attribution: '© OpenStreetMap contributors' });
  } catch (error) {
    return answer(res, error);
  }
}

module.exports = {
  questStats,
  listAdminQuests,
  questDetail,
  createQuest,
  updateQuest,
  publishQuest: setPublished(true),
  unpublishQuest: setPublished(false),
  duplicateQuest,
  cancelQuest,
  deleteQuest,
  uploadCover,
  geocode,
  readFields,
};
