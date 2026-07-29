/**
 * The illustrated character picker shown in onboarding step 1 ("Profile
 * picture · take a photo or pick an avatar"). Unlike the old 10-emoji list,
 * these are real image files - `file` is just the filename; metaRoutes.js
 * turns it into a full URL served from /avatars (see server.js).
 *
 * NOTE: the actual image files are not generated here - drop the 25 PNGs
 * into public/avatars/ using the filenames below and they'll be served
 * automatically. Until then, GET /api/meta/avatars still works (the list
 * itself doesn't need the files to exist), the images just won't load.
 */
const AVATARS = [
  { key: 'adventurer', label: 'Adventurer', file: 'avatar-01.png' },
  { key: 'sky-guardian', label: 'Sky Guardian', file: 'avatar-02.png' },
  { key: 'neon-racer', label: 'Neon Racer', file: 'avatar-03.png' },
  { key: 'pink-idol', label: 'Pink Idol', file: 'avatar-04.png' },
  { key: 'visor-ranger', label: 'Visor Ranger', file: 'avatar-05.png' },
  { key: 'goggle-scout', label: 'Goggle Scout', file: 'avatar-06.png' },
  { key: 'purple-critter', label: 'Purple Critter', file: 'avatar-07.png' },
  { key: 'shadow-agent', label: 'Shadow Agent', file: 'avatar-08.png' },
  { key: 'tactical-scout', label: 'Tactical Scout', file: 'avatar-09.png' },
  { key: 'pearl-princess', label: 'Pearl Princess', file: 'avatar-10.png' },
  { key: 'old-detective', label: 'Old-School Detective', file: 'avatar-11.png' },
  { key: 'bowtie-bot', label: 'Bowtie Bot', file: 'avatar-12.png' },
  { key: 'young-wanderer', label: 'Young Wanderer', file: 'avatar-13.png' },
  { key: 'green-knight', label: 'Green Knight', file: 'avatar-14.png' },
  { key: 'caped-champion', label: 'Caped Champion', file: 'avatar-15.png' },
  { key: 'beat-gamer', label: 'Beat Gamer', file: 'avatar-16.png' },
  { key: 'tech-tinkerer', label: 'Tech Tinkerer', file: 'avatar-17.png' },
  { key: 'grey-wanderer', label: 'Grey Wanderer', file: 'avatar-18.png' },
  { key: 'crowned-king', label: 'Crowned King', file: 'avatar-19.png' },
  { key: 'classic-hero', label: 'Classic Hero', file: 'avatar-20.png' },
  { key: 'armored-agent', label: 'Armored Agent', file: 'avatar-21.png' },
  { key: 'bronze-warrior', label: 'Bronze Warrior', file: 'avatar-22.png' },
  { key: 'silver-android', label: 'Silver Android', file: 'avatar-23.png' },
  { key: 'violet-hero', label: 'Violet Hero', file: 'avatar-24.png' },
  { key: 'night-ninja', label: 'Night Ninja', file: 'avatar-25.png' },
];

const AVATAR_KEYS = AVATARS.map((a) => a.key);

function isValidAvatarKey(key) {
  return AVATAR_KEYS.includes(key);
}

function getAvatar(key) {
  return AVATARS.find((a) => a.key === key) || null;
}

module.exports = { AVATARS, AVATAR_KEYS, isValidAvatarKey, getAvatar };
