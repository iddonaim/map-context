// Shared validation for site coordinates arriving from an embedding app —
// either as launcher query params (?lat&lon&address&r) or as /run and
// /analyze body fields. Mirrors the /atlas endpoint's rules: Israel bounds,
// radius clamped 100–3000 m.

const LAT_MIN = 29;
const LAT_MAX = 34;
const LON_MIN = 33.5;
const LON_MAX = 36;
const RADIUS_MIN = 100;
const RADIUS_MAX = 3000;
const RADIUS_DEFAULT = 400;
const ADDRESS_MAX_LEN = 200;

/** Clamps a radius (number or string) to [100, 3000]; invalid → 400. */
function clampRadius(value) {
  const r = parseInt(value, 10);
  if (!Number.isFinite(r)) return RADIUS_DEFAULT;
  return Math.min(Math.max(r, RADIUS_MIN), RADIUS_MAX);
}

/** True when the point is inside the supported Israel bounding box. */
function inIsraelBounds(lat, lon) {
  return lat >= LAT_MIN && lat <= LAT_MAX && lon >= LON_MIN && lon <= LON_MAX;
}

/**
 * Parses {lat, lon, address, r} from a query/body object.
 * Returns {lat, lon, radius, address} or null when lat/lon are missing,
 * non-numeric, or out of bounds. Address falls back to a coordinate label so
 * downstream code (dashboard header, cache slug) always has something to show.
 */
function parseSiteParams(query) {
  const q = query || {};
  const lat = parseFloat(q.lat);
  const lon = parseFloat(q.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (!inIsraelBounds(lat, lon)) return null;

  const radius = clampRadius(q.r);
  const address =
    String(q.address || "").slice(0, ADDRESS_MAX_LEN).trim() ||
    `${lat.toFixed(6)}, ${lon.toFixed(6)}`;

  return { lat, lon, radius, address };
}

module.exports = { parseSiteParams, clampRadius, inIsraelBounds, RADIUS_DEFAULT };
