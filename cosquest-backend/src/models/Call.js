const mongoose = require('mongoose');

// One document per call, always linked to the DM it happened in.
//
// status:
//   ringing   - waiting for an answer
//   accepted  - the other person answered
//   declined  - the other person tapped Decline
//   missed    - nobody answered within 45 seconds
//   cancelled - the caller hung up before it was answered
//   ended     - the call finished after being answered

const callSchema = new mongoose.Schema(
  {
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
    conversationType: { type: String, enum: ['dm'], default: 'dm' },
    type: { type: String, enum: ['audio', 'video'], required: true },
    status: {
      type: String,
      enum: ['ringing', 'accepted', 'declined', 'missed', 'cancelled', 'ended'],
      default: 'ringing',
      index: true,
    },
    // Used by partial unique indexes to prevent overlapping active calls.
    active: { type: Boolean, default: true, select: false },
    caller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Copied from the DM's participants when the call starts (caller included),
    // so "who is in this call" never needs a second lookup.
    participants: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      required: true,
      validate: {
        validator: (participants) => participants.length === 2,
        message: 'A direct-message call must have exactly two participants.',
      },
    },
    roomName: { type: String, required: true, unique: true },
    answeredAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

callSchema.pre('validate', function keepActiveStateConsistent(next) {
  this.active = ['ringing', 'accepted'].includes(this.status);
  next();
});

// "Is anyone calling me?" and "is this person already on a call?"
callSchema.index({ participants: 1, status: 1, createdAt: -1 });

// One active call per DM, even when two start requests arrive together.
callSchema.index(
  { conversation: 1 },
  { unique: true, partialFilterExpression: { active: true } }
);

// One person cannot take part in two active calls in different DMs.
callSchema.index(
  { participants: 1 },
  { unique: true, partialFilterExpression: { active: true } }
);

module.exports = mongoose.model('Call', callSchema);
