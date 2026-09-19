const mongoose = require('mongoose');

const postCommentSchema = new mongoose.Schema(
  {
    post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true, index: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    body: { type: String, required: true, trim: true, maxlength: 500 },
    // One level deep only (a reply under a top-level comment) - matches how
    // every mainstream app actually does this; a reply can't itself be
    // replied to (enforced in the controller).
    parentComment: { type: mongoose.Schema.Types.ObjectId, ref: 'PostComment', default: null, index: true },
    replyCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

postCommentSchema.index({ post: 1, parentComment: 1, createdAt: -1 });

module.exports = mongoose.model('PostComment', postCommentSchema);
