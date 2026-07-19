// Disk cache for completed analysis results ({html, data}), keyed by rounded
// coordinates + radius. A full run re-fetches every live layer and can take
// 5+ minutes, so reopening a site would otherwise cost a full re-run every
// time. Railway's disk is ephemeral across deploys — acceptable: the first
// reopen after a deploy just runs fresh once.
//
// Only successful runs are written; any read problem (missing, corrupt,
// expired) simply reports a miss and the caller runs fresh.

const fs = require("fs");
const path = require("path");

const RESULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // ~7 days

/**
 * Cache identity of a site: coordinates rounded to 4 decimals (~11 m) plus
 * radius in meters. Nearby re-requests of the same pin hit the same entry.
 */
function resultCacheKey(lat, lon, radius) {
  return `${lat.toFixed(4)},${lon.toFixed(4)},${radius}`;
}

function entryPath(dir, key) {
  // Keys are numeric + [.,-] only, but sanitize anyway.
  return path.join(dir, key.replace(/[^0-9a-z.,-]/gi, "_") + ".json");
}

/** Returns the cached {html, data} for key, or null on miss/expiry/corruption. */
function readCachedResult(dir, key, now = Date.now()) {
  try {
    const raw = JSON.parse(fs.readFileSync(entryPath(dir, key), "utf8"));
    if (!raw || typeof raw.savedAt !== "number") return null;
    if (now - raw.savedAt > RESULT_TTL_MS) return null;
    if (typeof raw.html !== "string" || !raw.html || typeof raw.data !== "object" || raw.data === null) return null;
    return { html: raw.html, data: raw.data };
  } catch (_) {
    return null;
  }
}

/** Persists a successful {html, data}. Failures are swallowed — caching must never break a run. */
function writeCachedResult(dir, key, result, now = Date.now()) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = entryPath(dir, key) + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ savedAt: now, html: result.html, data: result.data }));
    fs.renameSync(tmp, entryPath(dir, key));
  } catch (_) {
    // Cache write failure is not a run failure.
  }
}

module.exports = { resultCacheKey, readCachedResult, writeCachedResult, RESULT_TTL_MS };
