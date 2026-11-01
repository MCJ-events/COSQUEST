// Address -> coordinates for the admin Quests & Events form, with
// OpenStreetMap's Nominatim (free, no key). Its usage policy: identify the
// app (User-Agent), at most 1 request a second, results attributed to
// OpenStreetMap. Only super admins use it (typing a venue), so traffic is tiny.
//
// GEOCODER_URL overrides the service (e.g. a self-hosted Nominatim).
const BASE = () => process.env.GEOCODER_URL || 'https://nominatim.openstreetmap.org';
let last = 0;
// Searches wait their turn, so two at once still go out a second apart.
let queue = Promise.resolve();
const unavailable = () => Object.assign(new Error('The address search is unavailable right now. Enter the coordinates by hand.'), { status: 503 });

function nextSlot() {
  const slot = queue.then(async () => {
    const wait = 1000 - (Date.now() - last);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    last = Date.now();
  });
  queue = slot;
  return slot;
}

async function searchPlaces(q, { limit = 5 } = {}) {
  const query = String(q || '').trim();
  if (query.length < 3) return [];
  if (process.env.NODE_ENV === 'test' && !process.env.GEOCODER_URL) {
    return [{ label: `${query}, Test City, Test Country`, name: query, address: `${query}, Test City`, city: 'Test City', country: 'Test Country', lat: 32.7157, lng: -117.1611 }];
  }
  // One request a second (Nominatim's policy).
  await nextSlot();
  const url = `${BASE()}/search?format=jsonv2&addressdetails=1&limit=${limit}&q=${encodeURIComponent(query)}`;
  let rows;
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': process.env.GEOCODER_USER_AGENT || 'CosQuest-admin/1.0 (admin dashboard venue search)', Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw unavailable();
    rows = await response.json();
  } catch {
    // Down, timed out or not JSON: the same answer, so the form falls back to coordinates.
    throw unavailable();
  }
  if (!Array.isArray(rows)) throw unavailable();
  return rows.map((row) => {
    const a = row.address || {};
    return {
      label: row.display_name,
      name: row.name || a.amenity || a.building || a.road || String(row.display_name).split(',')[0],
      address: row.display_name,
      city: a.city || a.town || a.village || a.municipality || a.county || '',
      country: a.country || '',
      lat: Number(row.lat),
      lng: Number(row.lon),
    };
  });
}

module.exports = { searchPlaces };
