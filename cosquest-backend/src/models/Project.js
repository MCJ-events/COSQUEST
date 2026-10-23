const mongoose = require('mongoose');
const { Schema } = mongoose;
const projectSchema = new Schema({
  conversation: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true, maxlength: 100 },
  description: { type: String, default: '', maxlength: 2000 },
  location: { type: String, default: '', maxlength: 200 },
  dueAt: { type: Date, default: null },
  archived: { type: Boolean, default: false },
  subjects: [{ name: { type: String, required: true, maxlength: 100 }, description: { type: String, default: '', maxlength: 1000 } }],
  // Spark IDs are opaque: the module uses spk_..., the legacy engine ObjectIds.
  sparkLinks: [{ _id: false, sparkId: String, engine: { type: String, enum: ['legacy', 'module'] }, subjectId: { type: Schema.Types.ObjectId, default: null }, fileId: { type: Schema.Types.ObjectId, default: null } }],
}, { timestamps: true, optimisticConcurrency: true });
projectSchema.index({ conversation: 1, archived: 1, updatedAt: -1 });
module.exports = mongoose.model('Project', projectSchema);
