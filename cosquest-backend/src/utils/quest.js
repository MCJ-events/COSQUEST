const { effectiveStatus } = require('./questStatus');

function distanceMiles(fromLat, fromLng, toLat, toLng) {
  const earthRadiusMiles = 3958.8;
  const degreesToRadians = (value) => (value * Math.PI) / 180;
  const dLat = degreesToRadians(toLat - fromLat);
  const dLng = degreesToRadians(toLng - fromLng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(degreesToRadians(fromLat)) * Math.cos(degreesToRadians(toLat)) * Math.sin(dLng / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function serializeQuest(quest, { distance, isRegistered } = {}) {
  const item = quest.toObject ? quest.toObject() : quest;
  return {
    id: String(item._id),
    slug: item.slug,
    title: item.title,
    description: item.description,
    coverImageUrl: item.coverImageUrl,
    hostName: item.hostName,
    // From the clock (only draft and cancelled are stored decisions).
    status: effectiveStatus(item),
    kind: item.kind || 'quest',
    startsAt: item.startsAt,
    endsAt: item.endsAt,
    location: item.location,
    prizePool: item.prizePool,
    entryFee: item.entryFee,
    maxParticipants: item.maxParticipants,
    registrationCount: item.registrationCount,
    spacesRemaining: Math.max(0, item.maxParticipants - item.registrationCount),
    interests: item.interests,
    faction: item.faction || null,
    requireAtVenue: Boolean(item.requireAtVenue),
    venueRadiusMeters: item.venueRadiusMeters || 200,
    ...(item.status === 'cancelled' ? { cancelReason: item.cancelReason || null } : {}),
    ...(distance === undefined ? {} : { distanceMiles: Number(distance.toFixed(1)) }),
    ...(isRegistered === undefined ? {} : { isRegistered }),
  };
}

module.exports = { distanceMiles, serializeQuest };
