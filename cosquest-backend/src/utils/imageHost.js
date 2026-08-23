const fs = require('fs');
const { getCloudinary } = require('./cloudinary');

/**
 * @param {Express.Multer.File} file
 * @returns {Promise<string>} public URL for the stored image
 */
async function storeAvatarPhoto(file) {
  if (process.env.NODE_ENV === 'test') {
    return `https://res.cloudinary.com/test-cloud/image/upload/cosquest/profile-photos/${file.filename}`;
  }
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    throw new Error('Cloudinary is not fully configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.');
  }

  try {
    const result = await getCloudinary().uploader.upload(file.path, {
      folder: process.env.CLOUDINARY_PROFILE_PHOTO_FOLDER || 'cosquest/profile-photos',
      resource_type: 'image',
    });
    return result.secure_url;
  } finally {
    fs.unlink(file.path, () => {}); // Multer's temporary file is never used as local storage.
  }
}

module.exports = { storeAvatarPhoto };
