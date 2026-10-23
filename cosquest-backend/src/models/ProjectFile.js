const mongoose = require('mongoose');
const { Schema } = mongoose;
const schema = new Schema({
  project: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
  subjectId: { type: Schema.Types.ObjectId, default: null },
  uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  fileName: String, mimeType: String, sizeBytes: Number, url: String,
  publicId: { type: String, select: false }, resourceType: { type: String, select: false },
}, { timestamps: true });
schema.index({ project: 1, subjectId: 1, createdAt: -1 });
module.exports = mongoose.model('ProjectFile', schema);
