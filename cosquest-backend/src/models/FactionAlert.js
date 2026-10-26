const mongoose = require('mongoose');

// A "faction in danger" alert: someone in a call or a voice chat calls their
// whole faction for help. Everyone in the faction gets the `alert:faction`
// socket event and a high-priority push; "Respond" (POST
// /api/alerts/:alertId/respond) puts them into that call or voice chat until
// respondUntil. src/controllers/alertController.js.
const factionAlertSchema = new mongoose.Schema(
  {
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    factionKey: { type: String, required: true },
    source: { type: String, enum: ['call', 'voice'], required: true },
    call: { type: mongoose.Schema.Types.ObjectId, ref: 'Call', default: null },
    voiceRoom: { type: mongoose.Schema.Types.ObjectId, ref: 'VoiceRoom', default: null },
    // The chat the call or voice chat belongs to.
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', default: null },
    message: { type: String, default: '', maxlength: 200 },
    recipientCount: { type: Number, default: 0 },
    // The flare on the sender's circle shows until flareUntil; people can
    // respond until respondUntil.
    flareUntil: { type: Date, required: true },
    respondUntil: { type: Date, required: true },
    responders: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: [] },
  },
  { timestamps: true }
);

// "Did this person send an alert in the last few minutes?" (the rate limit)
factionAlertSchema.index({ sender: 1, createdAt: -1 });

module.exports = mongoose.model('FactionAlert', factionAlertSchema);
