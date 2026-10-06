const mongoose = require('mongoose');

const messageMediaSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true },
    resourceType: { type: String, enum: ['image', 'video', 'raw'], required: true },
    durationSeconds: { type: Number, default: null },
    fileName: { type: String, default: null },
    mimeType: { type: String, default: null },
    sizeBytes: { type: Number, default: null },
    waveform: { type: [Number], default: undefined },
    transcript: { type: String, default: null },
    transcribing: { type: Boolean, default: false },
  },
  { _id: false }
);

// One "call entry" per finished call - see src/utils/callMessage.js. callId
// is what the unique index below dedupes on, so the same call never produces
// two log entries even if its finished status gets broadcast more than once.
const callLogSchema = new mongoose.Schema(
  {
    callId: { type: mongoose.Schema.Types.ObjectId, ref: 'Call', required: true },
    type: { type: String, enum: ['audio', 'video'], required: true },
    status: { type: String, enum: ['declined', 'missed', 'cancelled', 'ended'], required: true },
    durationSeconds: { type: Number, default: null },
    callerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Group calls: true once someone was added, and how many people were
    // actually in the call at some point.
    groupCall: { type: Boolean, default: false },
    participantCount: { type: Number, default: null },
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    kind: { type: String, enum: ['text', 'image', 'video', 'audio', 'file', 'sticker', 'call'], default: 'text' },
    content: { type: String, default: '', trim: true, maxlength: 2000 },
    media: { type: messageMediaSchema, default: null },
    callLog: { type: callLogSchema, default: null },
    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
    // Set when this message was created by forwarding another one, so the UI
    // can show a "Forwarded" label. Points at the original message; the
    // content/media above are this message's own copy, not a live reference.
    forwardedFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },

    // Set when the sender edits `content`; kept separate from `updatedAt` so
    // reactions/reads (which don't touch this document) can't be confused
    // with an actual edit.
    editedAt: { type: Date, default: null },

    // Earlier versions of `content`, newest last, so the author can undo an
    // accidental edit (POST .../rollback). Never sent to other people: only
    // the author knows a message was edited.
    editHistory: {
      type: [
        {
          _id: false,
          content: { type: String, default: '' },
          editedAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },

    // @ mentions: the people tagged in this message (checkbox picker in the
    // app), or everyone in the chat. Mentioned people get a notification.
    mentions: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: [] },
    mentionsEveryone: { type: Boolean, default: false },

    // "Delete for everyone": the row is NEVER removed from the database -
    // only flagged, so it stays auditable. The controller hides the real
    // content/media once this is true and serves a tombstone instead.
    deletedForEveryone: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    // "Delete for me": each id here has hidden this message from their own
    // view only; everyone else (and the raw document) is unaffected.
    deletedFor: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: [] },
  },
  { timestamps: true }
);

messageSchema.index({ conversation: 1, createdAt: -1 });

// Partial, not sparse: only documents where callLog.callId actually exists
// are indexed, so this never conflicts with the other 99% of messages - it
// only stops the same call from getting a second log entry (see
// recordCallMessage's E11000 handling).
messageSchema.index(
  { 'callLog.callId': 1 },
  { unique: true, partialFilterExpression: { 'callLog.callId': { $exists: true } } }
);

module.exports = mongoose.model('Message', messageSchema);
