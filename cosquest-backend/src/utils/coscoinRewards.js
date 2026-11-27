// CosCoin earned in games, and wallet flags (agreed with Subomi, 23 Nov 2026).
//
//   grant(userId, { amount, reason, key, game })   coins earned in gameplay
//     - only the game server calls it (secret key, coscoinGameController.js)
//     - once per key (a retry never pays twice), never to a frozen wallet
//     - a daily cap per player (COSCOIN_REWARD_DAILY_CAP, default 500), atomic
//     - ledger (CosCoin book): "Reward", debit CosCoin Rewards / credit <user> Wallet
//     - earned coins are kept apart from bought ones (Wallet.purchased): some items
//       can only be bought with bought coins
//   flag(userId, { reason, by, freeze })   a fraud flag (the game or an admin)
//   unfreeze(userId, { reason, by })       an admin lets the wallet spend again
const Wallet = require('../models/Wallet');
const User = require('../models/User');
const ledger = require('./ledger');

function fail(status, message, code, extra) {
  throw Object.assign(new Error(message), { status, ...(code ? { code } : {}), ...(extra ? { extra } : {}) });
}

const today = () => new Date().toISOString().slice(0, 10);
const dailyCap = () => {
  const n = Number.parseInt(process.env.COSCOIN_REWARD_DAILY_CAP, 10);
  return Number.isInteger(n) && n > 0 ? n : 500;
};
const cleanKey = (key) => String(key || '').trim().slice(0, 80);

async function ensureWallet(userId) {
  try {
    await Wallet.updateOne({ user: userId }, { $setOnInsert: { balance: 0, purchased: 0 } }, { upsert: true });
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }
}

async function grant(userId, { amount, reason, key, game = null }) {
  const k = cleanKey(key);
  if (!/^[A-Za-z0-9_.:-]{8,80}$/.test(k)) fail(400, 'A reward needs a unique key (8-80 letters, digits, - _ . :), so a retry never pays twice.', 'key_required');
  const coins = Number(amount);
  if (!Number.isInteger(coins) || coins < 1 || coins > 10000) fail(400, 'amount is a whole number of CosCoin from 1 to 10000.', 'bad_amount');
  const why = String(reason || '').trim().slice(0, 120);
  if (why.length < 2) fail(400, 'A reason is required (e.g. "Won raid R-12").', 'reason_required');
  const user = await User.findById(userId).select('_id').lean().catch(() => null);
  if (!user) fail(404, 'Member not found.', 'member_not_found');

  const ledgerKey = `cc-reward-${userId}-${k}`;
  const done = await ledger.findByKey(ledgerKey);
  if (done) return { granted: done.lines.find((l) => l.credit > 0)?.credit || coins, balance: (await Wallet.findOne({ user: userId }).lean())?.balance ?? 0, transaction: `TX-${done.number}`, replay: true };

  await ensureWallet(userId);
  const day = today();
  const cap = dailyCap();
  const rewardKey = `reward:${k}`;
  // One atomic step: not frozen, this key unused, and today's rewards stay within the cap.
  const result = await Wallet.updateOne(
    {
      user: userId,
      frozen: { $ne: true },
      applied: { $ne: rewardKey },
      $expr: { $lte: [{ $cond: [{ $eq: ['$rewardDay', day] }, { $add: [{ $ifNull: ['$rewardToday', 0] }, coins] }, coins] }, cap] },
    },
    [
      {
        $set: {
          balance: { $add: [{ $ifNull: ['$balance', 0] }, coins] },
          rewardToday: { $cond: [{ $eq: ['$rewardDay', day] }, { $add: [{ $ifNull: ['$rewardToday', 0] }, coins] }, coins] },
          rewardDay: day,
          applied: { $concatArrays: [{ $ifNull: ['$applied', []] }, [rewardKey]] },
        },
      },
    ]
  );
  if (!result.modifiedCount) {
    const w = await Wallet.findOne({ user: userId }).lean();
    if (w?.applied?.includes(rewardKey)) {
      const again = await ledger.findByKey(ledgerKey);
      if (again) return { granted: coins, balance: w.balance, transaction: `TX-${again.number}`, replay: true };
    }
    if (w?.frozen) fail(423, 'This wallet is on hold.', 'wallet_frozen');
    fail(429, `Daily reward limit reached (${cap} CosCoin a day).`, 'daily_cap', { cap, today: w?.rewardDay === day ? w.rewardToday || 0 : 0 });
  }
  const tx = await ledger.record({
    key: ledgerKey,
    kind: 'costcoin.reward',
    book: 'costcoin',
    currency: 'CQC',
    lines: [{ account: ledger.ACCOUNTS.costcoinRewards, debit: coins }, { account: ledger.ACCOUNTS.wallet(userId), credit: coins }],
    user: userId,
    itemId: game ? String(game).slice(0, 28) : null,
    memo: why,
  }).catch((error) => {
    console.error(`[coscoin] ALERT: reward ${ledgerKey} not in the ledger:`, error.message);
    return null;
  });
  const w = await Wallet.findOne({ user: userId }).lean();
  try {
    require('../realtime/socket').emitToUser(String(userId), 'costcoin:credited', { added: coins, balance: w?.balance ?? null, earned: true });
  } catch {}
  return { granted: coins, balance: w?.balance ?? coins, transaction: tx?.tx ? `TX-${tx.tx.number}` : null, replay: false };
}

/** A fraud flag. freeze: also stop spending (and rewards) until an admin unfreezes it. */
async function flag(userId, { reason, by, freeze = true }) {
  const why = String(reason || '').trim().slice(0, 300);
  if (why.length < 3) fail(400, 'A reason is required.', 'reason_required');
  const user = await User.findById(userId).select('_id').lean().catch(() => null);
  if (!user) fail(404, 'Member not found.', 'member_not_found');
  await ensureWallet(userId);
  await Wallet.updateOne(
    { user: userId },
    { $push: { flags: { $each: [{ reason: why, by: String(by || 'unknown').slice(0, 60), at: new Date() }], $slice: -50 } }, ...(freeze ? { $set: { frozen: true, frozenReason: why } } : {}) }
  );
  return Wallet.findOne({ user: userId }).lean();
}

async function unfreeze(userId, { reason, by }) {
  const why = String(reason || '').trim().slice(0, 300);
  if (why.length < 3) fail(400, 'A reason is required.', 'reason_required');
  const w = await Wallet.findOne({ user: userId }).lean();
  if (!w?.frozen) fail(409, 'This wallet is not frozen.', 'not_frozen');
  await Wallet.updateOne({ user: userId }, { $set: { frozen: false, frozenReason: null }, $push: { flags: { $each: [{ reason: `Unfrozen: ${why}`, by: String(by || 'admin').slice(0, 60), at: new Date() }], $slice: -50 } } });
  return Wallet.findOne({ user: userId }).lean();
}

/** { balance, bought, earned }: earned coins are the ones not bought. */
function split(w) {
  const balance = w?.balance || 0;
  const bought = Math.max(0, Math.min(balance, w?.purchased || 0));
  return { balance, bought, earned: balance - bought };
}

module.exports = { grant, flag, unfreeze, split, dailyCap };
