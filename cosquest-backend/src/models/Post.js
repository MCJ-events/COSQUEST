const mongoose = require('mongoose');

const mediaSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true },
    resourceType: { type: String, enum: ['image', 'video'], required: true },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    durationSeconds: { type: Number, default: null },
  },
  { _id: false }
);

const postSchema = new mongoose.Schema(
  {
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['image', 'reel', 'thought'], required: true, index: true },
    content: { type: String, default: '', trim: true, maxlength: 2200 },
    media: { type: [mediaSchema], default: [] },
    likeCount: { type: Number, default: 0, min: 0 },
    commentCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

postSchema.index({ author: 1, createdAt: -1 });
postSchema.index({ type: 1, createdAt: -1 });

module.exports = mongoose.model('Post', postSchema);
