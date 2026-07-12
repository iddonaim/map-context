// ============================================================
// TEL AVIV ATLAS — Explorable 3D city generator
// ============================================================
// Fetches real building / street / coastline data from
// OpenStreetMap for central Tel Aviv, converts it to local
// meters, and bakes a self-contained interactive 3D page
// (Three.js) into ./output/tel-aviv-atlas.html.
//
// Run directly:   node atlas.js            (fetches live OSM data)
//                 node atlas.js --mock     (procedural test city, no network)
// Or via server:  GET /atlas on the launcher (generates on first request)
//
// Edit only the CONFIG block below between runs.

const CONFIG = {
  name: "Tel Aviv Atlas",
  name_he: "אטלס תל אביב",
  // Center of the explorable area — between Rothschild Blvd and Dizengoff,
  // so the radius covers the coast, Neve Tzedek, Sarona and the Azrieli towers.
  center: { lat: 32.068, lon: 34.778 },
  radius_meters: 2200,
  coast_extra_meters: 1500, // fetch coastline further out so the sea doesn't stop abruptly
  output_dir: "./output",
  output_filename: "tel-aviv-atlas.html",
  cache_dir: "./cache",
  cache_max_age_hours: 24 * 7, // reuse downloaded OSM data for a week
};

// ============================================================

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { renderAtlasHTML } = require("./atlas-template");

// ---- Logging -----------------------------------------------

function log(step, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  const icons = { info: "→", ok: "✓", warn: "⚠", err: "✗" };
  console.log(`[${ts}] ${icons[step] ?? "·"} ${msg}`);
}

// ---- Curated landmarks -------------------------------------
// lat/lon are approximate; each landmark is snapped to the nearest
// OSM building footprint (within snap_m meters) at build time, so
// small coordinate errors self-correct. fallback_h is only used
// when OSM has no height data for the snapped building.

const LANDMARKS = [
  { id: "azrieli-circular", name: "Azrieli Center — Circular Tower", he: "מרכז עזריאלי — המגדל העגול", lat: 32.0743, lon: 34.7925, fallback_h: 187, kind: "tower", blurb: "Israel's iconic office trio; the round tower tops out at 187 m with an observation deck." },
  { id: "azrieli-triangular", name: "Azrieli Center — Triangular Tower", he: "מרכז עזריאלי — המגדל המשולש", lat: 32.074, lon: 34.7913, fallback_h: 169, kind: "tower", blurb: "The triangular sibling of the Azrieli trio, 169 m of offices above the mall." },
  { id: "azrieli-square", name: "Azrieli Center — Square Tower", he: "מרכז עזריאלי — המגדל המרובע", lat: 32.0734, lon: 34.7904, fallback_h: 154, kind: "tower", blurb: "The square tower completes the geometric trio begun in 1999." },
  { id: "sarona-tower", name: "Azrieli Sarona Tower", he: "מגדל עזריאלי שרונה", lat: 32.0715, lon: 34.7891, fallback_h: 238, kind: "tower", blurb: "Tel Aviv's tallest occupied tower (238 m), twisting above the Sarona compound." },
  { id: "toha", name: "ToHA Tower", he: "מגדל תוהא", lat: 32.0721, lon: 34.7962, fallback_h: 116, kind: "tech", blurb: "Ron Arad's sculptural office tower on Totzeret HaAretz; home to monday.com." },
  { id: "electra-tower", name: "Electra Tower", he: "מגדל אלקטרה", lat: 32.0663, lon: 34.7871, fallback_h: 168, kind: "tech", blurb: "High-rise near the Ayalon corridor, best known as Google Israel's Tel Aviv campus." },
  { id: "shalom-meir", name: "Shalom Meir Tower", he: "מגדל שלום מאיר", lat: 32.0632, lon: 34.7697, fallback_h: 142, kind: "tower", blurb: "Israel's first skyscraper (1965), built where the Herzliya Hebrew Gymnasium stood." },
  { id: "habima", name: "Habima Theatre", he: "תיאטרון הבימה", lat: 32.0729, lon: 34.779, fallback_h: 18, kind: "culture", blurb: "The national theatre, anchoring the renovated Habima Square." },
  { id: "heichal", name: "Charles Bronfman Auditorium", he: "היכל התרבות", lat: 32.0734, lon: 34.7797, fallback_h: 16, kind: "culture", blurb: "Heichal HaTarbut — home of the Israel Philharmonic since 1957." },
  { id: "tlv-museum", name: "Tel Aviv Museum of Art", he: "מוזיאון תל אביב לאמנות", lat: 32.077, lon: 34.7867, fallback_h: 16, kind: "culture", blurb: "The city's flagship art museum; the Herta and Paul Amir wing folds like origami." },
  { id: "dizengoff-square", name: "Dizengoff Square", he: "כיכר דיזנגוף", lat: 32.0781, lon: 34.7737, fallback_h: 0, kind: "place", snap: false, blurb: "The restored 1938 circle at the heart of the White City, with the Agam fountain." },
  { id: "dizengoff-center", name: "Dizengoff Center", he: "דיזנגוף סנטר", lat: 32.075, lon: 34.7749, fallback_h: 25, kind: "place", blurb: "Israel's first shopping mall (1977), a brutalist maze straddling Dizengoff St." },
  { id: "rabin-square", name: "Rabin Square & City Hall", he: "כיכר רבין ועיריית תל אביב", lat: 32.0808, lon: 34.7813, fallback_h: 45, kind: "civic", blurb: "The city's main civic plaza, renamed after Yitzhak Rabin's assassination here in 1995." },
  { id: "sarona-market", name: "Sarona Market", he: "שרונה מרקט", lat: 32.0717, lon: 34.7862, fallback_h: 10, kind: "market", blurb: "Indoor culinary market set among the restored Templer houses of Sarona." },
  { id: "carmel-market", name: "Carmel Market", he: "שוק הכרמל", lat: 32.068, lon: 34.7688, fallback_h: 8, kind: "market", snap: false, blurb: "Shuk HaCarmel — the city's loudest, densest market street since 1920." },
  { id: "great-synagogue", name: "Great Synagogue", he: "בית הכנסת הגדול", lat: 32.0655, lon: 34.7716, fallback_h: 22, kind: "culture", blurb: "The 1926 domed synagogue on Allenby Street." },
  { id: "independence-hall", name: "Independence Hall", he: "בית העצמאות", lat: 32.0629, lon: 34.7703, fallback_h: 10, kind: "civic", blurb: "Rothschild 16, where Israel's independence was declared on 14 May 1948." },
  { id: "suzanne-dellal", name: "Suzanne Dellal Centre", he: "מרכז סוזן דלל", lat: 32.0603, lon: 34.7645, fallback_h: 10, kind: "culture", blurb: "Dance and theatre center in the heart of Neve Tzedek, Tel Aviv's first neighborhood." },
  { id: "hatachana", name: "HaTachana Compound", he: "מתחם התחנה", lat: 32.0575, lon: 34.7637, fallback_h: 8, kind: "place", blurb: "The restored 1892 Jaffa–Jerusalem railway station, now shops and cafés." },
  { id: "hassan-bek", name: "Hassan Bek Mosque", he: "מסגד חסן בק", lat: 32.0633, lon: 34.7596, fallback_h: 20, kind: "culture", blurb: "The 1916 seaside mosque, a Jaffa landmark on the edge of Charles Clore Park." },
  { id: "beit-hair", name: "Beit Ha'ir & Bialik Square", he: "בית העיר וכיכר ביאליק", lat: 32.0731, lon: 34.7702, fallback_h: 12, kind: "civic", blurb: "The old town hall on Bialik Square, ringed by Bauhaus gems." },
  { id: "meir-park", name: "Meir Park", he: "גן מאיר", lat: 32.0722, lon: 34.7728, fallback_h: 0, kind: "park", snap: false, blurb: "Shaded 1930s park off King George Street." },
  { id: "frishman-beach", name: "Frishman Beach", he: "חוף פרישמן", lat: 32.0797, lon: 34.763, fallback_h: 0, kind: "beach", snap: false, blurb: "Classic city beach at the end of Frishman Street." },
  { id: "charles-clore", name: "Charles Clore Park", he: "פארק צ'ארלס קלור", lat: 32.0595, lon: 34.7565, fallback_h: 0, kind: "park", snap: false, blurb: "Seafront lawn between the Dolphinarium site and Jaffa." },
  { id: "rothschild", name: "Rothschild Boulevard", he: "שדרות רוטשילד", lat: 32.0655, lon: 34.7745, fallback_h: 0, kind: "place", snap: false, blurb: "The city's founding boulevard — Bauhaus, ficus trees and kiosks." },
];

// Neighborhood labels (floating text, no geometry)
const NEIGHBORHOODS = [
  { name: "Lev Ha'ir", he: "לב העיר", lat: 32.07, lon: 34.773 },
  { name: "White City", he: "העיר הלבנה", lat: 32.0757, lon: 34.7718 },
  { name: "Neve Tzedek", he: "נווה צדק", lat: 32.0608, lon: 34.765 },
  { name: "Kerem HaTeimanim", he: "כרם התימנים", lat: 32.0662, lon: 34.7663 },
  { name: "Sarona", he: "שרונה", lat: 32.0718, lon: 34.787 },
  { name: "Montefiore", he: "מונטיפיורי", lat: 32.066, lon: 34.779 },
  { name: "Old North (south edge)", he: "הצפון הישן", lat: 32.084, lon: 34.774 },
  { name: "Florentin (north edge)", he: "פלורנטין", lat: 32.0575, lon: 34.769 },
];

// ---- Overpass ----------------------------------------------

const OVERPASS_ENDPOINTS = [
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
];

function buildAtlasQuery(lat, lon, radius, coastRadius) {
  return `
[out:json][timeout:180];
(
  way["building"](around:${radius},${lat},${lon});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|pedestrian|living_street|unclassified)$"](around:${radius},${lat},${lon});
  way["leisure"~"^(park|garden)$"](around:${radius},${lat},${lon});
  way["landuse"~"^(grass|village_green|recreation_ground)$"](around:${radius},${lat},${lon});
  way["natural"="beach"](around:${coastRadius},${lat},${lon});
  way["natural"="coastline"](around:${coastRadius},${lat},${lon});
);
out body;
>;
out skel qt;
`.trim();
}

async function fetchOverpass(query, onProgress) {
  log("info", "Fetching OSM data via Overpass API (buildings, streets, coast)...");
  if (onProgress) onProgress({ label: "מוריד נתוני OSM...", percent: 15 });
  const body = new URLSearchParams({ data: query }).toString();
  const reqHeaders = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "*/*",
    "User-Agent": "map-context/1.0 (contact@cuboidstudio.com)",
  };

  for (const endpoint of OVERPASS_ENDPOINTS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (attempt === 0) log("info", `  Trying ${endpoint.replace("https://", "")}`);
        const res = await axios.post(endpoint, body, { headers: reqHeaders, timeout: 240000 });
        log("ok", `OSM raw elements received: ${res.data.elements.length}`);
        return res.data;
      } catch (e) {
        const status = e.response?.status;
        if (status === 429 && attempt < 2) {
          const wait = (attempt + 1) * 5000;
          log("warn", `  Rate limited — waiting ${wait / 1000}s before retry...`);
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        log("warn", `  ${endpoint.split("/")[2]} failed (${status ?? e.message}), trying next...`);
        break;
      }
    }
  }
  throw new Error("All Overpass endpoints failed. Check network/quota.");
}

function cachedFetchOverpass(query, cacheFile, onProgress) {
  try {
    if (fs.existsSync(cacheFile)) {
      const ageH = (Date.now() - fs.statSync(cacheFile).mtimeMs) / 36e5;
      if (ageH < CONFIG.cache_max_age_hours) {
        log("ok", `Using cached OSM data (${ageH.toFixed(1)}h old): ${cacheFile}`);
        return Promise.resolve(JSON.parse(fs.readFileSync(cacheFile, "utf8")));
      }
    }
  } catch (e) {
    log("warn", `Cache read failed (${e.message}), refetching`);
  }
  return fetchOverpass(query, onProgress).then((data) => {
    try {
      fs.mkdirSync(CONFIG.cache_dir, { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify(data));
      log("ok", `Cached OSM data → ${cacheFile}`);
    } catch (e) {
      log("warn", `Cache write failed: ${e.message}`);
    }
    return data;
  });
}

// ---- Geo → local meters ------------------------------------
// Local tangent plane centered on CONFIG.center.
// x = east (meters), z = south (meters) → matches Three.js y-up,
// where "north" is -z on screen.

const M_PER_DEG_LAT = 110574;
function mPerDegLon(lat) {
  return 111320 * Math.cos((lat * Math.PI) / 180);
}

function toLocal(lat, lon, center) {
  return [
    (lon - center.lon) * mPerDegLon(center.lat),
    -(lat - center.lat) * M_PER_DEG_LAT,
  ];
}

function q(v) {
  return Math.round(v * 10) / 10; // quantize to 0.1 m — keeps payload small
}

// ---- Heights ------------------------------------------------

function hashId(id) {
  let x = (id * 2654435761) % 4294967296;
  x = (x ^ (x >>> 13)) * 1274126177;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

function buildingHeight(tags, id) {
  const t = tags || {};
  const h = parseFloat(String(t.height ?? "").replace(/[^\d.]/g, ""));
  if (h > 2 && h < 400) return h;
  const levels = parseFloat(t["building:levels"]);
  if (levels > 0 && levels < 100) return levels * 3.1 + 1.5;
  // Typical central Tel Aviv fabric: 2–5 floors, deterministic per building
  return 7 + hashId(id) * 10;
}

const ROAD_CLASSES = {
  motorway: { w: 18, major: 1 },
  trunk: { w: 16, major: 1 },
  primary: { w: 13, major: 1 },
  secondary: { w: 10, major: 1 },
  tertiary: { w: 8, major: 0 },
  residential: { w: 5.5, major: 0 },
  living_street: { w: 5, major: 0 },
  pedestrian: { w: 4.5, major: 0 },
  unclassified: { w: 5, major: 0 },
};

// ---- Polygon helpers ----------------------------------------

function polygonAreaCentroid(pts) {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const [x1, z1] = pts[i];
    const [x2, z2] = pts[(i + 1) % n];
    const f = x1 * z2 - x2 * z1;
    a += f;
    cx += (x1 + x2) * f;
    cz += (z1 + z2) * f;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-6) return { area: 0, cx: pts[0][0], cz: pts[0][1] };
  return { area: Math.abs(a), cx: cx / (6 * a), cz: cz / (6 * a) };
}

// ---- OSM → atlas data ---------------------------------------

function osmToAtlasData(osm, center, radius) {
  log("info", "Converting OSM elements to atlas geometry...");
  const nodeMap = {};
  for (const el of osm.elements) {
    if (el.type === "node") nodeMap[el.id] = toLocal(el.lat, el.lon, center);
  }

  const buildings = [];
  const roads = [];
  const parks = [];
  const beaches = [];
  const coastSegs = [];

  for (const el of osm.elements) {
    if (el.type !== "way") continue;
    const tags = el.tags || {};
    const coords = (el.nodes || []).map((n) => nodeMap[n]).filter(Boolean);
    if (coords.length < 2) continue;

    if (tags.building) {
      if (coords.length < 4) continue; // need a closed ring
      const ring = coords.slice(0, -1).map(([x, z]) => [q(x), q(z)]);
      const { area, cx, cz } = polygonAreaCentroid(ring);
      if (area < 12) continue; // skip sheds/noise
      const b = { p: ring, h: q(buildingHeight(tags, el.id)), cx: q(cx), cz: q(cz) };
      const nm = tags["name:en"] || tags.name;
      if (nm) b.n = nm;
      if (tags.name && tags["name:en"] && tags.name !== tags["name:en"]) b.nh = tags.name;
      buildings.push(b);
    } else if (tags.highway && ROAD_CLASSES[tags.highway]) {
      const cls = ROAD_CLASSES[tags.highway];
      const r = { p: coords.map(([x, z]) => [q(x), q(z)]), w: cls.w, m: cls.major };
      const nm = tags.name;
      if (nm) {
        r.n = nm;
        if (tags["name:en"] && tags["name:en"] !== nm) r.e = tags["name:en"];
      }
      roads.push(r);
    } else if (tags.leisure === "park" || tags.leisure === "garden" || ["grass", "village_green", "recreation_ground"].includes(tags.landuse)) {
      if (coords.length < 4) continue;
      parks.push(coords.slice(0, -1).map(([x, z]) => [q(x), q(z)]));
    } else if (tags.natural === "beach") {
      if (coords.length < 4) continue;
      beaches.push(coords.slice(0, -1).map(([x, z]) => [q(x), q(z)]));
    } else if (tags.natural === "coastline") {
      coastSegs.push(coords.map(([x, z]) => [q(x), q(z)]));
    }
  }

  log("ok", `Parsed: ${buildings.length} buildings, ${roads.length} road segments, ${parks.length} green areas, ${beaches.length} beach polys, ${coastSegs.length} coastline segments`);
  return { buildings, roads, parks, beaches, coastSegs };
}

// ---- Coastline → sea polygon --------------------------------
// Chains coastline segments end-to-end, takes the longest chain,
// and closes it with two far-west corners: everything west of the
// coastline is the Mediterranean.

function buildSeaPolygon(coastSegs, extent) {
  if (!coastSegs.length) return null;
  const segs = coastSegs.map((s) => s.slice());
  const chains = [];
  while (segs.length) {
    let chain = segs.pop();
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (d(chain[chain.length - 1], s[0]) < 2) { chain = chain.concat(s.slice(1)); segs.splice(i, 1); grew = true; break; }
        if (d(chain[chain.length - 1], s[s.length - 1]) < 2) { chain = chain.concat(s.slice(0, -1).reverse()); segs.splice(i, 1); grew = true; break; }
        if (d(chain[0], s[s.length - 1]) < 2) { chain = s.slice(0, -1).concat(chain); segs.splice(i, 1); grew = true; break; }
        if (d(chain[0], s[0]) < 2) { chain = s.slice(1).reverse().concat(chain); segs.splice(i, 1); grew = true; break; }
      }
    }
    chains.push(chain);
  }
  chains.sort((a, b) => b.length - a.length);
  let coast = chains[0];
  if (coast.length < 2) return null;

  // Ensure north → south order (small z → large z) so the west
  // closure corners wind correctly.
  if (coast[0][1] > coast[coast.length - 1][1]) coast = coast.slice().reverse();

  // Close the loop far to the west, extending the coastline straight
  // beyond the data so the sea never visibly "ends" on screen:
  // [NW corner] → coast (N→S, extended both ways) → [SW corner]
  // reach past the fog horizon so the sea never visibly ends
  const west = -extent * 8;
  const ext = extent * 8;
  const first = coast[0];
  const last = coast[coast.length - 1];
  const poly = [
    [west, first[1] - ext],
    [first[0], first[1] - ext],
    ...coast,
    [last[0], last[1] + ext],
    [west, last[1] + ext],
  ];
  return poly.map(([x, z]) => [q(x), q(z)]);
}

// ---- Landmark snapping --------------------------------------

function attachLandmarks(data, center, keepRadius) {
  const lms = [];
  for (const lm of LANDMARKS) {
    const [x, z] = toLocal(lm.lat, lm.lon, center);
    if (Math.hypot(x, z) > keepRadius * 1.05) continue; // outside this atlas
    const out = {
      id: lm.id, name: lm.name, he: lm.he, kind: lm.kind,
      blurb: lm.blurb, x: q(x), z: q(z), h: lm.fallback_h,
    };
    if (lm.snap !== false) {
      let best = -1, bestD = 130; // snap radius in meters
      for (let i = 0; i < data.buildings.length; i++) {
        const b = data.buildings[i];
        const d = Math.hypot(b.cx - x, b.cz - z);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best >= 0) {
        const b = data.buildings[best];
        out.x = b.cx; out.z = b.cz;
        // Trust OSM height when it's meaningfully tagged; otherwise fallback
        out.h = b.h > 12 || lm.fallback_h <= 12 ? Math.max(b.h, 4) : lm.fallback_h;
        b.lm = lm.id;
        b.h = Math.max(b.h, out.h > 30 ? out.h : b.h);
      }
    }
    lms.push(out);
  }
  data.landmarks = lms;
  data.hoods = NEIGHBORHOODS.map((n) => {
    const [x, z] = toLocal(n.lat, n.lon, center);
    return { name: n.name, he: n.he, x: q(x), z: q(z) };
  }).filter((n) => Math.hypot(n.x, n.z) <= keepRadius * 1.05);
}

// Marks the analyzed address at the scene origin (site-focused atlases).
function attachSiteMarker(data, label) {
  const marker = {
    id: "site", name: label || "Site", he: "האתר הנבחר", kind: "site",
    blurb: "The address this analysis is centered on.", x: 0, z: 0, h: 0,
  };
  let best = -1, bestD = 60;
  for (let i = 0; i < data.buildings.length; i++) {
    const b = data.buildings[i];
    const d = Math.hypot(b.cx, b.cz);
    if (d < bestD) { bestD = d; best = i; }
  }
  if (best >= 0) {
    const b = data.buildings[best];
    marker.x = b.cx; marker.z = b.cz; marker.h = b.h;
    b.lm = "site";
  }
  data.landmarks.unshift(marker);
}

// Shorten a full Nominatim display name to something label-sized.
function shortLabel(label) {
  if (!label) return null;
  const parts = String(label).split(",").map((s) => s.trim()).filter(Boolean);
  return parts.slice(0, 2).join(", ").slice(0, 80) || null;
}

// ---- Mock city (offline testing) ----------------------------
// Procedural stand-in with the same data shape as the real thing:
// grid streets, block buildings, sine coastline + beach on the
// west, parks, and the real landmark names on placed towers.

function mockData(radius) {
  log("info", "Generating procedural mock city (no network)...");
  const R = Math.min(radius, 1200);
  const buildings = [], roads = [], parks = [], beaches = [];
  const coastX = (z) => -R * 0.78 + 45 * Math.sin(z / 260);

  const step = 92;
  const landEdge = -R * 0.78 + 45 + 25; // keep mock roads out of the sea
  for (let gx = -R; gx <= R; gx += step) {
    if (gx < landEdge) continue;
    roads.push({ p: [[gx, -R], [gx, R]], w: gx % (step * 4) === 0 ? 13 : 5.5, m: gx % (step * 4) === 0 ? 1 : 0 });
  }
  for (let gz = -R; gz <= R; gz += step) {
    roads.push({ p: [[coastX(gz) + 70, gz], [R, gz]], w: gz % (step * 4) === 0 ? 13 : 5.5, m: gz % (step * 4) === 0 ? 1 : 0, n: gz === 0 ? "שדרות רוטשילד" : undefined, e: gz === 0 ? "Rothschild Blvd" : undefined });
  }

  let id = 1;
  for (let gx = -R; gx < R; gx += step) {
    for (let gz = -R; gz < R; gz += step) {
      if (gx + step * 0.5 < coastX(gz) + 70) continue; // leave the beach clear
      const r1 = hashId(id++), r2 = hashId(id++);
      if (r1 > 0.93) { // occasional park block
        parks.push([[gx + 10, gz + 10], [gx + step - 10, gz + 10], [gx + step - 10, gz + step - 10], [gx + 10, gz + step - 10]]);
        continue;
      }
      const nB = 1 + Math.floor(r2 * 3);
      for (let i = 0; i < nB; i++) {
        const bw = 22 + hashId(id++) * 30, bd = 22 + hashId(id++) * 30;
        const ox = gx + 8 + hashId(id++) * (step - bw - 16);
        const oz = gz + 8 + hashId(id++) * (step - bd - 16);
        const tall = hashId(id++) > 0.96;
        const h = tall ? 40 + hashId(id++) * 80 : 8 + hashId(id++) * 12;
        const ring = [[ox, oz], [ox + bw, oz], [ox + bw, oz + bd], [ox, oz + bd]].map(([x, z]) => [q(x), q(z)]);
        const { cx, cz } = polygonAreaCentroid(ring);
        buildings.push({ p: ring, h: q(h), cx: q(cx), cz: q(cz) });
      }
    }
  }

  // Beach strip between coastline and first block column
  const beach = [];
  for (let z = -R; z <= R; z += 40) beach.push([coastX(z), z]);
  for (let z = R; z >= -R; z -= 40) beach.push([coastX(z) + 65, z]);
  beaches.push(beach.map(([x, z]) => [q(x), q(z)]));

  const coastSegs = [[]];
  for (let z = -R * 1.4; z <= R * 1.4; z += 40) coastSegs[0].push([q(coastX(z)), q(z)]);

  const data = { buildings, roads, parks, beaches, coastSegs };

  // Place real landmark names on mock towers so search/labels/tour are testable
  const spots = [];
  for (let i = 0; i < LANDMARKS.length; i++) {
    const a = (i / LANDMARKS.length) * Math.PI * 2;
    const rr = R * (0.25 + 0.5 * hashId(i + 999));
    spots.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  data.landmarks = LANDMARKS.map((lm, i) => {
    let [x, z] = spots[i];
    x = Math.max(x, coastX(z) + 90);
    const grounded = ["place", "park", "beach"].includes(lm.kind);
    const h = grounded ? 0 : Math.max(lm.fallback_h * 0.35, 14);
    if (!grounded) {
      const s = 16 + hashId(i + 55) * 14;
      const ring = [[x - s, z - s], [x + s, z - s], [x + s, z + s], [x - s, z + s]].map(([a2, b2]) => [q(a2), q(b2)]);
      buildings.push({ p: ring, h: q(h), cx: q(x), cz: q(z), lm: lm.id });
    }
    return { id: lm.id, name: lm.name, he: lm.he, kind: lm.kind, blurb: lm.blurb, x: q(x), z: q(z), h: q(h) };
  });
  data.hoods = NEIGHBORHOODS.map((n, i) => {
    const a = (i / NEIGHBORHOODS.length) * Math.PI * 2 + 0.4;
    return { name: n.name, he: n.he, x: q(Math.cos(a) * R * 0.55), z: q(Math.sin(a) * R * 0.55) };
  });
  log("ok", `Mock city: ${buildings.length} buildings, ${roads.length} roads`);
  return data;
}

// ---- Main build ---------------------------------------------

async function buildAtlas(options = {}) {
  const { mock = false, onProgress = null, force = false, site = null } = options;

  // Site-focused mode: center on an analyzed address instead of the
  // city-wide default. Fetch a wider area than the analysis radius so
  // the 3D world doesn't end at the site boundary.
  const center = site ? { lat: site.lat, lon: site.lon } : CONFIG.center;
  const fetchRadius = site
    ? Math.min(Math.max(Math.round(site.radius * 2), 600), 2400)
    : CONFIG.radius_meters;
  const label = site ? shortLabel(site.label) : null;
  const key = site
    ? `${center.lat.toFixed(4)}_${center.lon.toFixed(4)}_${fetchRadius}`
    : "default";
  const outPath = path.join(
    CONFIG.output_dir,
    key === "default" ? CONFIG.output_filename : `atlas-${key.replace(/[^\w.-]/g, "")}.html`
  );

  if (!force && !mock && fs.existsSync(outPath)) {
    log("ok", `Atlas already built: ${outPath} (use force to rebuild)`);
    return { path: outPath, html: fs.readFileSync(outPath, "utf8"), cached: true };
  }

  let data;
  if (mock) {
    data = mockData(fetchRadius);
  } else {
    const query = buildAtlasQuery(center.lat, center.lon, fetchRadius, fetchRadius + CONFIG.coast_extra_meters);
    const cacheFile = path.join(CONFIG.cache_dir, `atlas-osm-${key.replace(/[^\w.-]/g, "")}.json`);
    const osm = await cachedFetchOverpass(query, cacheFile, onProgress);
    if (onProgress) onProgress({ label: "ממיר גיאומטריה...", percent: 55 });
    data = osmToAtlasData(osm, center, fetchRadius);
    attachLandmarks(data, center, fetchRadius);
  }
  if (site) attachSiteMarker(data, label);

  data.sea = buildSeaPolygon(data.coastSegs, fetchRadius);
  delete data.coastSegs;
  data.meta = {
    name: site ? (label || "Site Atlas") : CONFIG.name,
    name_he: site ? "אטלס אתר" : CONFIG.name_he,
    center,
    radius: fetchRadius,
    siteRadius: site ? site.radius : null,
    mock,
    built_at: new Date().toISOString(),
    counts: { buildings: data.buildings.length, roads: data.roads.length, landmarks: data.landmarks.length },
  };

  if (onProgress) onProgress({ label: "בונה עמוד תלת-ממד...", percent: 80 });
  log("info", "Rendering atlas HTML...");
  const html = renderAtlasHTML(data);

  fs.mkdirSync(CONFIG.output_dir, { recursive: true });
  fs.writeFileSync(outPath, html);
  const sizeMB = (Buffer.byteLength(html) / 1048576).toFixed(1);
  log("ok", `Atlas written → ${outPath} (${sizeMB} MB, ${data.buildings.length} buildings)`);
  if (onProgress) onProgress({ label: "בוצע", percent: 100 });
  return { path: outPath, html, cached: false };
}

module.exports = { buildAtlas, CONFIG };

// ---- CLI ----------------------------------------------------

if (require.main === module) {
  const mock = process.argv.includes("--mock");
  const force = process.argv.includes("--force") || mock;
  buildAtlas({ mock, force })
    .then((r) => log("ok", `Done: ${r.path}`))
    .catch((e) => {
      log("err", e.message);
      process.exit(1);
    });
}
