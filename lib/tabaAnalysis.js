// TABA plan analysis (P1-P2 of docs/TABA_ANALYSIS_SCOPE.md): turn a plan's
// downloaded documents into structured, mappable data.
//
// Sources, cheapest signal first:
//   1. mmg.zip (already in cache/taba-docs/<plan>/) — per the מבא"ת standard
//      it holds the plan's GIS entities as shapefiles: boundary, land-use
//      polygons (ייעודי קרקע), lots. Structured, georeferenced (ITM).
//   2. iplan Xplan ArcGIS REST — nationwide plan boundaries + land use,
//      queried by plan number, for plans without an mmg zip.
//      NOTE: layer/field names are keyword-discovered defensively; the
//      endpoint could not be reached from the dev sandbox, so this path
//      needs one live calibration run (see scope doc P0).
//   3. takanon.pdf Table 5 — quantitative rights (lib/takanonRights.js).
//
// Plan facts are address-independent, so results cache per plan number in
// cache/taba-analysis/, shared across analyzed sites. governsSitePoint is
// computed per request from the cached boundary (never cached itself).

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const proj4 = require("proj4");
const shapefile = require("shapefile");
const unzipper = require("unzipper");
const { extractRightsFromTakanon } = require("./takanonRights");

const CACHE_ROOT       = path.resolve("./cache");
const TABA_DOCS_DIR    = path.join(CACHE_ROOT, "taba-docs");
const ANALYSIS_DIR     = path.join(CACHE_ROOT, "taba-analysis");
const ANALYSIS_VERSION = 1;
const ANALYSIS_TTL_MS  = 30 * 24 * 60 * 60 * 1000;

// Israeli Transverse Mercator (the CRS of mavat shapefiles).
proj4.defs("EPSG:2039",
  "+proj=tmerc +lat_0=31.7343936111111 +lon_0=35.2045169444444 +k=1.0000067 " +
  "+x_0=219529.584 +y_0=626907.39 +ellps=GRS80 " +
  "+towgs84=-24.0024,-17.1032,-17.8444,-0.33077,-1.85269,1.66969,5.4262 +units=m +no_defs");

function log(step, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  const icons = { info: "→", ok: "✓", warn: "⚠", err: "✗" };
  console.log(`[${ts}] ${icons[step] ?? "·"} ${msg}`);
}

/** Same sanitization as the TABA document downloader in index.js. */
function planSafeName(planNumber) {
  return String(planNumber ?? "").replace(/[^a-zA-Z0-9\-\.]/g, "_");
}

// ── Designation → category/color (mavat-convention palette) ──

const DESIGNATION_CATEGORIES = [
  { re: /מגורים|residential/i,                    category: "residential",  color: "#f2c94c" },
  { re: /מסחר|commerc/i,                          category: "commercial",   color: "#eb5757" },
  { re: /תעסוקה|משרדים|employment|office/i,       category: "employment",   color: "#9b51e0" },
  { re: /תעשי|מלאכה|industr/i,                    category: "industry",     color: "#b39ddb" },
  { re: /ציבור|מוסדות|public/i,                   category: "public",       color: "#a67c52" },
  { re: /שצפ|שטחציבוריפתוח|פארק|openspace/i,      category: "open-public",  color: "#6fcf97" },
  { re: /שפפ|פרטיפתוח/i,                          category: "open-private", color: "#b8e0a8" },
  { re: /דרך|רחוב|road|street/i,                  category: "road",         color: "#9e9e9e" },
  { re: /חני|parking/i,                           category: "parking",      color: "#cfd8dc" },
  { re: /מלונ|תיירות|hotel/i,                     category: "hotel",        color: "#f2994a" },
  { re: /חקלא|agricult/i,                         category: "agriculture",  color: "#d9e7b1" },
  { re: /נחל|מים|water/i,                         category: "water",        color: "#56ccf2" },
];

function categorizeDesignation(name) {
  const n = String(name ?? "").replace(/[\s"'׳״]/g, "");
  for (const d of DESIGNATION_CATEGORIES) {
    if (d.re.test(n)) return { category: d.category, color: d.color };
  }
  return { category: "other", color: "#c8c2ba" };
}

// ── Geometry helpers ─────────────────────────────────────────

function firstPosition(coords) {
  if (!Array.isArray(coords)) return null;
  if (typeof coords[0] === "number") return coords;
  for (const c of coords) {
    const p = firstPosition(c);
    if (p) return p;
  }
  return null;
}

/** ITM coordinates are 5-6 digit meters; lon/lat never exceeds 180. */
function looksLikeITM(geometry) {
  const p = firstPosition(geometry?.coordinates);
  return !!p && Math.abs(p[0]) > 1000;
}

function mapPositions(coords, fn) {
  if (!Array.isArray(coords)) return coords;
  if (typeof coords[0] === "number") return fn(coords);
  return coords.map(c => mapPositions(c, fn));
}

function reprojectITMToWGS84(geometry) {
  return {
    ...geometry,
    coordinates: mapPositions(geometry.coordinates, ([x, y]) => {
      const [lon, lat] = proj4("EPSG:2039", "EPSG:4326", [x, y]);
      return [Number(lon.toFixed(7)), Number(lat.toFixed(7))];
    }),
  };
}

function ringArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return sum / 2;
}

/** Planar area in m² of a (Multi)Polygon in projected meters (exterior − holes). */
function projectedAreaSqm(geometry) {
  const polyArea = (rings) =>
    rings.reduce((acc, ring, i) =>
      i === 0 ? Math.abs(ringArea(ring)) : acc - Math.abs(ringArea(ring)),
    0);
  if (geometry.type === "Polygon")      return Math.max(0, polyArea(geometry.coordinates));
  if (geometry.type === "MultiPolygon") return geometry.coordinates.reduce((s, p) => s + Math.max(0, polyArea(p)), 0);
  return 0;
}

function pointInRing([px, py], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (((yi > py) !== (yj > py)) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

function geometryContainsPoint(geometry, lon, lat) {
  if (!geometry) return false;
  const pt = [lon, lat];
  if (geometry.type === "Polygon")      return pointInRing(pt, geometry.coordinates[0]);
  if (geometry.type === "MultiPolygon") return geometry.coordinates.some(p => pointInRing(pt, p[0]));
  return false;
}

// ── mmg.zip reading (P1) ─────────────────────────────────────

// Shapefile basename → role. Names follow the מבא"ת layer conventions but
// vary by era/producer; unknown layers fall back to attribute-based
// classification and are reported in layersFound for live calibration.
function classifyLayerName(basename) {
  const n = String(basename ?? "").toLowerCase();
  if (/gvul|gbul|border|boundar|blue.?line|plan.?limit/.test(n)) return "boundary";
  if (/yeud|yiud|land.?use|zoning|zone/.test(n))                 return "landuse";
  if (/migrash|lot|parcel/.test(n))                              return "lots";
  return null;
}

const DESIGNATION_ATTR_KWS = ["yeud", "land_use", "landuse", "use", "zone", "יעוד", "ייעוד"];
const CODE_ATTR_KWS        = ["code", "semel", "מזהה"];

function pickAttrByKeyword(props, keywords) {
  const keys = Object.keys(props ?? {});
  for (const kw of keywords) {
    const hit = keys.find(k => k.toLowerCase().includes(kw.toLowerCase()) && props[k] != null && props[k] !== "");
    if (hit) return props[hit];
  }
  return null;
}

async function readShpEntry(shpBuf, dbfBuf) {
  // Try UTF-8; if the DBF text comes back mangled, retry windows-1255
  // (the common legacy encoding for Israeli GIS data).
  for (const encoding of ["utf-8", "windows-1255"]) {
    const fc = await shapefile.read(new Uint8Array(shpBuf), dbfBuf ? new Uint8Array(dbfBuf) : undefined, { encoding });
    const propsText = JSON.stringify(fc.features.slice(0, 20).map(f => f.properties));
    if (!propsText.includes("�")) return fc;
    if (encoding === "windows-1255") return fc; // best effort
  }
}

/**
 * Read an mmg.zip: find shapefiles, classify them, reproject to WGS84.
 * Returns { boundary, landUse, lotsCount, layersFound, notes }.
 */
async function readMmgZip(zipPath) {
  const out = { boundary: null, landUse: [], lotsCount: 0, layersFound: [], notes: [] };

  const dir = await unzipper.Open.file(zipPath);
  const byBase = new Map();
  for (const entry of dir.files) {
    const m = /^(.*)\.(shp|dbf)$/i.exec(entry.path);
    if (!m) continue;
    const base = m[1];
    if (!byBase.has(base)) byBase.set(base, {});
    byBase.get(base)[m[2].toLowerCase()] = entry;
  }
  if (!byBase.size) {
    out.notes.push("no shapefiles in mmg.zip (geodatabase-only zip?)");
    return out;
  }

  for (const [base, parts] of byBase) {
    if (!parts.shp) continue;
    const basename = path.basename(base);
    let fc;
    try {
      const shpBuf = await parts.shp.buffer();
      const dbfBuf = parts.dbf ? await parts.dbf.buffer() : null;
      fc = await readShpEntry(shpBuf, dbfBuf);
    } catch (e) {
      out.layersFound.push({ layer: basename, role: "unreadable", features: 0, error: e.message });
      continue;
    }

    const feats = (fc.features || []).filter(f => f.geometry);
    let role = classifyLayerName(basename);
    if (!role && feats.length) {
      // Attribute fallback: a polygon layer with a designation-ish field is
      // land use; a single-polygon layer with no such field is the boundary.
      const sample = feats[0];
      const isPoly = /Polygon/.test(sample.geometry.type);
      const hasDesignation = pickAttrByKeyword(sample.properties, DESIGNATION_ATTR_KWS) != null;
      if (isPoly && hasDesignation) role = "landuse";
      else if (isPoly && feats.length === 1) role = "boundary";
    }
    out.layersFound.push({ layer: basename, role: role ?? "unclassified", features: feats.length });
    if (!role) continue;

    if (role === "lots") { out.lotsCount += feats.length; continue; }

    for (const f of feats) {
      const itm = looksLikeITM(f.geometry);
      const areaSqm = itm ? projectedAreaSqm(f.geometry) : null;
      const geometry = itm ? reprojectITMToWGS84(f.geometry) : f.geometry;

      if (role === "boundary") {
        // Multiple boundary features → keep the largest.
        if (!out.boundary || (areaSqm ?? 0) > (out.boundary._areaSqm ?? 0)) {
          out.boundary = { ...geometry, _areaSqm: areaSqm };
        }
      } else if (role === "landuse") {
        const designation = String(pickAttrByKeyword(f.properties, DESIGNATION_ATTR_KWS) ?? "").trim() || null;
        const { category, color } = categorizeDesignation(designation);
        out.landUse.push({
          designation,
          code: pickAttrByKeyword(f.properties, CODE_ATTR_KWS) ?? null,
          category,
          color,
          areaDunams: areaSqm != null ? Number((areaSqm / 1000).toFixed(2)) : null,
          geometry,
        });
      }
    }
  }

  if (out.boundary) delete out.boundary._areaSqm;
  return out;
}

// ── Xplan gap-fill (P2) ──────────────────────────────────────

const XPLAN_MAPSERVER = "https://ags.iplan.gov.il/arcgisiplan/rest/services/PlanningPublic/Xplan/MapServer";
const XPLAN_HEADERS   = { "User-Agent": "map-context/1.0 (contact@cuboidstudio.com)", Accept: "*/*" };

const XPLAN_BOUNDARY_LAYER_KWS = ["גבולות תכניות", "גבול תכנית", "plan boundar", "תכניות בתוקף", "plans"];
const XPLAN_LANDUSE_LAYER_KWS  = ["יעודי קרקע", "ייעודי קרקע", "יעוד", "land use", "landuse"];
const XPLAN_PLANNUM_FIELD_KWS  = ["pl_number", "pl_num", "plan_number", "plan_num", "number"];

let xplanCatalogPromise = null;

async function xplanCatalog() {
  if (!xplanCatalogPromise) {
    xplanCatalogPromise = axios
      .get(`${XPLAN_MAPSERVER}?f=json`, { headers: XPLAN_HEADERS, timeout: 15000 })
      .then(res => res.data?.layers ?? [])
      .catch(e => { xplanCatalogPromise = null; throw e; });
  }
  return xplanCatalogPromise;
}

function findXplanLayer(layers, keywords) {
  const kw = keywords.map(k => k.toLowerCase());
  const hits = layers.filter(l => kw.some(k => String(l.name ?? "").toLowerCase().includes(k)));
  if (!hits.length) return null;
  return hits.reduce((a, b) => (String(a.name).length <= String(b.name).length ? a : b));
}

async function xplanQueryByPlanNumber(layerId, planNumber) {
  const layerUrl = `${XPLAN_MAPSERVER}/${layerId}`;
  const meta = await axios.get(`${layerUrl}?f=json`, { headers: XPLAN_HEADERS, timeout: 15000 });
  const fields = meta.data?.fields ?? [];
  const numField = XPLAN_PLANNUM_FIELD_KWS
    .map(kw => fields.find(f => f.name.toLowerCase().includes(kw)))
    .find(Boolean);
  if (!numField) return [];

  const escaped = String(planNumber).replace(/'/g, "''");
  const res = await axios.get(`${layerUrl}/query`, {
    params: {
      f: "json",
      where: `${numField.name} = '${escaped}'`,
      outFields: "*",
      returnGeometry: "true",
      outSR: "4326",
    },
    headers: XPLAN_HEADERS,
    timeout: 25000,
  });
  if (res.data.error) throw new Error(`Xplan error: ${JSON.stringify(res.data.error)}`);
  return res.data.features ?? [];
}

function esriRingsToGeoJSON(esriFeat) {
  const rings = esriFeat.geometry?.rings ?? [];
  if (!rings.length) return null;
  return rings.length === 1
    ? { type: "Polygon", coordinates: rings }
    : { type: "MultiPolygon", coordinates: rings.map(r => [r]) };
}

/** Fetch boundary and land use for a plan from Xplan. Throws on network failure. */
async function fetchXplanForPlan(planNumber) {
  const layers = await xplanCatalog();
  const out = { boundary: null, landUse: [] };

  const boundaryLayer = findXplanLayer(layers, XPLAN_BOUNDARY_LAYER_KWS);
  if (boundaryLayer) {
    const feats = await xplanQueryByPlanNumber(boundaryLayer.id, planNumber);
    if (feats.length) out.boundary = esriRingsToGeoJSON(feats[0]);
  }

  const landUseLayer = findXplanLayer(layers, XPLAN_LANDUSE_LAYER_KWS);
  if (landUseLayer) {
    const feats = await xplanQueryByPlanNumber(landUseLayer.id, planNumber);
    for (const f of feats) {
      const geometry = esriRingsToGeoJSON(f);
      if (!geometry) continue;
      const designation = String(pickAttrByKeyword(f.attributes, DESIGNATION_ATTR_KWS) ?? "").trim() || null;
      const { category, color } = categorizeDesignation(designation);
      out.landUse.push({ designation, code: null, category, color, areaDunams: null, geometry });
    }
  }
  return out;
}

// ── Cache ────────────────────────────────────────────────────

function readAnalysisCache(cachePath) {
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    if (raw?.version !== ANALYSIS_VERSION) return null;
    if (Date.now() - (raw.savedAt ?? 0) > ANALYSIS_TTL_MS) return null;
    return raw.record ?? null;
  } catch (_) {
    return null;
  }
}

function writeAnalysisCache(cachePath, record) {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    const tmp = cachePath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ version: ANALYSIS_VERSION, savedAt: Date.now(), record }));
    fs.renameSync(tmp, cachePath);
  } catch (_) {
    // cache write failure must not fail the analysis
  }
}

// ── Orchestration ────────────────────────────────────────────

/**
 * Analyze one plan. Options:
 *   docsDir / cacheDir — override roots (tests)
 *   network — set false to skip the Xplan fallback
 * Never throws; every failure degrades into notes[] on the record.
 */
async function analyzePlan(planNumber, opts = {}) {
  const safe      = planSafeName(planNumber);
  const docsDir   = opts.docsDir  ?? TABA_DOCS_DIR;
  const cacheDir  = opts.cacheDir ?? ANALYSIS_DIR;
  const cachePath = path.join(cacheDir, `${safe}.json`);

  const cached = readAnalysisCache(cachePath);
  if (cached) return cached;

  const record = {
    planNumber: String(planNumber),
    version: ANALYSIS_VERSION,
    analyzedAt: new Date().toISOString(),
    confidence: "low",
    sources: [],
    boundary: null,
    landUse: [],
    rights: [],
    lotsCount: 0,
    layersFound: [],
    notes: [],
  };

  // 1 — mmg.zip
  const mmgPath = path.join(docsDir, safe, "mmg.zip");
  if (fs.existsSync(mmgPath)) {
    try {
      const mmg = await readMmgZip(mmgPath);
      record.boundary    = mmg.boundary;
      record.landUse     = mmg.landUse;
      record.lotsCount   = mmg.lotsCount;
      record.layersFound = mmg.layersFound;
      record.notes.push(...mmg.notes);
      if (mmg.boundary || mmg.landUse.length) record.sources.push("mmg");
      log("ok", `[TABA-AN] ${planNumber}: mmg.zip → ${mmg.landUse.length} land-use polygons, boundary=${!!mmg.boundary}`);
    } catch (e) {
      record.notes.push(`mmg.zip read failed: ${e.message}`);
      log("warn", `[TABA-AN] ${planNumber}: mmg.zip read failed: ${e.message}`);
    }
  } else {
    record.notes.push("no mmg.zip downloaded for this plan");
  }

  // 2 — Xplan gap-fill
  if (!record.boundary && !record.landUse.length && opts.network !== false) {
    try {
      const xp = await fetchXplanForPlan(planNumber);
      if (xp.boundary) record.boundary = xp.boundary;
      if (xp.landUse.length) record.landUse = xp.landUse;
      if (xp.boundary || xp.landUse.length) record.sources.push("xplan");
      log("ok", `[TABA-AN] ${planNumber}: Xplan → ${xp.landUse.length} land-use polygons, boundary=${!!xp.boundary}`);
    } catch (e) {
      record.notes.push(`xplan lookup failed: ${e.message}`);
      log("warn", `[TABA-AN] ${planNumber}: Xplan lookup failed: ${e.message}`);
    }
  }

  // 3 — takanon rights
  const takanonPath = path.join(docsDir, safe, "takanon.pdf");
  if (fs.existsSync(takanonPath)) {
    const extraction = await extractRightsFromTakanon(takanonPath);
    record.rights = extraction.rights;
    if (extraction.note) record.notes.push(`takanon: ${extraction.note}`);
    if (extraction.rights.length) {
      record.sources.push("takanon-text");
      log("ok", `[TABA-AN] ${planNumber}: takanon Table 5 → ${extraction.rights.length} rows (p.${extraction.tablePage})`);
    }
  } else {
    record.notes.push("no takanon.pdf downloaded for this plan");
  }

  const hasGeo    = record.landUse.length > 0 || record.boundary != null;
  const hasRights = record.rights.length > 0;
  record.confidence = hasGeo && hasRights ? "high" : hasGeo || hasRights ? "medium" : "low";

  writeAnalysisCache(cachePath, record);
  return record;
}

/** Attach governsSitePoint (computed, never cached) for a given site point. */
function withGovernsSitePoint(record, lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return record;
  const boundary = record.boundary;
  const governs = boundary
    ? geometryContainsPoint(boundary, lon, lat)
    : record.landUse.some(lu => geometryContainsPoint(lu.geometry, lon, lat));
  return { ...record, governsSitePoint: governs };
}

module.exports = {
  analyzePlan,
  withGovernsSitePoint,
  categorizeDesignation,
  planSafeName,
  TABA_DOCS_DIR,
  ANALYSIS_DIR,
  ANALYSIS_VERSION,
  _internal: {
    classifyLayerName,
    looksLikeITM,
    reprojectITMToWGS84,
    projectedAreaSqm,
    geometryContainsPoint,
    readMmgZip,
    pickAttrByKeyword,
    esriRingsToGeoJSON,
    findXplanLayer,
  },
};
