const fs = require('fs');

/**
 * Avatar photo storage.
 * Default: local disk (files land in UPLOAD_DIR, served statically from
 * PUBLIC_UPLOAD_PATH by server.js) - works immediately, no signup required.
 *
 * Optional upgrade: Cloudinary (see README "Third-party image hosting").
 * If CLOUDINARY_CLOUD_NAME is set in .env AND `npm install cloudinary` has
 * been run, uploads are sent there instead and the local temp file is deleted.
 */
let cloudinary = null;

if (process.env.CLOUDINARY_CLOUD_NAME) {
  try {
    // eslint-disable-next-line global-require
    cloudinary = require('cloudinary').v2;
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
    console.log('[imageHost] Cloudinary configured - avatar photos will upload to the cloud.');
  } catch (err) {
    console.warn(
      '[imageHost] CLOUDINARY_* env vars are set but the "cloudinary" package is not installed. ' +
        'Run `npm install cloudinary` to enable it. Falling back to local disk storage for now.'
    );
  }
} else {
  console.log('[imageHost] No CLOUDINARY_CLOUD_NAME set - avatar photos will be stored locally in /uploads.');
}

/**
 * @param {Express.Multer.File} file
 * @param {import('express').Request} req
 * @returns {Promise<string>} public URL for the stored image
 */
async function storeAvatarPhoto(file, req) {
  if (cloudinary) {
    const result = await cloudinary.uploader.upload(file.path, { folder: 'cosquest/avatars' });
    fs.unlink(file.path, () => {}); // clean up the local temp copy now that it's in the cloud
    return result.secure_url;
  }
  const publicPath = process.env.PUBLIC_UPLOAD_PATH || '/uploads';
  return `${req.protocol}://${req.get('host')}${publicPath}/${file.filename}`;
}

module.exports = { storeAvatarPhoto };
