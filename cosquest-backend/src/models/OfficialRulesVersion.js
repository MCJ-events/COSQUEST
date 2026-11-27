const mongoose = require('mongoose');

/**
 * The official contest rules (legal plan, section 9), one document per
 * published version: 1, 2, 3... Append-only: a change is a new version, so
 * every ticket order can say which rules its buyer accepted.
 * Published only through an approved ApprovalRequest (kind 'official_rules').
 */
const officialRulesVersionSchema = new mongoose.Schema(
  {
    version: { type: Number, required: true },
    title: { type: String, required: true, maxlength: 120 },
    body: { type: String, required: true, maxlength: 60000 }, // simple Markdown: # headings, - bullets, paragraphs
    approval: { type: mongoose.Schema.Types.ObjectId, ref: 'ApprovalRequest', required: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

officialRulesVersionSchema.index({ version: 1 }, { unique: true });
officialRulesVersionSchema.index({ approval: 1 }, { unique: true });

const refuse = function refuse(next) {
  next(new Error('Official rules are append-only: publish a new version instead.'));
};
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  officialRulesVersionSchema.pre(op, refuse);
}
officialRulesVersionSchema.pre('save', function onlyNew(next) {
  if (!this.isNew) return next(new Error('Official rules are append-only: publish a new version instead.'));
  return next();
});

module.exports = mongoose.model('OfficialRulesVersion', officialRulesVersionSchema);
