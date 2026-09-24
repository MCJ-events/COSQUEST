const mongoose = require('mongoose');

const ACTIVE_STATUSES = ['ringing', 'accepted'];

const callSchema = new mongoose.Schema(
  {
    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
    },
    conversationType: {
      type: String,
      enum: ['dm'],
      default: 'dm',
    },
    type: {
      type: String,
      enum: ['audio', 'video'],
      required: true,
    },
    status: {
      type: String,
      enum: ['ringing', 'accepted', 'declined', 'missed', 'cancelled', 'ended'],
      default: 'ringing',
      index: true,
    },
    // Supports a partial unique index so concurrent requests cannot create
    // two active calls in the same DM.
    active: {
      type: Boolean,
      default: true,
      select: false,
    },
    caller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    participants: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      required: true,
      validate: {
        validator: (participants) => participants.length === 2,
        message: 'A direct-message call must have exactly two participants.',
      },
    },
    roomName: {
      type: String,
      required: true,
      unique: true,
    },
    answeredAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

callSchema.pre('validate', function keepActiveStateConsistent(next) {
  this.active = ACTIVE_STATUSES.includes(this.status);
  next();
});

callSchema.index({ participants: 1, status: 1, createdAt: -1 });
callSchema.index(
  { conversation: 1 },
  { unique: true, partialFilterExpression: { active: true } }
);

module.exports = mongoose.model('Call', callSchema);
