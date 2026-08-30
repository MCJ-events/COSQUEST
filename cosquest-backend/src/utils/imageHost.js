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

/**
 * Uploads post/reel media to Cloudinary and returns only data that is safe to
 * store in MongoDB and send to the client. Local multer files are deleted as
 * soon as each upload has finished.
 */
async function storePostMedia(files, type) {
  const resourceType = type === 'reel' ? 'video' : 'image';
  if (process.env.NODE_ENV !== 'test' && (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET)) {
    throw new Error('Cloudinary is not fully configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.');
  }

  const uploaded = [];
  try {
    for (const file of files) {
      let result;
      try {
        if (process.env.NODE_ENV === 'test') {
          result = {
            secure_url: `https://res.cloudinary.com/test-cloud/${resourceType}/upload/cosquest/posts/${file.filename}`,
            public_id: `cosquest/posts/${file.filename}`,
            resource_type: resourceType,
            width: null,
            height: null,
            duration: resourceType === 'video' ? 10 : null,
          };
        } else {
          result = await getCloudinary().uploader.upload(file.path, {
            folder: resourceType === 'video'
              ? (process.env.CLOUDINARY_REEL_FOLDER || 'cosquest/reels')
              : (process.env.CLOUDINARY_POST_IMAGE_FOLDER || 'cosquest/posts'),
            resource_type: resourceType,
          });
        }
      } finally {
        fs.unlink(file.path, () => {});
      }

      uploaded.push({
        url: result.secure_url,
        publicId: result.public_id,
        resourceType,
        width: result.width || null,
        height: result.height || null,
        durationSeconds: result.duration || null,
      });
    }
    return uploaded;
  } catch (error) {
    // If one file fails before the rest are processed, remove every remaining
    // temporary upload as well.
    for (const file of files) fs.unlink(file.path, () => {});
    await deletePostMedia(uploaded);
    throw error;
  }
}

async function deletePostMedia(media) {
  if (process.env.NODE_ENV === 'test' || !media?.length) return;
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) return;
  await Promise.allSettled(media.map((item) => getCloudinary().uploader.destroy(item.publicId, { resource_type: item.resourceType })));
}

module.exports = { storeAvatarPhoto, storePostMedia, deletePostMedia };
