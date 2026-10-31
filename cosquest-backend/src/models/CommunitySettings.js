const mongoose = require('mongoose');

/**
 * The community's settings (admin dashboard, Settings): one document,
 * _id 'community'. Edited only by super admins; every change is recorded in
 * the audit log with what it was before and after. `version` stops two
 * admins from overwriting each other (PATCH sends the version it read).
 *
 * Settings marked "needs email" are stored but have no effect until the
 * backend can send email.
 */
const communitySettingsSchema = new mongoose.Schema(
  {
    _id: { type: String, default: 'community' },
    version: { type: Number, default: 1 },
    identity: {
      name: { type: String, default: 'CosQuest', trim: true, maxlength: 80 },
      url: { type: String, default: '', trim: true, maxlength: 200 },
      description: {
        type: String,
        default: 'A space for cosplayers, gamers and makers to share creations, find their crew and turn the next meetup into a quest.',
        trim: true,
        maxlength: 500,
      },
      emblemUrl: { type: String, default: null },
      language: { type: String, default: 'en-US', maxlength: 20 },
      reportingTimeZone: { type: String, default: 'America/Los_Angeles', maxlength: 60 },
    },
    guidelines: {
      title: { type: String, default: 'Create boldly. Treat people kindly.', trim: true, maxlength: 120 },
      standards: {
        type: String,
        default:
          '1. Respect every member. No harassment, threats or targeted personal remarks.\n2. Credit creators. Share original work or include permission and attribution.\n3. Keep members safe. No scams, deceptive links or impersonation.\n4. Stay on topic. Use groups and Sparks to keep conversations useful.',
        trim: true,
        maxlength: 4000,
      },
      requireAcceptance: { type: Boolean, default: false },
    },
    privacy: {
      visibility: { type: String, enum: ['members', 'public'], default: 'members' },
      allowMemberInvitations: { type: Boolean, default: true },
      showMemberDirectory: { type: Boolean, default: true },
      publicSearchIndexing: { type: Boolean, default: false },
    },
    notifications: {
      highPriorityAlerts: { type: Boolean, default: true },
      joinRequestSummaries: { type: Boolean, default: true },
      roleChanges: { type: Boolean, default: true },
      // Needs email.
      dailyDigest: { type: Boolean, default: false },
      digestTime: { type: String, default: '09:00', match: /^([01]\d|2[0-3]):[0-5]\d$/ },
      digestTo: { type: String, default: '', trim: true, maxlength: 254 },
    },
    moderation: {
      // 'unassigned' (admins claim reports) or a super admin's user id.
      reportRouting: { type: String, default: 'unassigned' },
      newGroupSlowMode: { type: Number, enum: [0, 10, 30, 60, 300, 3600], default: 0 },
      defaultMuteDuration: { type: String, enum: ['1h', '1d', '1w', '30d'], default: '1h' },
      prioritizeHarm: { type: Boolean, default: true },
      notifyAuthors: { type: Boolean, default: true },
    },
    accessReview: {
      lastAt: { type: Date, default: null },
      lastBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      nextAt: { type: Date, default: null },
    },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

/** The settings document (created with the defaults the first time). */
communitySettingsSchema.statics.current = async function current() {
  return this.findOneAndUpdate({ _id: 'community' }, { $setOnInsert: { _id: 'community' } }, { upsert: true, new: true, setDefaultsOnInsert: true });
};

module.exports = mongoose.model('CommunitySettings', communitySettingsSchema);
