// Admin CosCoin adjustments (wallet spec, section 6: restricted, logged, a second person).
//   request()       an admin asks to add or remove coins for one member, with a reason
//   checkApplies()  before a second person approves: a removal needs the coins to be there
//   applyApproved() applied once on approval; ledger (CosCoin book) "Adjustment":
//                   add:    debit CosCoin Adjustments / credit <user> Wallet (earned coins)
//                   remove: debit <user> Wallet / credit CosCoin Adjustments (earned coins first)
//                   the entry names who asked (createdBy) and who approved (approvedBy)
const ApprovalRequest = require('../models/ApprovalRequest');
const Counter = require('../models/Counter');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const ledger = require('./ledger');

function fail(status, message, code) {
  throw Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}

async function request(admin, { username, amount, reason }) {
  const name = String(username || '').trim().replace(/^@/, '').toLowerCase();
  if (!name) fail(400, 'Which member? (username)', 'username_required');
  const coins = Number(amount);
  if (!Number.isInteger(coins) || coins === 0 || Math.abs(coins) > 10000) fail(400, 'The amount is a whole number of CosCoin, from -10000 to 10000, not 0.', 'bad_amount');
  const why = String(reason || '').trim();
  if (why.length < 3) fail(400, 'A reason is required.', 'reason_required');
  const user = await User.findOne({ 'profile.usernameNormalized': name }).select('_id profile.username').lean();
  if (!user) fail(404, 'Member not found.', 'member_not_found');
  const member = `@${user.profile?.username || name}`;
  if (coins < 0) await checkBalance(user._id, -coins);
  return ApprovalRequest.create({
    number: await Counter.next('approval', 1),
    kind: 'coscoin_adjustment',
    title: `CosCoin adjustment: ${coins > 0 ? '+' : ''}${coins} for ${member}`.slice(0, 160),
    changes: { userId: String(user._id), member, amount: coins },
    reason: why.slice(0, 500),
    requestedBy: admin._id,
  });
}

async function checkBalance(userId, coins) {
  const w = await Wallet.findOne({ user: userId }).lean();
  if ((w?.balance || 0) < coins) fail(409, `The member has ${w?.balance || 0} CosCoin: ${coins} can't be removed. Reject this request or ask for less.`, 'not_enough_coins');
}

async function checkApplies(request) {
  const { userId, amount } = request.changes || {};
  if (amount < 0) await checkBalance(userId, -amount);
}

async function applyApproved(request, admin) {
  const { userId, member, amount } = request.changes || {};
  const key = `adjust:${request._id}`;
  const coins = Math.abs(amount);
  try {
    await Wallet.updateOne({ user: userId }, { $setOnInsert: { balance: 0, purchased: 0 } }, { upsert: true });
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }
  const balanceNow = { $ifNull: ['$balance', 0] };
  const result =
    amount > 0
      ? await Wallet.updateOne({ user: userId, applied: { $ne: key } }, [{ $set: { balance: { $add: [balanceNow, coins] }, applied: { $concatArrays: [{ $ifNull: ['$applied', []] }, [key]] } } }])
      : await Wallet.updateOne(
          { user: userId, applied: { $ne: key }, $expr: { $gte: [balanceNow, coins] } },
          [
            {
              $set: {
                balance: { $subtract: [balanceNow, coins] },
                // Earned coins go first; bought coins only when no earned ones are left.
                purchased: { $min: [{ $ifNull: ['$purchased', 0] }, { $subtract: [balanceNow, coins] }] },
                applied: { $concatArrays: [{ $ifNull: ['$applied', []] }, [key]] },
              },
            },
          ]
        );
  if (!result.modifiedCount) {
    const w = await Wallet.findOne({ user: userId }).lean();
    if (!w?.applied?.includes(key)) {
      // A spend took the coins in the meantime: the request goes back to waiting.
      await ApprovalRequest.updateOne({ _id: request._id, status: 'approved' }, { $set: { status: 'pending', decidedBy: null, decidedAt: null, decisionNote: '' } });
      fail(409, `The member now has ${w?.balance || 0} CosCoin: ${coins} can't be removed. The request is waiting again.`, 'not_enough_coins');
    }
  }
  await ledger.record({
    key: `cc-adjust-${request._id}`,
    kind: 'costcoin.adjustment',
    book: 'costcoin',
    currency: 'CQC',
    lines:
      amount > 0
        ? [{ account: ledger.ACCOUNTS.costcoinAdjustments, debit: coins }, { account: ledger.ACCOUNTS.wallet(userId), credit: coins }]
        : [{ account: ledger.ACCOUNTS.wallet(userId), debit: coins }, { account: ledger.ACCOUNTS.costcoinAdjustments, credit: coins }],
    user: userId,
    memo: `${amount > 0 ? 'Added' : 'Removed'} ${coins} CosCoin ${amount > 0 ? 'to' : 'from'} ${member}: ${request.reason} (AP-${request.number})`.slice(0, 300),
    createdBy: request.requestedBy,
    approvedBy: [admin._id],
  });
}

module.exports = { request, checkApplies, applyApproved };
