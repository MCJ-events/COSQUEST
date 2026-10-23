const mongoose = require('mongoose');
const { Schema } = mongoose;
const schema = new Schema({
  conversation: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
  host: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  topic: { type: String, required: true, maxlength: 150 },
  description: { type: String, default: '', maxlength: 2000 },
  startsAt: { type: Date, required: true }, endsAt: { type: Date, required: true },
  timeZone: { type: String, required: true }, durationMinutes: { type: Number, min: 5, max: 480 },
  repeat: { type: String, enum: ['none', 'daily', 'weekly', 'monthly'], default: 'none' },
  seriesId: { type: String, default: null }, occurrence: { type: Number, default: 1 },
  // One record for a whole repeating series: startsAt/endsAt are the next
  // occurrence, moved forward once each one ends (meetingTime.rollForward),
  // counted from anchorStartsAt so a monthly call on the 31st stays on the
  // 31st (or the month's last day). Older calls (seriesId) instead have one
  // record per occurrence.
  rollsForward: { type: Boolean, default: false },
  anchorStartsAt: { type: Date, default: null },
  // 9 digits, shown as "123 456 789".
  meetingCode: { type: String },
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
  subjectId: { type: Schema.Types.ObjectId, default: null },
  sparkId: { type: String, default: null }, sparkEngine: { type: String, enum: ['legacy', 'module', null], default: null },
  sparkSubject: { type: String, default: null },
  participants: [{ _id: false, user: { type: Schema.Types.ObjectId, ref: 'User' }, response: { type: String, enum: ['pending', 'accepted', 'declined'], default: 'pending' } }],
  hostVideo: { type: Boolean, default: true }, participantVideo: { type: Boolean, default: false },
  whoCanJoin: { type: String, enum: ['invited', 'group'], default: 'invited' },
  waitingRoom: { type: Boolean, default: true },
  admission: [{ _id: false, user: { type: Schema.Types.ObjectId, ref: 'User' }, status: { type: String, enum: ['waiting', 'admitted', 'denied'] } }],
  inviteCode: { type: String, required: true, unique: true },
  passcode: { type: String, required: true, select: false },
  cancelledAt: { type: Date, default: null }, reminderSentAt: { type: Date, default: null },
}, { timestamps: true, optimisticConcurrency: true });
schema.index({ conversation: 1, startsAt: 1 });
schema.index({ cancelledAt: 1, reminderSentAt: 1, startsAt: 1 });
schema.index({ seriesId: 1, occurrence: 1 });
schema.index({ meetingCode: 1 }, { unique: true, sparse: true });
schema.index({ rollsForward: 1, cancelledAt: 1, endsAt: 1 });
module.exports = mongoose.model('ScheduledCall', schema);
