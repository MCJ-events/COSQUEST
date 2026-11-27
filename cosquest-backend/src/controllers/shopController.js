// The Shop (Wale's design, 27 Nov 2026): one call for the whole screen, and the free reward.
//   GET  /api/shop?game=          serverTime (countdowns use it, not the phone's clock),
//                                 balance, the no-cash-value notice, CosCoin packs (bought on
//                                 the website), Elite Merch, Manny's Remix (timed offers + a
//                                 free reward), Deals; each item with owned / claimed
//   POST /api/shop/free/:itemId   claim a free reward: once per player per offer period
const itemCatalog = require('../utils/itemCatalog');
const priceTable = require('../utils/priceTable');
const costcoin = require('../utils/costcoin');
const Wallet = require('../models/Wallet');
const ItemOwnership = require('../models/ItemOwnership');

const NOTICE = 'CosCoin are for use in CosQuest. They have no cash value and can\'t be withdrawn.';
const GAMES = ['social', 'costquest', 'trivia', 'parlay'];

const live = (i, now) => !i.dropEndsAt || new Date(i.dropEndsAt) > now;
const period = (i) => (i.dropEndsAt ? new Date(i.dropEndsAt).toISOString() : 'always');

async function shop(req, res) {
  const now = new Date();
  const game = GAMES.includes(req.query.game) ? req.query.game : null;
  const [sale, bundles, wallet, owned, w] = await Promise.all([
    itemCatalog.onSale(game),
    priceTable.onSale(),
    costcoin.wallet(req.user._id),
    ItemOwnership.find({ user: req.user._id, quantity: { $gte: 1 } }).select('itemId quantity').lean(),
    Wallet.findOne({ user: req.user._id }).select('applied').lean(),
  ]);
  const mine = new Map(owned.map((o) => [o.itemId, o.quantity]));
  const claimed = new Set((w?.applied || []).filter((k) => k.startsWith('free:')));
  const items = sale.items
    .filter((i) => live(i, now))
    .map((i) => ({ ...i, owned: mine.get(i.id) || 0, claimed: i.free ? claimed.has(`free:${i.id}:${period(i)}`) : false }));
  const remix = items.filter((i) => i.section === 'remix');
  const ends = remix.map((i) => i.dropEndsAt).filter(Boolean).sort()[0] || null;
  return res.json({
    serverTime: now.toISOString(),
    notice: NOTICE,
    balance: { balance: wallet.balance, bought: wallet.bought, earned: wallet.earned, frozen: wallet.frozen },
    packs: { priceVersion: bundles.priceVersion, bundles: bundles.bundles },
    eliteMerch: items.filter((i) => i.section === 'elite_merch'),
    remix: { endsAt: ends, free: remix.find((i) => i.free) || null, offers: remix.filter((i) => !i.free) },
    deals: items.filter((i) => i.section === 'deals'),
    catalogVersion: sale.catalogVersion,
  });
}

async function claimFree(req, res) {
  const now = new Date();
  const sale = await itemCatalog.onSale(null);
  const item = sale.items.find((i) => i.id === String(req.params.itemId || '').toUpperCase());
  if (!item || !item.free || !live(item, now)) return res.status(404).json({ error: 'This free reward is not available.', code: 'not_available' });
  const key = `free:${item.id}:${period(item)}`;
  try {
    await Wallet.updateOne({ user: req.user._id }, { $setOnInsert: { balance: 0, purchased: 0 } }, { upsert: true });
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }
  const taken = await Wallet.updateOne({ user: req.user._id, frozen: { $ne: true }, applied: { $ne: key } }, { $push: { applied: key } });
  if (!taken.modifiedCount) {
    const w = await Wallet.findOne({ user: req.user._id }).select('frozen').lean();
    if (w?.frozen) return res.status(423).json({ error: 'This wallet is on hold.', code: 'wallet_frozen' });
    return res.status(409).json({ error: 'You already claimed this reward.', code: 'already_claimed' });
  }
  await ItemOwnership.updateOne({ user: req.user._id, itemId: item.id }, { $inc: { quantity: 1 }, $set: { kind: item.kind, lastAt: now }, $setOnInsert: { firstAt: now } }, { upsert: true });
  return res.json({ claimed: true, item: { id: item.id, name: item.name } });
}

module.exports = { shop, claimFree, NOTICE };
