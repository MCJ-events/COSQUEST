/**
 * Sparks voice commands ("calling all sergeants", "calling all Back-end")
 * -> real CosQuest calls.
 *
 * The leader's phone hears the command, the leader does not cancel it, and
 * the module checks permission (ports.canIssueTargetedCall: admins of the
 * call's chat) and resolves the targets. It then calls
 * ports.onTargetedCall(cmd, targetUserIds), which lands in ring() here:
 *
 *  - targeted_call_start, private_call_request, faction_alert: the targets
 *    are rung into the leader's current call (the call the command was heard
 *    in, else any call the leader is in) through the normal "add people" path
 *    (callController.inviteUsers): blocks either way, "not accepting calls",
 *    "already on another call" and the call's size limits all apply, and
 *    batches of CALL_MAX_INVITES_PER_REQUEST (50). If the leader is on no
 *    call any more, a new call starts in the DM with the first target who
 *    can take it (callController.startCallFor) and the rest are added to it.
 *  - targeted_call_end: nothing to ring.
 *
 * The leader's sockets get `sparks:targeted_call` with who was rung and who
 * was skipped (and why). Targets get the usual `call:incoming`.
 *
 * Who a command can reach (ports.commandMembers): calls live in DMs, so the
 * call's chat is just two people. A leader can also reach the members of
 * every group they own or administer (OPEN_QUESTIONS Q7: admins only). A
 * member who runs no group reaches only the call's own chat.
 */
const mongoose = require('mongoose');
const Call = require('../models/Call');
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const ConversationMember = require('../models/ConversationMember');
const limits = require('../config/callLimits');
const members = require('./members');

const RING_ACTIONS = ['targeted_call_start', 'private_call_request', 'faction_alert'];
const USER_FIELDS = 'profile.username profile.displayName profile.firstName profile.lastName profile.avatarKey profile.avatarPhotoUrl';
const MAX_LED_GROUPS = 50;
const MAX_REACH = 5000;

const idOf = (v) => String(v?._id || v);

/** The call `userId` is in right now: `preferredCallId` if they are in it, else their newest active call. */
async function currentCallOf(userId, preferredCallId) {
  const joined = { active: true, members: { $elemMatch: { user: userId, status: 'joined' } } };
  if (mongoose.isValidObjectId(preferredCallId)) {
    const preferred = await Call.findOne({ _id: preferredCallId, ...joined }, '_id').lean();
    if (preferred) return String(preferred._id);
  }
  const any = await Call.findOne(joined, '_id').sort({ updatedAt: -1 }).lean();
  return any ? String(any._id) : null;
}

// The DM between two people, created if needed (the same rows as
// chatController's getOrCreateDmConversation, which is not exported).
async function dmBetween(userIdA, userIdB) {
  const dmKey = [String(userIdA), String(userIdB)].sort().join('_');
  let conversation = await Conversation.findOne({ type: 'dm', dmKey });
  if (!conversation) {
    try {
      conversation = await Conversation.create({ type: 'dm', dmKey, participants: [userIdA, userIdB] });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      conversation = await Conversation.findOne({ type: 'dm', dmKey });
    }
    await Promise.all(
      [userIdA, userIdB].map((userId) =>
        ConversationMember.updateOne({ conversation: conversation._id, user: userId }, { $setOnInsert: { lastReadAt: new Date(0) } }, { upsert: true })
      )
    );
  }
  return conversation;
}

/**
 * Rings the targets of one voice command. Never throws (it runs from a module
 * hook); returns what it did, which is also sent to the leader as
 * `sparks:targeted_call`.
 */
async function ring(cmd, targetUserIds) {
  const { inviteUsers, startCallFor } = require('../controllers/callController');
  const { emitToUsers } = require('../realtime/socket');
  const issuerId = String(cmd.issuerUserId);
  const action = cmd.intent?.action;
  const result = { commandId: cmd.commandId, action, callId: null, started: false, invited: [], skipped: [] };
  const targets = [...new Set((targetUserIds || []).map(String))].filter((id) => id !== issuerId && mongoose.isValidObjectId(id));
  try {
    if (!RING_ACTIONS.includes(action) || !targets.length) return result;
    const issuer = await User.findById(issuerId).select(USER_FIELDS);
    if (!issuer) return result;

    let callId = await currentCallOf(issuerId, cmd.callId);
    let pending = targets;
    if (!callId) {
      // The leader left the call: start one with the first target who can take it.
      while (pending.length && !callId) {
        const first = pending.shift();
        const started = await startCallFor(issuer, await dmBetween(issuerId, first), first, 'audio');
        if (started.call) {
          callId = String(started.call._id);
          result.started = true;
          result.invited.push(first);
        } else {
          result.skipped.push({ userId: first, reason: started.error.status === 409 ? 'busy' : 'unavailable' });
        }
      }
    }
    result.callId = callId;
    if (!callId) return result;

    const batch = limits.maxInvitesPerRequest();
    for (let i = 0; i < pending.length; i += batch) {
      const userIds = pending.slice(i, i + batch);
      const r = await inviteUsers(callId, issuer, { userIds });
      result.skipped.push(...(r.skipped || []));
      if (!r.error) {
        result.invited.push(...r.invited);
        continue;
      }
      // 409 "Nobody could be added" is per batch; anything else (the call ended, the leader left) stops here.
      if (r.error.status !== 409) {
        for (const userId of pending.slice(i + batch)) result.skipped.push({ userId, reason: 'call_ended' });
        break;
      }
    }
    return result;
  } catch (error) {
    console.warn('[sparks] targeted call failed:', error.message);
    result.error = 'failed';
    return result;
  } finally {
    emitToUsers([issuerId], 'sparks:targeted_call', {
      ...result,
      intent: cmd.intent || null,
      utterance: typeof cmd.utterance === 'string' ? cmd.utterance : null,
      sparksCallId: cmd.callId,
    });
  }
}

/** Groups `userId` owns or administers (live, not banned). */
async function ledGroupIds(userId) {
  if (!mongoose.isValidObjectId(userId)) return [];
  const rows = await ConversationMember.find({ user: userId, role: { $in: ['owner', 'admin'] } }, 'conversation')
    .sort({ updatedAt: -1 })
    .limit(MAX_LED_GROUPS)
    .lean();
  const ids = rows.map((r) => String(r.conversation));
  const ok = await Promise.all(ids.map((id) => members.isAdmin(String(userId), id)));
  return ids.filter((_, i) => ok[i]);
}

/**
 * ports.commandMembers: the call's chat members plus the members of every
 * group the leader runs, de-duplicated, at most MAX_REACH people.
 */
async function commandMembers(callId, chatId, issuerUserId) {
  const lists = [await members.chatMembers(chatId)];
  for (const groupId of await ledGroupIds(issuerUserId)) {
    if (groupId !== String(chatId)) lists.push(await members.chatMembers(groupId));
  }
  const byId = new Map();
  for (const list of lists) for (const m of list) if (!byId.has(m.userId)) byId.set(m.userId, m);
  return [...byId.values()].slice(0, MAX_REACH);
}

/**
 * GET /api/calls/:callId/command-context - what the app passes to the SDK
 * as `commands` in startTranscription (CommandContext): the ranks, roles and
 * people this user's voice commands can target in this call, and whether
 * they may issue commands at all.
 */
async function getCommandContext(req, res) {
  const host = require('./index');
  if (!host.isModule() || !host.isReady()) return res.status(503).json({ error: 'Sparks are unavailable right now.' });
  const callId = String(req.params.callId);
  const userId = String(req.userId);
  if (!mongoose.isValidObjectId(callId) || !(await Call.exists({ _id: callId, participants: userId }))) {
    return res.status(404).json({ error: 'Call not found.' });
  }
  const call = await Call.findById(callId, 'conversation').lean();
  const chatId = idOf(call.conversation);
  const canIssue = await members.isAdmin(userId, chatId);
  const reach = canIssue ? await commandMembers(callId, chatId, userId) : [];
  const people = reach.filter((m) => m.userId !== userId);
  return res.json({
    callId,
    canIssue,
    ranks: host.backend.config.ranks,
    roles: [...new Set(people.flatMap((m) => m.roles))].sort(),
    groups: [],
    members: people.map((m) => ({ userId: m.userId, displayName: m.displayName })),
  });
}

module.exports = { ring, commandMembers, getCommandContext, currentCallOf, RING_ACTIONS };
