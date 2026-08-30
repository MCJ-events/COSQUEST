const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const uploadDir = path.resolve(process.cwd(), process.env.UPLOAD_DIR || './uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    // Not user-id-prefixed on purpose: multer has to parse the multipart body
    // (to find the email field, for pre-login callers) before identifyUser
    // runs, so req.userId isn't set yet at this point in the route chain.
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const POST_MEDIA_TYPES = [...ALLOWED_TYPES, 'video/mp4', 'video/quicktime', 'video/webm'];

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_TYPES.includes(file.mimetype)) {
      return cb(new Error('Only JPEG, PNG, WEBP, or GIF images are allowed.'));
    }
    cb(null, true);
  },
});

// Posts use the same temporary upload folder, then move to Cloudinary. The
// controller applies the stricter per-post rules (1-8 images or 1 short reel).
const postUpload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024, files: 8 },
  fileFilter: (req, file, cb) => {
    if (!POST_MEDIA_TYPES.includes(file.mimetype)) {
      return cb(new Error('Post media must be JPEG, PNG, WEBP, GIF, MP4, MOV, or WEBM.'));
    }
    cb(null, true);
  },
});

module.exports = { upload, postUpload, uploadDir };
