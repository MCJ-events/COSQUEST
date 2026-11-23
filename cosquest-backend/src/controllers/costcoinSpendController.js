// Spending CosCoin, for every app and game (the member's CosQuest login).
//   GET  /api/costcoin/items?game=costquest   items on sale (+ what I own)
//   POST /api/costcoin/spend                  { itemId, key, game? }
//        200 { spent, item, balance, transaction, replay }
//        402 not_enough_coins { balance, price, topUp: true }: show "Top up on the web"
//        409 already_owned · 423 wallet_frozen · 404 not_on_sale
//   GET  /api/costcoin/inventory              what I own
// Admin: GET /api/admin/item-catalog, POST /api/admin/item-catalog/requests (approvals)
const itemCatalog = require('../utils/itemCatalog');
const spending = require('../utils/costcoinSpend');
const { recordAudit } = require('../utils/audit');

function answer(res, error) {
  if (error.status) return res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}), ...(error.extra || {}) });
  throw error;
}

const gameOf = (value) => (itemCatalog.GAMES.includes(value) ? value : null);

async function items(req, res) {
  const [sale, owned] = await Promise.all([itemCatalog.onSale(gameOf(req.query.game)), spending.inventory(req.user._id)]);
  const mine = new Map(owned.map((o) => [o.itemId, o.quantity]));
  return res.json({ catalogVersion: sale.catalogVersion, items: sale.items.map((i) => ({ ...i, owned: mine.get(i.id) || 0 })) });
}

async function spend(req, res) {
  try {
    return res.json(await spending.spend(req.user, { itemId: req.body?.itemId, key: req.body?.key, game: gameOf(req.body?.game) }));
  } catch (error) {
    return answer(res, error);
  }
}

async function inventory(req, res) {
  return res.json({ items: await spending.inventory(req.user._id) });
}

async function adminCatalog(req, res) {
  const [current, history] = await Promise.all([itemCatalog.current(), itemCatalog.history()]);
  return res.json({ current, history, kinds: itemCatalog.KINDS, games: itemCatalog.GAMES });
}

async function adminRequestCatalog(req, res) {
  try {
    const request = await itemCatalog.requestChange(req.admin, req.body || {});
    const event = await recordAudit(req.admin, { action: 'approval.request', area: 'payments', target: { type: 'approval', id: request._id, label: `AP-${request.number}` }, reason: request.reason, after: { title: request.title } });
    return res.status(201).json({ request: { id: String(request._id), number: `AP-${request.number}`, title: request.title, status: request.status }, auditEvent: `EV-${event.number}` });
  } catch (error) {
    return answer(res, error);
  }
}

module.exports = { items, spend, inventory, adminCatalog, adminRequestCatalog };
