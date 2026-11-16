// The checkout pass: paying on the CosQuest website (payment brief, decision 2).
//
// The app asks for a link (POST /api/payments/handoff) and opens it in the
// browser; the website swaps it, ONCE, for a checkout-only pass
// (POST /api/payments/handoff/redeem) and pays with it.
//
// SAFETY (as Emmanuel set out):
//  - purpose: 'checkout'. verifyToken (src/utils/token.js) refuses any token
//    with a purpose, so a pass can never open the app or the socket.
//  - Signed with its own key (an HMAC of JWT_SECRET), like the call decline
//    pass: a login token can't pass as a checkout pass either.
//  - HS256 pinned when verifying.
//  - Tied to the member AND the quest; carries the member's tokenVersion, so
//    logging out cancels it.
//  - Short: CHECKOUT_LINK_MINUTES (default 20). The pass the link is swapped
//    for ends at the same moment (it is never extended).
//  - The link works once: its id is claimed in Redis (SET NX).
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const PURPOSE = 'checkout';
const minutes = () => Math.min(Math.max(Number(process.env.CHECKOUT_LINK_MINUTES) || 20, 5), 60);
const key = () => crypto.createHmac('sha256', process.env.JWT_SECRET).update('checkout').digest();

/**
 * kind 'link': in the URL the app opens. kind 'session': what the website
 * holds after swapping the link. exp: the session pass ends with its link.
 */
function signPass(user, { questId, ticketTypeId = null, kind = 'link', exp = null }) {
  const claims = {
    sub: String(user._id || user.id),
    tv: user.tokenVersion || 0,
    quest: String(questId),
    ...(ticketTypeId ? { tt: String(ticketTypeId) } : {}),
    kind,
    purpose: PURPOSE,
    jti: crypto.randomBytes(12).toString('hex'),
    exp: exp || Math.floor(Date.now() / 1000) + minutes() * 60,
  };
  return { token: jwt.sign(claims, key(), { algorithm: 'HS256' }), expiresAt: new Date(claims.exp * 1000), claims };
}

/** The pass's claims, or null (expired, forged, a login token, the wrong kind). */
function verifyPass(token, kind) {
  try {
    const claims = jwt.verify(String(token || ''), key(), { algorithms: ['HS256'] });
    if (claims.purpose !== PURPOSE || claims.kind !== kind || !claims.sub || !claims.quest || !claims.jti) return null;
    return claims;
  } catch {
    return null;
  }
}

/** Claims a link's one use (true the first time only). Redis, so every server instance agrees. */
async function claimOnce(claims) {
  const ttl = Math.max(60, claims.exp - Math.floor(Date.now() / 1000) + 60);
  const result = await require('../config/redis').getRedisClient().set(`checkout:used:${claims.jti}`, '1', 'EX', ttl, 'NX');
  return result === 'OK';
}

module.exports = { signPass, verifyPass, claimOnce, minutes, PURPOSE };
