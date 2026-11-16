const mongoose = require('mongoose');

/**
 * Where paid quests are allowed (payment brief 6.4: "jurisdiction table:
 * allowed, blocked, or needs license, edited only by an admin role and set by
 * legal advice"). One row per region, e.g. "US-CA". Changed only through an
 * approved ApprovalRequest (two admins). Read by src/utils/eligibility.js in
 * live mode; a region with no row is blocked (fail closed).
 */
const regionRuleSchema = new mongoose.Schema(
  {
    region: { type: String, required: true, uppercase: true, trim: true, maxlength: 20 },
    name: { type: String, default: '', trim: true, maxlength: 80 },
    status: { type: String, enum: ['allowed', 'blocked', 'needs_license'], required: true },
    note: { type: String, default: '', maxlength: 500 },
    approval: { type: mongoose.Schema.Types.ObjectId, ref: 'ApprovalRequest', default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

regionRuleSchema.index({ region: 1 }, { unique: true });

module.exports = mongoose.model('RegionRule', regionRuleSchema);
