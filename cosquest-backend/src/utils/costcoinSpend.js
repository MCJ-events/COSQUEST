// Spending CosCoin (one action for every app and game: the social app,
// CostQuest, Cost Trivia, Parlay). Payment brief: CosCoin buys cosmetics,
// skins, items, ammo, faction switches; never quest entry, never XP, never cash.
//
//   spend(user, { itemId, key, game })
//     1. the item is on sale in the current catalog (and for that game)
//     2. owned-once items: refused if already owned (nothing is charged)
//     3. the wallet: one atomic update takes the coins only if the balance is
//        enough, the wallet isn't frozen and this key wasn't used (so a retry
//        or a double tap never charges twice, and it never goes below zero)
//     4. the CosCoin ledger: "Spend", debit <user> Wallet / credit CosCoin Spent
//     5. the item is given (ownership +1)
//   inventory(user) what the member owns
const Wallet = require('../models/Wallet');
const ItemOwnership = require('../models/ItemOwnership');
const ledger = require('./ledger');
const itemCatalog = require('./itemCatalog');

function fail(status, message, code, extra) {
  throw Object.assign(new Error(message), { status, ...(code ? { code } : {}), ...(extra ? { extra } : {}) });
}

const cleanKey = (key) => String(key || '').trim().slice(0, 80);

async function spend(user, { itemId, key, game = null }) {
  const k = cleanKey(key);
  if (!/^[A-Za-z0-9_.:-]{8,80}$/.test(k)) fail(400, 'A spend needs a unique key (8-80 letters, digits, - _ . :), so a retry never charges twice.', 'key_required');
  const userId = user._id;
  const spendKey = `spend:${k}`;
  const ledgerKey = `cc-spend-${userId}-${k}`;

  // A retry of a spend that already went through: the same answer, no new charge.
  const done = await ledger.findByKey?.(ledgerKey);
  if (done) return replay(userId, done);

  const { catalogVersion, items } = await itemCatalog.onSale(game);
  const item = items.find((i) => i.id === String(itemId || '').toUpperCase());
  if (!item) fail(404, 'This item is not on sale.', 'not_on_sale');
  if (item.free || !item.priceCosCoin) fail(409, 'This is a free reward: claim it in the shop.', 'free_item');
  if (item.dropEndsAt && new Date(item.dropEndsAt) <= new Date()) fail(404, 'This offer has ended.', 'not_on_sale');
  if (!item.stackable && (await ItemOwnership.exists({ user: userId, itemId: item.id, quantity: { $gte: 1 } }))) fail(409, 'You already own this.', 'already_owned');

  // Bought-only items take bought coins; any other item takes earned coins
  // first, then bought ones (agreed with Subomi). One atomic step.
  const price = item.priceCosCoin;
  const boughtOnly = Boolean(item.boughtCoinsOnly);
  const balanceNow = { $ifNull: ['$balance', 0] };
  const boughtNow = { $min: [{ $ifNull: ['$purchased', 0] }, balanceNow] };
  const taken = await Wallet.updateOne(
    { user: userId, frozen: { $ne: true }, applied: { $ne: spendKey }, $expr: { $gte: [boughtOnly ? boughtNow : balanceNow, price] } },
    [
      {
        $set: {
          balance: { $subtract: [balanceNow, price] },
          purchased: boughtOnly ? { $subtract: [boughtNow, price] } : { $min: [boughtNow, { $subtract: [balanceNow, price] }] },
          applied: { $concatArrays: [{ $ifNull: ['$applied', []] }, [spendKey]] },
        },
      },
    ]
  );
  if (!taken.modifiedCount) {
    const wallet = await Wallet.findOne({ user: userId }).lean();
    if (wallet?.applied?.includes(spendKey)) {
      const again = await ledger.findByKey?.(ledgerKey);
      if (again) return replay(userId, again);
    }
    if (wallet?.frozen) fail(423, 'Your CosCoin wallet is on hold while a payment is reviewed. Contact support.', 'wallet_frozen');
    const coins = require('./coscoinRewards').split(wallet);
    if (boughtOnly) fail(402, 'This item can only be bought with bought CosCoin. Top up on the CosQuest website.', 'not_enough_bought_coins', { ...coins, price, topUp: true });
    fail(402, 'Not enough CosCoin. Top up on the CosQuest website.', 'not_enough_coins', { ...coins, price, topUp: true });
  }

  const tx = await ledger.record({
    key: ledgerKey,
    kind: 'costcoin.spend',
    book: 'costcoin',
    currency: 'CQC',
    lines: [{ account: ledger.ACCOUNTS.wallet(userId), debit: item.priceCosCoin }, { account: ledger.ACCOUNTS.costcoinSpent, credit: item.priceCosCoin }],
    user: userId,
    itemId: item.id,
    priceVersion: catalogVersion,
    memo: `${item.name} (${item.id})${game ? ` in ${game}` : ''}`,
  }).catch((error) => {
    // The coins were taken: the finance check "wallets = issued - spent" flags it until fixed.
    console.error(`[costcoin] ALERT: spend ${ledgerKey} not in the ledger:`, error.message);
    return null;
  });
  await ItemOwnership.updateOne({ user: userId, itemId: item.id }, { $inc: { quantity: 1 }, $set: { kind: item.kind, lastAt: new Date() }, $setOnInsert: { firstAt: new Date() } }, { upsert: true });
  const wallet = await Wallet.findOne({ user: userId }).lean();
  try {
    require('../realtime/socket').emitToUser(String(userId), 'costcoin:spent', { itemId: item.id, price: item.priceCosCoin, balance: wallet?.balance ?? null });
  } catch {}
  return { spent: item.priceCosCoin, item, balance: wallet?.balance ?? 0, transaction: tx?.tx ? `TX-${tx.tx.number}` : null, replay: false };
}

async function replay(userId, tx) {
  const wallet = await Wallet.findOne({ user: userId }).lean();
  const line = tx.lines.find((l) => l.debit > 0);
  return { spent: line?.debit || 0, item: { id: tx.itemId }, balance: wallet?.balance ?? 0, transaction: `TX-${tx.number}`, replay: true };
}

async function inventory(userId) {
  const rows = await ItemOwnership.find({ user: userId, quantity: { $gte: 1 } }).sort({ lastAt: -1 }).lean();
  return rows.map((r) => ({ itemId: r.itemId, kind: r.kind, quantity: r.quantity, firstAt: r.firstAt, lastAt: r.lastAt }));
}

module.exports = { spend, inventory };
