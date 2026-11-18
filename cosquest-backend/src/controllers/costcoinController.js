// Costcoin for members (buying on the CosQuest website, the wallet).
//
//   GET  /api/costcoin/bundles             (public) bundles on sale + price version
//   POST /api/costcoin/handoff             (app, logged in) { bundleId } -> { url, expiresAt }: the 20-minute link
//   POST /api/costcoin/handoff/redeem      (website) { h } -> the checkout pass + the bundle (once per link)
//   POST /api/costcoin/checkout            (website, Bearer <checkout pass>) -> { order, checkoutUrl }: Stripe's page
//   GET  /api/costcoin/orders/:orderId     (website, Bearer <checkout pass>) the purchase (the return page)
//   GET  /api/costcoin/wallet              (app, logged in) { balance, frozen, history }
//
// The checkout pass is the tickets' one (src/utils/checkoutPass.js): for
// Costcoin its quest claim is "costcoin:<bundle>", so a Costcoin pass can
// never buy a ticket, and a ticket pass never buys coins.
const mongoose = require('mongoose');
const User = require('../models/User');
const CostcoinOrder = require('../models/CostcoinOrder');
const pass = require('../utils/checkoutPass');
const payments = require('../utils/stripe');
const costcoin = require('../utils/costcoin');

const FOR = 'costcoin:';

function answer(res, error) {
  if (error.status) return res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}), ...(error.extra || {}) });
  throw error;
}

async function memberFor(claims) {
  const user = await User.findById(claims.sub);
  if (!user || (user.tokenVersion || 0) !== claims.tv) return null;
  if (require('../utils/communityRestrictions').suspendedAnswer(user)) return null;
  return user;
}

async function handoff(req, res) {
  try {
    await costcoin.mayBuy(req.user, req.ip);
    const { bundle } = await costcoin.bundleOnSale(req.body?.bundleId);
    const { token, expiresAt } = pass.signPass(req.user, { questId: `${FOR}${bundle.id}`, kind: 'link' });
    return res.status(201).json({ url: `${payments.appWebUrl()}/checkout/costcoin?h=${encodeURIComponent(token)}`, expiresAt });
  } catch (error) {
    return answer(res, error);
  }
}

async function redeem(req, res) {
  try {
    const claims = pass.verifyPass(req.body?.h, 'link');
    if (!claims || !String(claims.quest).startsWith(FOR)) return res.status(401).json({ error: 'This checkout link has expired. Go back to CosQuest and tap Buy again.', code: 'link_expired' });
    if (!(await pass.claimOnce(claims))) return res.status(409).json({ error: 'This checkout link was already used. Go back to CosQuest and tap Buy again.', code: 'link_used' });
    const user = await memberFor(claims);
    if (!user) return res.status(401).json({ error: 'Please sign in to CosQuest again, then tap Buy.', code: 'signed_out' });
    const { bundle, priceVersion } = await costcoin.bundleOnSale(String(claims.quest).slice(FOR.length));
    await costcoin.mayBuy(user, req.ip);
    const session = pass.signPass(user, { questId: claims.quest, kind: 'session', exp: claims.exp });
    const p = user.profile || {};
    return res.json({
      checkoutToken: session.token,
      expiresAt: session.expiresAt,
      member: { name: p.displayName || [p.firstName, p.lastName].filter(Boolean).join(' ') || p.username || 'You', username: p.username || null },
      bundle,
      priceVersion,
      wallet: await costcoin.wallet(user._id),
    });
  } catch (error) {
    return answer(res, error);
  }
}

async function checkout(req, res) {
  try {
    if (!String(req.checkout?.quest).startsWith(FOR)) return res.status(401).json({ error: 'This checkout has expired. Go back to CosQuest and tap Buy again.', code: 'checkout_expired' });
    const started = await costcoin.startPurchase({ user: req.user, bundleId: String(req.checkout.quest).slice(FOR.length), ip: req.ip });
    return res.status(started.reused ? 200 : 201).json({ order: costcoin.orderJson(started.order), checkoutUrl: started.order.stripe?.checkoutUrl || null, reused: Boolean(started.reused) });
  } catch (error) {
    return answer(res, error);
  }
}

async function order(req, res) {
  if (!mongoose.isValidObjectId(req.params.orderId) || !String(req.checkout?.quest).startsWith(FOR)) return res.status(404).json({ error: 'Purchase not found.' });
  let found = await CostcoinOrder.findOne({ _id: req.params.orderId, user: req.user._id });
  if (!found) return res.status(404).json({ error: 'Purchase not found.' });
  if (found.status === 'pending') found = await costcoin.reconcileOrder(found);
  return res.json({ order: costcoin.orderJson(found), wallet: await costcoin.wallet(req.user._id) });
}

async function walletAndHistory(req, res) {
  const offset = Math.max(0, Math.min(100000, Number.parseInt(req.query.offset, 10) || 0));
  const [wallet, history] = await Promise.all([costcoin.wallet(req.user._id), costcoin.history(req.user._id, { offset })]);
  return res.json({ ...wallet, history, offset });
}

module.exports = { handoff, redeem, checkout, order, walletAndHistory };
