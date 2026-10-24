const mongoose = require('mongoose');
const limits = require('../config/callLimits');

// One document per call. A call always starts in a DM (one-to-one), and
// anyone in it can then add more people - it becomes a group call.
//
// Call status (the call as a whole):
//   ringing   - nobody has answered yet
//   accepted  - at least two people are talking
//   declined  - everyone invited said no
//   missed    - nobody answered in time
//   cancelled - the caller hung up before anyone answered
//   ended     - the call finished after being answered
//
// Each person also has their own status in `members`:
//   ringing   - their phone is ringing
//   joined    - they're in the call
//   declined  - they said no
//   missed    - they didn't answer within 45 seconds
//   left      - they were in the call and left (they can join again)
//
// Private calls ("private call on top"): two people in a call or a voice
// chat step aside into a one-to-one call of their own (its own LiveKit room)
// without leaving the first one. `privateOf` is that call's or voice chat's
// id and `privateOfType` says which. While a private call is answered, the
// main call shows both people as away (worked out from the private calls,
// see callController's awayIn). A private call keeps going if the main one
// ends. Each person is in at most one private call at a time.

// Size limits come from env (src/config/callLimits.js):
//   CALL_MAX_IN_CALL       people ringing or in the call at the same time (default 1000)
//   CALL_MAX_EVER_INVITED  everyone who was ever part of one call (default 5000)

const callMemberSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: {
      type: String,
      enum: ['ringing', 'joined', 'declined', 'missed', 'left'],
      required: true,
    },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    invitedAt: { type: Date, default: Date.now },
    joinedAt: { type: Date, default: null },
    leftAt: { type: Date, default: null },
    // LiveKit says they dropped out (webhook); cleared when they reconnect.
    // Still gone after a short grace period: they have left the call.
    disconnectedAt: { type: Date, default: null },
  },
  { _id: false }
);

const callSchema = new mongoose.Schema(
  {
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
    // 'dm' for every normal call. A private call from a voice chat has its
    // room's type.
    conversationType: { type: String, enum: ['dm', 'community', 'faction', 'group'], default: 'dm' },
    isPrivate: { type: Boolean, default: false },
    privateOf: { type: mongoose.Schema.Types.ObjectId, default: null },
    privateOfType: { type: String, enum: ['call', 'voice', null], default: null },
    type: { type: String, enum: ['audio', 'video'], required: true },
    status: {
      type: String,
      enum: ['ringing', 'accepted', 'declined', 'missed', 'cancelled', 'ended'],
      default: 'ringing',
      index: true,
    },
    // True while the call is ringing or in progress (set automatically).
    active: { type: Boolean, default: true, select: false },
    caller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // True once someone has been added to the call.
    isGroup: { type: Boolean, default: false },
    // Everyone who was ever part of this call (caller included). Used for
    // "can this person see this call?".
    participants: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      required: true,
      validate: {
        validator: (participants) =>
          participants.length >= 2 && participants.length <= limits.maxEverInvited(),
        message: () => `A call needs between 2 and ${limits.maxEverInvited()} people.`,
      },
    },
    // Each person's own status in this call.
    members: { type: [callMemberSchema], default: [] },
    // Who is ringing or in the call right now (set automatically). Used for
    // "is this person already on a call?".
    activeMembers: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      default: [],
    },
    roomName: { type: String, required: true, unique: true },
    // Who is sharing their screen (one person at a time), or null.
    screenShare: {
      type: new mongoose.Schema({ user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, startedAt: Date }, { _id: false }),
      default: null,
    },
    answeredAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    // Two people acting on the same call at the same moment (e.g. both
    // answering) can't overwrite each other: the second save is retried.
    optimisticConcurrency: true,
  }
);

callSchema.pre('validate', function keepActiveStateConsistent(next) {
  this.active = ['ringing', 'accepted'].includes(this.status);
  this.activeMembers = this.active
    ? this.members
        .filter((member) => ['ringing', 'joined'].includes(member.status))
        .map((member) => member.user?._id || member.user)
    : [];
  // A screen share ends when the call ends or the person sharing leaves it.
  if (this.screenShare?.user) {
    const sharer = String(this.screenShare.user?._id || this.screenShare.user);
    const stillIn = this.members.some((member) => String(member.user?._id || member.user) === sharer && member.status === 'joined');
    if (!this.active || !stillIn) this.screenShare = null;
  }
  next();
});

// "Is anyone calling me?"
callSchema.index({ participants: 1, status: 1, createdAt: -1 });

// "Is this person already ringing or on a call?"
callSchema.index({ activeMembers: 1 });

// One active call per DM, even when two start requests arrive together.
// Private calls don't count: several can run from one call or voice chat.
callSchema.index(
  { conversation: 1, isPrivate: 1 },
  { unique: true, partialFilterExpression: { active: true, isPrivate: false } }
);

// One active private call per person, even when two arrive together.
callSchema.index(
  { activeMembers: 1, isPrivate: 1 },
  { unique: true, partialFilterExpression: { active: true, isPrivate: true } }
);

// "Who is away in this call or voice chat?"
callSchema.index(
  { privateOf: 1 },
  { partialFilterExpression: { active: true, isPrivate: true } }
);

const Call = mongoose.model('Call', callSchema);

// Kept for anything that read the old constant; the live value is
// limits.maxInCall(), which follows CALL_MAX_IN_CALL.
Object.defineProperty(Call, 'MAX_IN_CALL', { get: () => limits.maxInCall() });
Object.defineProperty(Call, 'MAX_EVER_INVITED', { get: () => limits.maxEverInvited() });

// The old one-to-one version had a unique index allowing each person in only
// one active call, built on `participants`. That index would block group
// calls, so it's removed automatically once, on startup. ("Already on
// another call" is now checked in the controller, using `activeMembers`.)
//
// The same goes for the old "one active call per DM" index (`conversation_1`),
// which would also block a second private call from the same voice chat: the
// calls in progress are marked as not private (so the new index covers them),
// the new indexes are built, then the old one is removed.
async function dropLegacyIndex() {
  const ignore = () => {
    // Already removed (or never existed) - nothing to do.
  };
  Call.collection.dropIndex('participants_1').catch(ignore);
  try {
    await Call.updateMany({ active: true, isPrivate: { $exists: false } }, { $set: { isPrivate: false } });
    await Call.init();
    await Call.collection.dropIndex('conversation_1').catch(ignore);
  } catch (error) {
    console.error('[calls] index update failed:', error.message);
  }
}

if (mongoose.connection.readyState === 1) {
  dropLegacyIndex();
} else {
  mongoose.connection.once('open', dropLegacyIndex);
}

module.exports = Call;
