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
    // 'share' = this post shares another post into the feed (like Facebook's
    // "Share now"); content is the sharer's optional caption.
    type: { type: String, enum: ['image', 'reel', 'thought', 'share'], required: true, index: true },
    content: { type: String, default: '', trim: true, maxlength: 2200 },
    media: { type: [mediaSchema], default: [] },
    // The original post a 'share' post points to (always the ORIGINAL, never
    // another share). Null for every other type.
    sharedPost: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', default: null, index: true },
    likeCount: { type: Number, default: 0, min: 0 },
    commentCount: { type: Number, default: 0, min: 0 },
    shareCount: { type: Number, default: 0, min: 0 },
    bookmarkCount: { type: Number, default: 0, min: 0 },
    // Set whenever the owner edits `content`; distinct from `updatedAt` so
    // an edit can be shown to viewers ("edited") without conflating it with
    // any other future field that might touch this document.
    editedAt: { type: Date, default: null },
    // Removed by a super admin (admin dashboard): hidden from everyone, but
    // kept as evidence (the author's own delete still erases it).
    removedAt: { type: Date, default: null },
    removedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    removedReason: { type: String, default: null, maxlength: 1000 },
  },
  { timestamps: true }
);

postSchema.index({ author: 1, createdAt: -1 });
postSchema.index({ type: 1, createdAt: -1 });
// The admin Feeds page: removed posts, newest first.
postSchema.index({ removedAt: 1, createdAt: -1 });

// Removed posts are hidden from EVERY query (feeds, profiles, a post by id,
// counts, likes and comments updating it) without changing those queries.
// Only the admin dashboard sees them: .setOptions({ includeRemoved: true }).
// Aggregations aren't covered: add { removedAt: null } to any $match on posts.
function hideRemoved() {
  if (this.getOptions().includeRemoved) return;
  if (this.getQuery().removedAt === undefined) this.where({ removedAt: null });
}
postSchema.pre(['find', 'findOne', 'countDocuments', 'findOneAndUpdate', 'updateOne', 'updateMany'], hideRemoved);

module.exports = mongoose.model('Post', postSchema);
