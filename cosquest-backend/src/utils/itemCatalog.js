// What CosCoin can buy (src/models/ItemCatalogVersion.js): versions c1, c2...,
// changed only through approvals, like the price table.
//   current() every item (admins) · onSale(game) active items for a game
//   requestChange() a new catalog waits for a second admin · applyApproved()
const ItemCatalogVersion = require('../models/ItemCatalogVersion');
const ApprovalRequest = require('../models/ApprovalRequest');
const Counter = require('../models/Counter');

const { KINDS, GAMES } = ItemCatalogVersion;

function fail(status, message, code) {
  throw Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}

const label = (v) => (v ? `c${v.version}` : null);
const itemJson = (i) => ({ id: i.id, name: i.name, kind: i.kind, priceCosCoin: i.priceCosCoin ?? null, stackable: Boolean(i.stackable), boughtCoinsOnly: Boolean(i.boughtCoinsOnly), game: i.game || 'all', status: i.status, note: i.note || '', imageUrl: i.imageUrl || '', subtitle: i.subtitle || '', section: i.section || 'elite_merch', isNew: Boolean(i.newTag), dropEndsAt: i.dropEndsAt ? new Date(i.dropEndsAt).toISOString() : null, free: Boolean(i.free) });
const SECTIONS = ['elite_merch', 'remix', 'deals', 'wardrobe'];
const catalogJson = (v) => ({ catalogVersion: label(v), items: v ? v.items.map(itemJson) : [], approvedAt: v?.createdAt || null });

async function latest() {
  return ItemCatalogVersion.findOne().sort({ version: -1 }).lean();
}

async function current() {
  return catalogJson(await latest());
}

/** Items on sale, for one game (items for "all" games are always included). */
async function onSale(game = null) {
  const c = await current();
  return { catalogVersion: c.catalogVersion, items: c.items.filter((i) => i.status === 'active' && (!game || i.game === 'all' || i.game === game)) };
}

async function history() {
  return (await ItemCatalogVersion.find().sort({ version: -1 }).limit(50).lean()).map(catalogJson);
}

// Words that would mean buying quest entry or XP: never allowed (payment brief).
const FORBIDDEN = /\b(quest\s*entry|entry\s*fee|ticket|xp|cosxp|experience\s*points?)\b/i;

function cleanItems(input) {
  if (!Array.isArray(input) || !input.length || input.length > 200) fail(400, 'A catalog has between 1 and 200 items.', 'bad_catalog');
  const items = input.map((i) => {
    const id = String(i?.id || '').trim().toUpperCase();
    if (!/^[A-Z]{2,6}-[A-Z0-9-]{1,20}$/.test(id)) fail(400, `"${i?.id}" is not an item id (e.g. SK-07, WP-AXE, AM-50).`, 'bad_item_id');
    const name = String(i?.name || '').trim();
    if (name.length < 1 || name.length > 60) fail(400, `${id}: the name needs 1-60 characters.`, 'bad_item');
    if (FORBIDDEN.test(name) || FORBIDDEN.test(String(i?.note || ''))) fail(400, `${id}: CosCoin can't buy quest entry or XP.`, 'not_allowed');
    const kind = String(i?.kind || '');
    if (!KINDS.includes(kind)) fail(400, `${id}: the kind is one of ${KINDS.join(', ')}.`, 'bad_kind');
    const game = GAMES.includes(i?.game) ? i.game : 'all';
    const status = i?.status === 'open' ? 'open' : 'active';
    const raw = i?.priceCosCoin;
    const price = raw === null || raw === undefined || raw === '' ? null : Number(raw);
    if (price !== null && (!Number.isInteger(price) || price < 1 || price > 1000000)) fail(400, `${id}: the price is a whole number of CosCoin from 1.`, 'bad_item_price');
    const free = Boolean(i?.free);
    const section = SECTIONS.includes(i?.section) ? i.section : 'elite_merch';
    if (free && price !== null) fail(400, `${id}: a free reward has no price.`, 'bad_item_price');
    if (free && section !== 'remix') fail(400, `${id}: free rewards are in Manny's Remix.`, 'bad_item');
    const imageUrl = String(i?.imageUrl || '').trim();
    if (imageUrl && (!/^https:\/\/[^\s]+$/.test(imageUrl) || imageUrl.length > 500)) fail(400, `${id}: the picture must be an https:// link.`, 'bad_image');
    const ends = i?.dropEndsAt ? new Date(i.dropEndsAt) : null;
    if (ends && Number.isNaN(ends.getTime())) fail(400, `${id}: the end date is not a date (YYYY-MM-DD).`, 'bad_date');
    if (status === 'active' && price === null && !free) fail(400, `${id}: an item on sale needs its CosCoin price (or mark it open).`, 'bad_item_price');
    return { id, name, kind, priceCosCoin: price, stackable: kind === 'ammo' ? true : Boolean(i?.stackable), boughtCoinsOnly: Boolean(i?.boughtCoinsOnly), game, status, note: String(i?.note || '').slice(0, 200), imageUrl, subtitle: String(i?.subtitle || '').trim().slice(0, 80), section, newTag: Boolean(i?.isNew), dropEndsAt: ends, free };
  });
  if (new Set(items.map((i) => i.id)).size !== items.length) fail(400, 'Each item id once.', 'duplicate_item');
  return items;
}

async function requestChange(admin, { items, reason }) {
  if (!reason || String(reason).trim().length < 3) fail(400, 'A reason is required.', 'reason_required');
  const clean = cleanItems(items);
  const now = await latest();
  if (now && JSON.stringify(now.items.map(itemJson)) === JSON.stringify(clean.map(itemJson))) fail(409, 'Nothing changes: this is the current catalog.', 'no_change');
  return ApprovalRequest.create({
    number: await Counter.next('approval', 1),
    kind: 'item_catalog',
    title: `Item catalog: ${clean.length} item(s), ${clean.filter((i) => i.status === 'active').length} on sale`,
    changes: { items: clean },
    reason: String(reason).trim().slice(0, 500),
    requestedBy: admin._id,
  });
}

async function applyApproved(request, admin) {
  const existing = await ItemCatalogVersion.findOne({ approval: request._id }).lean();
  if (existing) return existing;
  return ItemCatalogVersion.create({ version: await Counter.next('itemCatalog', 1), items: request.changes?.items || [], approval: request._id, requestedBy: request.requestedBy, approvedBy: admin._id });
}

module.exports = { current, onSale, history, requestChange, applyApproved, cleanItems, KINDS, GAMES };
