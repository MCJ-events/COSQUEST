const mongoose = require('mongoose');

const messageMediaSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true },
    resourceType: { type: String, enum: ['image', 'video'], required: true }, // Cloudinary's type; voice notes are 'video' there too
    durationSeconds: { type: Number, default: null },
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    kind: { type: String, enum: ['text', 'image', 'audio'], default: 'text' },
    content: { type: String, default: '', trim: true, maxlength: 2000 },
    media: { type: messageMediaSchema, default: null },
    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },

    // Set when the sender edits `content`; kept separate from `updatedAt` so
    // reactions/reads (which don't touch this document) can't be confused
    // with an actual edit.
    editedAt: { type: Date, default: null },

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

module.exports = mongoose.model('Message', messageSchema);
