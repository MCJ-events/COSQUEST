const mongoose = require('mongoose');

const questRegistrationSchema = new mongoose.Schema(
  {
    quest: { type: mongoose.Schema.Types.ObjectId, ref: 'Quest', required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: ['registered', 'cancelled'], default: 'registered', index: true },
    paymentStatus: { type: String, enum: ['not_required', 'pending', 'paid'], default: 'not_required' },
  },
  { timestamps: true }
);

questRegistrationSchema.index({ quest: 1, user: 1 }, { unique: true });

module.exports = mongoose.model('QuestRegistration', questRegistrationSchema);
