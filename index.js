// ============================================================
// CONTEXT MAPPER — Urban Site Analysis Dashboard Generator
// ============================================================
// Edit only the CONFIG block below between runs.

const CONFIG = {
  address: "Rothschild Boulevard 1, Tel Aviv, Israel",
  radius_meters: 400,
  output_filename: "site_analysis.html",
  output_dir: "./output",
  cache_dir: "./cache",
};

// ============================================================

const axios = require("axios");
const fs = require("fs");
const path = require("path");

// ---- Logging -----------------------------------------------

function log(step, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  const icons = { info: "→", ok: "✓", warn: "⚠", err: "✗" };
  console.log(`[${ts}] ${icons[step] ?? "·"} ${msg}`);
}

// ---- Geocoding ---------------------------------------------

async function geocode(address) {
  log("info", `Geocoding: "${address}"`);
  const url = "https://nominatim.openstreetmap.org/search";
  const res = await axios.get(url, {
    params: { q: address, format: "json", limit: 1 },
    headers: { "User-Agent": "map-context/1.0 (contact@cuboidstudio.com)" },
  });
  if (!res.data.length) throw new Error(`No geocoding result for: "${address}"`);
  const { lat, lon, display_name } = res.data[0];
  log("ok", `Located at ${parseFloat(lat).toFixed(6)}, ${parseFloat(lon).toFixed(6)}`);
  log("info", `Place: ${display_name}`);
  return { lat: parseFloat(lat), lon: parseFloat(lon) };
}

// ---- Overpass helpers --------------------------------------

function buildOverpassQuery(lat, lon, radius) {
  return `
[out:json][timeout:60];
(
  way["highway"](around:${radius},${lat},${lon});
);
out body;
>;
out skel qt;
`.trim();
}

const OVERPASS_ENDPOINTS = [
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
];

async function fetchOverpass(query) {
  log("info", "Fetching OSM street network via Overpass API...");
  const params = new URLSearchParams({ data: query });
  const body   = params.toString();
  const headers = { "Content-Type": "application/x-www-form-urlencoded" };

  const reqHeaders = {
    ...headers,
    Accept: "*/*",
    "User-Agent": "map-context/1.0 (contact@cuboidstudio.com)",
  };

  for (const endpoint of OVERPASS_ENDPOINTS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (attempt === 0) log("info", `  Trying ${endpoint.replace("https://", "")}`);
        const res = await axios.post(endpoint, body, { headers: reqHeaders, timeout: 90000 });
        log("ok", `OSM raw elements received: ${res.data.elements.length}`);
        return res.data;
      } catch (e) {
        const status = e.response?.status;
        if (status === 429 && attempt < 2) {
          const wait = (attempt + 1) * 5000;
          log("warn", `  Rate limited — waiting ${wait / 1000}s before retry...`);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        log("warn", `  ${endpoint.split("/")[2]} failed (${status ?? e.message}), trying next...`);
        break;
      }
    }
  }
  throw new Error("All Overpass endpoints failed. Check network/quota.");
}

// ---- OSM → GeoJSON (streets only) -------------------------

function osmStreetsToGeoJSON(osmData) {
  log("info", "Converting OSM street data to GeoJSON...");

  const nodeMap = {};
  for (const el of osmData.elements) {
    if (el.type === "node") nodeMap[el.id] = [el.lon, el.lat];
  }

  const streets = { type: "FeatureCollection", features: [] };

  for (const el of osmData.elements) {
    if (el.type !== "way") continue;
    const coords = (el.nodes || []).map((n) => nodeMap[n]).filter(Boolean);
    if (!coords.length) continue;
    const tags = el.tags || {};
    if (tags.highway) {
      streets.features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: coords },
        properties: { ...tags, osm_id: el.id, layer: "streets" },
      });
    }
  }

  log("ok", `Streets: ${streets.features.length}`);
  return streets;
}

// ---- ArcGIS REST helpers -----------------------------------

// Compute WGS84 bounding box from centre + radius (metres)
function radiusToBbox(lat, lon, radiusM) {
  const R    = 6378137;
  const dLat = (radiusM / R) * (180 / Math.PI);
  const dLon = dLat / Math.cos(lat * Math.PI / 180);
  return { xmin: lon - dLon, ymin: lat - dLat, xmax: lon + dLon, ymax: lat + dLat };
}

const ARCGIS_HEADERS = {
  "User-Agent": "map-context/1.0 (contact@cuboidstudio.com)",
  Accept: "*/*",
};

/**
 * Fetch a MapServer layer list and return the first layer matching
 * the provided name keywords and geometry type.
 */
async function discoverLayerInMapServer(mapServerUrl, nameKeywords, geomType) {
  log("info", `  Querying catalog: ${mapServerUrl.replace("https://", "")}`);
  const res = await axios.get(`${mapServerUrl}?f=json`, {
    headers: ARCGIS_HEADERS, timeout: 15000,
  });
  const layers = res.data.layers || [];
  const candidates = layers.filter(
    (l) =>
      l.geometryType === geomType &&
      nameKeywords.some((kw) => l.name.toLowerCase().includes(kw.toLowerCase()))
  );
  if (!candidates.length)
    throw new Error(`No ${geomType} layer matching [${nameKeywords}] in ${mapServerUrl}`);
  // Prefer the most specific (shortest name) match to avoid broad zone layers
  const hit = candidates.reduce((a, b) => (a.name.length <= b.name.length ? a : b));
  log("info", `  Discovered layer ${hit.id}: "${hit.name}"`);
  return { layerUrl: `${mapServerUrl}/${hit.id}`, layerName: hit.name };
}

/**
 * Fetch an ArcGIS top-level service catalog, find the first service
 * whose name matches keywords, then discover a layer inside it.
 */
async function discoverLayerInServiceCatalog(baseUrl, serviceKeywords, nameKeywords, geomType) {
  log("info", `  Querying service catalog: ${baseUrl.replace("https://", "")}`);
  const res = await axios.get(`${baseUrl}?f=json`, {
    headers: ARCGIS_HEADERS, timeout: 15000,
  });
  const services = res.data.services || [];
  const svc = services.find((s) =>
    serviceKeywords.some((kw) => s.name.toLowerCase().includes(kw.toLowerCase()))
  );
  if (!svc) throw new Error(`No service matching [${serviceKeywords}] in ${baseUrl}`);
  log("info", `  Found service: ${svc.name} (${svc.type})`);
  const mapServerUrl = `${baseUrl}/${svc.name}/${svc.type}`;
  return discoverLayerInMapServer(mapServerUrl, nameKeywords, geomType);
}

/**
 * Query an ArcGIS Feature/Map layer with a WGS84 bbox and return raw features.
 * Paginates automatically if exceededTransferLimit is set.
 */
async function arcgisQueryFeatures(layerUrl, bbox) {
  const geomStr = `${bbox.xmin},${bbox.ymin},${bbox.xmax},${bbox.ymax}`;
  const baseParams = {
    f: "json",
    geometry: geomStr,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outSR: "4326",
    outFields: "*",
    returnGeometry: "true",
    resultRecordCount: "2000",
  };

  let allFeatures = [];
  let offset = 0;

  for (;;) {
    const params = { ...baseParams, resultOffset: String(offset) };
    const res = await axios.get(`${layerUrl}/query`, {
      params,
      headers: ARCGIS_HEADERS,
      timeout: 30000,
    });
    if (res.data.error) throw new Error(`ArcGIS error: ${JSON.stringify(res.data.error)}`);
    const features = res.data.features || [];
    allFeatures = allFeatures.concat(features);
    if (!res.data.exceededTransferLimit || features.length === 0) break;
    offset += features.length;
    log("info", `  Paginating — fetched ${allFeatures.length} so far...`);
  }

  return allFeatures;
}

/** Convert an ArcGIS Polygon (rings) feature to GeoJSON. */
function esriPolygonToGeoJSON(esriFeat, extraProps) {
  const rings = esriFeat.geometry?.rings;
  if (!rings?.length) return null;
  const geometry = rings.length === 1
    ? { type: "Polygon",      coordinates: rings }
    : { type: "MultiPolygon", coordinates: rings.map((r) => [r]) };
  return {
    type: "Feature",
    geometry,
    properties: { ...esriFeat.attributes, ...extraProps, layer: "buildings" },
  };
}

/** Convert an ArcGIS Point feature to GeoJSON. */
function esriPointToGeoJSON(esriFeat, extraProps) {
  const { x, y } = esriFeat.geometry || {};
  if (x == null || y == null) return null;
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [x, y] },
    properties: { ...esriFeat.attributes, ...extraProps, layer: "trees" },
  };
}

// ---- Building height helpers --------------------------------

function getFeatureCentroid(feature) {
  const ring = feature.geometry?.type === "Polygon"
    ? feature.geometry.coordinates[0]
    : feature.geometry?.type === "MultiPolygon"
    ? feature.geometry.coordinates[0][0]
    : null;
  if (!ring?.length) return [0, 0];
  let x = 0, y = 0;
  for (const [cx, cy] of ring) { x += cx; y += cy; }
  return [x / ring.length, y / ring.length];
}

async function fetchOSMBuildingLevels(lat, lon, radius) {
  const query = `
[out:json][timeout:30];
(
  way["building"]["building:levels"](around:${radius},${lat},${lon});
);
out body;
>;
out skel qt;
`.trim();

  const data = await fetchOverpass(query);
  const nodeMap = {};
  for (const el of data.elements) {
    if (el.type === "node") nodeMap[el.id] = [el.lon, el.lat];
  }
  const features = [];
  for (const el of data.elements) {
    if (el.type !== "way") continue;
    const coords = (el.nodes || []).map(n => nodeMap[n]).filter(Boolean);
    if (coords.length < 3) continue;
    const levels = Number(el.tags?.["building:levels"]);
    if (!isNaN(levels) && levels > 0) {
      features.push({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [coords] },
        properties: { "building:levels": levels },
      });
    }
  }
  log("ok", `OSM building:levels: ${features.length} buildings with level data`);
  return features;
}

// ---- Buildings: GovMap → Tel Aviv GIS fallback -------------

const GOVMAP_BASE     = "https://ags.govmap.gov.il/arcgis/rest/services";
const TELAVIV_MAPSVR  = "https://gisn.tel-aviv.gov.il/arcgis/rest/services/IView2/MapServer";

const BUILDING_SERVICE_KW = ["building", "mivne", "parcel", "cadastr", "gush"];
const BUILDING_LAYER_KW   = ["מבנים", "building", "מבנן", "mivne"];

async function fetchGovMapBuildings(lat, lon, radius) {
  log("info", "Fetching building footprints...");

  const bbox = radiusToBbox(lat, lon, radius);
  let layerUrl, layerName;

  // 1 — Try GovMap service catalog
  try {
    ({ layerUrl, layerName } = await discoverLayerInServiceCatalog(
      GOVMAP_BASE, BUILDING_SERVICE_KW, BUILDING_LAYER_KW, "esriGeometryPolygon"
    ));
    log("ok", `  Using GovMap layer: "${layerName}"`);
  } catch (e) {
    log("warn", `  GovMap unavailable (${e.message})`);
    // 2 — Fall back to Tel Aviv GIS
    log("info", `  Falling back to Tel Aviv GIS: ${TELAVIV_MAPSVR.replace("https://", "")}`);
    ({ layerUrl, layerName } = await discoverLayerInMapServer(
      TELAVIV_MAPSVR, BUILDING_LAYER_KW, "esriGeometryPolygon"
    ));
    log("ok", `  Using Tel Aviv GIS layer: "${layerName}"`);
  }

  const raw = await arcgisQueryFeatures(layerUrl, bbox);

  // ── Height extraction ─────────────────────────────────────
  const HEIGHT_ATTR_KWS = ["HEIGHT", "HEIGHT_M", "BLDG_HEIGHT", "גובה", "GOVA"];
  const FLOOR_ATTR_KWS  = ["FLOOR_NUM", "FLOORS", "NUM_FLOORS", "STORIES", "KOMOTOT", "קומות", "MANAIM", "FLOOR_CNT"];

  const needsOSM = [];
  const features = raw.map((f) => {
    const attrs = f.attributes || {};
    let height = null;
    let src = null;

    const hv = pickAttr(attrs, ...HEIGHT_ATTR_KWS);
    if (hv != null && Number(hv) > 0) {
      height = Number(hv);
      src = "attr";
    } else {
      const fv = pickAttr(attrs, ...FLOOR_ATTR_KWS);
      if (fv != null && Number(fv) > 0) {
        height = Math.round(Number(fv)) * 3.2;
        src = "floors";
      }
    }

    const feat = esriPolygonToGeoJSON(f, { height, heightSource: src });
    if (!feat) return null;
    if (src === null) needsOSM.push(feat);
    return feat;
  }).filter(Boolean);

  // ── OSM fallback ──────────────────────────────────────────
  let osmBuildings = [];
  if (needsOSM.length > 0) {
    log("info", `  ${needsOSM.length} buildings lack height data — querying OSM building:levels...`);
    osmBuildings = await fetchOSMBuildingLevels(lat, lon, radius).catch(e => {
      log("warn", `  OSM building:levels failed (${e.message})`);
      return [];
    });
  }

  let realHeights = 0, osmHeights = 0, defaultHeights = 0;
  for (const feat of features) {
    if (feat.properties.heightSource !== null) {
      realHeights++;
    } else {
      let matched = false;
      if (osmBuildings.length > 0) {
        const [cx, cy] = getFeatureCentroid(feat);
        const match = osmBuildings.find(ob => featureContainsPoint(ob, cx, cy));
        if (match) {
          feat.properties.height = Number(match.properties["building:levels"]) * 3.2;
          feat.properties.heightSource = "osm";
          osmHeights++;
          matched = true;
        }
      }
      if (!matched) {
        feat.properties.height = 9.6;
        feat.properties.heightSource = "default";
        defaultHeights++;
      }
    }
  }

  log("ok", `Buildings fetched: ${features.length}`);
  log("info", `  Height sources — real attr: ${realHeights}, OSM levels: ${osmHeights}, default 9.6m: ${defaultHeights}`);
  return { type: "FeatureCollection", features };
}

// ---- Trees: Tel Aviv Open Data (gisn.tel-aviv.gov.il) ------

const TREE_LAYER_KW = ["עצים", "tree", "etz", "vegetation"];

async function fetchTelAvivTrees(lat, lon, radius) {
  log("info", "Fetching tree canopy data from Tel Aviv Open Data...");

  const bbox = radiusToBbox(lat, lon, radius);

  const { layerUrl, layerName } = await discoverLayerInMapServer(
    TELAVIV_MAPSVR, TREE_LAYER_KW, "esriGeometryPoint"
  );
  log("ok", `  Discovered tree layer: "${layerName}"`);

  const raw = await arcgisQueryFeatures(layerUrl, bbox);
  const features = raw
    .map((f) =>
      esriPointToGeoJSON(f, {
        species:       f.attributes?.tree_name        ?? null,
        species_latin: f.attributes?.scientific_name  ?? null,
      })
    )
    .filter(Boolean);
  log("ok", `Trees fetched: ${features.length}`);
  return { type: "FeatureCollection", features };
}

// ---- Registration blocks (גושים) ---------------------------

const REGISTRATION_KW = ["גושים", "רישום", "gush", "cadastral", "parcel"];

async function fetchRegistrationBlocks(lat, lon, radius) {
  log("info", "Fetching registration blocks (גושים) from Tel Aviv GIS...");
  const bbox = radiusToBbox(lat, lon, radius);
  try {
    const { layerUrl, layerName } = await discoverLayerInMapServer(
      TELAVIV_MAPSVR, REGISTRATION_KW, "esriGeometryPolygon"
    );
    log("ok", `  Discovered registration layer: "${layerName}"`);
    const raw = await arcgisQueryFeatures(layerUrl, bbox);
    const features = raw.map(f => esriPolygonToGeoJSON(f, { layer: "registration" })).filter(Boolean);
    log("ok", `Registration blocks fetched: ${features.length}`);
    return { type: "FeatureCollection", features };
  } catch (e) {
    log("warn", `Registration blocks unavailable: ${e.message}`);
    return { type: "FeatureCollection", features: [] };
  }
}

// ============================================================
// PHASE 3 — TABA: Statutory Urban Plans (תב"עות)
// ============================================================

// Case-insensitive attribute picker with substring fallback.
// Tries exact keys first, then case-insensitive exact match, then
// any key that *contains* one of the keywords.
function pickAttr(attrs, ...keywords) {
  // 1. Exact match
  for (const kw of keywords) {
    if (attrs[kw] != null) return attrs[kw];
  }
  // 2. Case-insensitive exact
  const keys = Object.keys(attrs);
  for (const kw of keywords) {
    const hit = keys.find(k => k.toLowerCase() === kw.toLowerCase());
    if (hit !== undefined && attrs[hit] != null) return attrs[hit];
  }
  // 3. Substring match (e.g. "ms_gush" contains "gush")
  for (const kw of keywords) {
    const hit = keys.find(k => k.toLowerCase().includes(kw.toLowerCase()) && attrs[k] != null);
    if (hit !== undefined) return attrs[hit];
  }
  return null;
}

const TABASEARCH_API        = "https://apps.land.gov.il/TabaSearch/api//SerachPlans/GetPlans";
const TABASEARCH_DOC_BASE   = "https://apps.land.gov.il";
const TABASEARCH_HEADERS    = {
  "Content-Type": "application/json",
  "Referer":      "https://apps.land.gov.il/TabaSearch/",
  "User-Agent":   "map-context/1.0 (contact@cuboidstudio.com)",
};
const TABASEARCH_PLAN_TYPES = [
  72, 21, 1, 8, 9, 10, 12, 20, 62, 31, 41, 25, 22, 2, 11, 13,
  61, 32, 74, 78, 77, 73, 76, 75, 80, 79, 40, 60, 71, 70, 67, 68, 69, 30, 50, 3,
];
const MEIRIM_API_BASE       = "https://api.meirim.org";

function normalizePlanStatus(raw) {
  if (!raw) return "planning";
  const s = raw.toString().toLowerCase();
  if (s.includes("אושר") || s.includes("approv") || s.includes("תוקף")) return "approved";
  if (s.includes("הפקד") || s.includes("deposit")) return "deposit";
  return "planning";
}

// ── Step A: Find cadastral parcel at site point ──────────────

async function fetchParcelAtPoint(lat, lon) {
  log("info", "[TABA-A] Finding cadastral parcel (גוש/חלקה) at site coordinate...");

  const pointGeom = JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } });

  try {
    const { layerUrl } = await discoverLayerInMapServer(
      TELAVIV_MAPSVR, REGISTRATION_KW, "esriGeometryPolygon"
    );

    const res = await axios.get(`${layerUrl}/query`, {
      params: {
        f: "json",
        geometry: pointGeom,
        geometryType: "esriGeometryPoint",
        inSR: "4326",
        spatialRel: "esriSpatialRelIntersects",
        outSR: "4326",
        outFields: "*",
        returnGeometry: "false",
      },
      headers: ARCGIS_HEADERS,
      timeout: 20000,
    });

    if (res.data.error) throw new Error(`ArcGIS error: ${JSON.stringify(res.data.error)}`);

    let features = res.data.features || [];

    if (!features.length) {
      log("info", "[TABA-A]   Point query returned 0 — trying 10 m bbox fallback");
      features = await arcgisQueryFeatures(layerUrl, radiusToBbox(lat, lon, 10));
    }

    if (features.length) {
      const attrs = features[0].attributes || {};
      log("info", `[TABA-A]   All parcel attributes: ${JSON.stringify(attrs)}`);

      const gush   = pickAttr(attrs, "ms_gush",   "gush",   "block",  "gushnum",  "gush_num");
      const chelka = pickAttr(attrs, "ms_chelka", "chelka", "parcel", "lot",      "chnum");

      log("ok", `[TABA-A] Cadastral: Gush=${gush}, Chelka=${chelka}`);
      return {
        gush:   gush   !== null ? String(gush)   : null,
        chelka: chelka !== null ? String(chelka) : null,
      };
    }
  } catch (e) {
    log("warn", `[TABA-A] Registration blocks query failed: ${e.message}`);
  }

  log("warn", "[TABA-A] Could not determine gush/chelka — proceeding without");
  return { gush: null, chelka: null };
}

// ── Step B: Fetch plans from TabaSearch (apps.land.gov.il) ──

async function fetchTABAFromTabaSearch(gush, chelka) {
  log("info", "[TABA-B] Querying TabaSearch (apps.land.gov.il)...");
  const res = await axios.post(
    TABASEARCH_API,
    {
      planNumber:    "",
      gush:          String(gush ?? ""),
      chelka:        String(chelka ?? ""),
      statuses:      [],
      planTypes:     TABASEARCH_PLAN_TYPES,
      planTypesUsed: false,
    },
    { headers: TABASEARCH_HEADERS, timeout: 25000 }
  );
  // totalRecords is always 0 (API bug) — actual results are in plansSmall
  const plans = res.data?.plansSmall ?? [];
  log("info", `[TABA-B] TabaSearch returned ${plans.length} plans`);
  plans.forEach(p =>
    log("info", `[TABA-B]   ${p.planNumber} | ${p.cityText} | ${p.status} | ${String(p.mahut ?? "").slice(0, 60)}`)
  );
  return plans;
}

function parseTabaSearchPlan(item) {
  const num = String(item.planNumber ?? "");
  return {
    planNumber:   num,
    planId:       item.planId ?? null,
    name:         String(item.mahut ?? ""),
    status:       normalizePlanStatus(item.status ?? ""),
    statusDate:   String(item.statusDate ?? "").trim(),
    city:         String(item.cityText ?? ""),
    areaDunams:   0,
    purposeCode:  "",
    approvalDate: String(item.statusDate ?? "").trim(),
    parcels:      [],
    polygon:      null,
    documents:    { takanon: null, tasrit: null, mmg: null },
    mavatUrl:     num ? `https://mavat.iplan.gov.il/SV1/1?entity=2&planNumber=${encodeURIComponent(num)}` : null,
    _docSet:      item.documentsSet ?? null,
  };
}

// ── Step C: Download plan documents from TabaSearch paths ───

async function tryDownloadFile(url, magic) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, attempt * 2000));
    try {
      const res = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 60000,
        headers: { Referer: "https://apps.land.gov.il/TabaSearch/", "User-Agent": "map-context/1.0 (contact@cuboidstudio.com)" },
        validateStatus: s => s < 500,
      });
      if (res.status === 404) return null;
      const buf = Buffer.from(res.data);
      if (magic && !buf.slice(0, magic.length).equals(Buffer.from(magic))) {
        log("warn", `[TABA-C]   Unexpected content type at ${url.slice(-60)}`);
        return null;
      }
      return buf;
    } catch (e) {
      if (attempt === 2) log("warn", `[TABA-C]   ${url.slice(-70)}: ${e.message}`);
    }
  }
  return null;
}

async function downloadTabaSearchDocs(plans, cacheDir, outDir) {
  const docsRoot = path.join(cacheDir, "taba", "documents");
  fs.mkdirSync(docsRoot, { recursive: true });
  let totalDownloaded = 0, totalFailed = 0;

  for (const plan of plans) {
    const docSet = plan._docSet;
    delete plan._docSet;
    if (!plan.planNumber || !docSet) continue;

    const safe    = plan.planNumber.replace(/[^a-zA-Z0-9\-\.]/g, "_");
    const planDir = path.join(docsRoot, safe);
    fs.mkdirSync(planDir, { recursive: true });

    const normPath = p => p ? p.replace(/\\/g, "/") : null;

    const slots = [
      { key: "takanon", filename: "takanon.pdf", srcPath: normPath(docSet.takanon?.path),              magic: "%PDF" },
      { key: "tasrit",  filename: "tasrit.pdf",  srcPath: normPath(docSet.tasritim?.[0]?.path ?? docSet.tasritim?.path), magic: "%PDF" },
      { key: "mmg",     filename: "mmg.zip",     srcPath: normPath(docSet.mmg?.path),                  magic: "PK"   },
    ];

    for (const slot of slots) {
      if (!slot.srcPath) continue;
      const localPath = path.join(planDir, slot.filename);
      const relPath   = path.relative(outDir, localPath).replace(/\\/g, "/");

      if (fs.existsSync(localPath)) {
        plan.documents[slot.key] = relPath;
        totalDownloaded++;
        continue;
      }

      const url = `${TABASEARCH_DOC_BASE}${slot.srcPath}`;
      const buf = await tryDownloadFile(url, slot.magic);
      if (buf) {
        fs.writeFileSync(localPath, buf);
        plan.documents[slot.key] = relPath;
        log("ok", `[TABA-C] ${plan.planNumber}/${slot.filename} (${(buf.length / 1024).toFixed(0)} KB)`);
        totalDownloaded++;
      } else {
        totalFailed++;
      }
    }
  }

  return { totalDownloaded, totalFailed };
}

// ── Step G: Fetch Meirim polygons as a separate spatial layer ─

async function fetchMeirimPolygons(lon, lat) {
  log("info", "[TABA-G] Fetching Meirim polygons (separate spatial layer)...");
  const res = await axios.get(`${MEIRIM_API_BASE}/api/plan`, {
    params: { distancePoint: `${lon},${lat}` },
    timeout: 15000,
    headers: { "User-Agent": "map-context/1.0 (contact@cuboidstudio.com)" },
  });
  const meirimPlans = res.data?.data ?? [];
  log("info", `[TABA-G] Meirim returned ${meirimPlans.length} plans`);

  const polygons = meirimPlans
    .filter(p => p.geom)
    .map(p => ({
      planNumber: p.PL_NUMBER ?? "",
      name:       p.PL_NAME  ?? p.plan_display_name ?? "",
      geom:       p.geom,
    }));
  log("info", `[TABA-G] ${polygons.length} Meirim polygons with geometry`);
  return polygons;
}

// ── Step D: Main orchestrator ────────────────────────────────

async function fetchTABAData(lat, lon, slug, cacheDir, outDir, onProgress) {
  log("info", 'Phase 3: TABA — Statutory Urban Plans (תב"עות)');

  const tabaDir       = path.join(cacheDir, "taba");
  const tabaIndexPath = path.join(tabaDir, "taba_index.json");

  if (fs.existsSync(tabaIndexPath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(tabaIndexPath, "utf8"));
      if (Array.isArray(cached.plans) && cached.plans.length > 0) {
        log("ok", `[TABA] Loaded from cache: ${cached.plans.length} plans`);
        return cached;
      }
    } catch (_) {}
  }

  const out = {
    gush: null, chelka: null,
    plans: [],
    meirimPolygons: [],
    stats: { totalPlans: 0, withDocuments: 0, failedDownloads: 0 },
  };

  // Step A — resolve cadastral parcel
  const parcel = await fetchParcelAtPoint(lat, lon);
  out.gush   = parcel.gush;
  out.chelka = parcel.chelka;

  // Step B — fetch plans from TabaSearch
  if (onProgress) onProgress({ step: "taba_lookup", label: "Loading statutory plans", percent: 58 });
  let rawPlans = [];
  if (parcel.gush) {
    try {
      rawPlans = await fetchTABAFromTabaSearch(parcel.gush, parcel.chelka);
    } catch (e) {
      log("warn", `[TABA-B] TabaSearch failed: ${e.message}`);
    }
  } else {
    log("warn", "[TABA-B] No gush available — skipping TabaSearch");
  }

  const plans = rawPlans.map(item => parseTabaSearchPlan(item)).filter(p => p.planNumber);
  log("ok", `[TABA-B] ${plans.length} plans parsed`);

  if (plans.length > 0) {
    // Step C — download documents (non-fatal)
    if (onProgress) onProgress({ step: "taba_docs", label: "Downloading plan documents", percent: 80 });
    try {
      const { totalDownloaded, totalFailed } = await downloadTabaSearchDocs(plans, cacheDir, outDir);
      out.stats.withDocuments   = plans.filter(p => p.documents.takanon || p.documents.tasrit || p.documents.mmg).length;
      out.stats.failedDownloads = totalFailed;
      log("ok", `[TABA-C] ${totalDownloaded} downloaded, ${totalFailed} skipped`);
    } catch (e) {
      log("warn", `[TABA-C] Document download failed: ${e.message}`);
    }

    // Step G — fetch Meirim polygons as a separate spatial layer (non-fatal)
    if (onProgress) onProgress({ step: "meirim", label: "Fetching plan geometries", percent: 88 });
    try {
      out.meirimPolygons = await fetchMeirimPolygons(lon, lat);
    } catch (e) {
      log("warn", `[TABA-G] Meirim polygon fetch failed: ${e.message}`);
    }
  }

  out.plans            = plans;
  out.stats.totalPlans = plans.length;

  // Save manifest — only when we actually found plans
  fs.mkdirSync(tabaDir, { recursive: true });
  if (plans.length > 0) {
    fs.writeFileSync(tabaIndexPath, JSON.stringify(out, null, 2), "utf8");
  }
  log("ok", `[TABA] Phase 3 done — ${out.stats.totalPlans} plans, ${out.stats.withDocuments} with docs`);

  return out;
}

// ---- Combined Overpass query (streets + transit + institutions) ---

function buildCombinedOverpassQuery(lat, lon, radius) {
  return `
[out:json][timeout:90];
(
  way["highway"](around:${radius},${lat},${lon});
  way["railway"~"light_rail|rail|subway"](around:${radius},${lat},${lon});
  relation["route"~"light_rail|subway|train|bus"](around:${radius},${lat},${lon});
  node["amenity"~"school|university|hospital|clinic|library|place_of_worship|police|fire_station|kindergarten|college"](around:${radius},${lat},${lon});
  way["amenity"~"school|university|hospital|clinic|library|place_of_worship|police|fire_station|kindergarten|college"](around:${radius},${lat},${lon});
);
out body;
>;
out skel qt;
`.trim();
}

function parseAllOSMData(osmData) {
  const nodeMap = {};
  for (const el of osmData.elements) {
    if (el.type === "node") nodeMap[el.id] = [el.lon, el.lat];
  }

  const streets      = { type: "FeatureCollection", features: [] };
  const lightRail    = { type: "FeatureCollection", features: [] };
  const train        = { type: "FeatureCollection", features: [] };
  const busLines     = { type: "FeatureCollection", features: [] };
  const institutions = { type: "FeatureCollection", features: [] };

  for (const el of osmData.elements) {
    const tags = el.tags || {};
    if (el.type === "node" && tags.amenity) {
      const [lon, lat] = nodeMap[el.id] || [el.lon, el.lat];
      if (lon == null) continue;
      institutions.features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lon, lat] },
        properties: { ...tags, osm_id: el.id, layer: "institutions" },
      });
    }
    if (el.type === "way") {
      const coords = (el.nodes || []).map(n => nodeMap[n]).filter(Boolean);
      if (!coords.length) continue;
      if (tags.amenity) {
        institutions.features.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: coords },
          properties: { ...tags, osm_id: el.id, layer: "institutions" },
        });
      } else if (tags.highway) {
        streets.features.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: coords },
          properties: { ...tags, osm_id: el.id, layer: "streets" },
        });
      } else if (tags.railway) {
        const feat = {
          type: "Feature",
          geometry: { type: "LineString", coordinates: coords },
          properties: { ...tags, osm_id: el.id, layer: "transit" },
        };
        if (tags.railway === "light_rail" || tags.railway === "subway") lightRail.features.push(feat);
        else train.features.push(feat);
      }
    }
  }

  log("ok", `Streets: ${streets.features.length}, Light rail: ${lightRail.features.length}, Train: ${train.features.length}, Bus relations: ${busLines.features.length}, Institutions: ${institutions.features.length}`);
  return { streets, transit: { lightRail, train, busLines }, institutions };
}

// ---- CBS Demographic Data (data.gov.il) --------------------

const DATAGOV_BASE = "https://data.gov.il/api/3/action";
const DATAGOV_HEADERS = {
  "User-Agent": "map-context/1.0 (contact@cuboidstudio.com)",
  Accept: "application/json",
};

function pointInRing([px, py], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (((yi > py) !== (yj > py)) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

function featureContainsPoint(feat, lon, lat) {
  const g = feat.geometry;
  if (!g) return false;
  const pt = [lon, lat];
  if (g.type === "Polygon")      return pointInRing(pt, g.coordinates[0]);
  if (g.type === "MultiPolygon") return g.coordinates.some(p => pointInRing(pt, p[0]));
  return false;
}

async function cbsSearch(query) {
  log("info", `  [CBS] package_search: "${query}"`);
  try {
    const res = await axios.get(`${DATAGOV_BASE}/package_search`, {
      params: { q: query, rows: 10 },
      headers: DATAGOV_HEADERS,
      timeout: 20000,
    });
    const results = res.data?.result?.results || [];
    log("info", `  [CBS] → ${res.data?.result?.count ?? 0} total, ${results.length} returned`);
    for (const p of results) log("info", `  [CBS]   • "${p.title}" (${p.id})`);
    return results;
  } catch (e) {
    log("warn", `  [CBS] Search failed: ${e.message}`);
    return [];
  }
}

async function cbsDatastore(resourceId, params) {
  try {
    const res = await axios.get(`${DATAGOV_BASE}/datastore_search`, {
      params: { resource_id: resourceId, ...params },
      headers: DATAGOV_HEADERS,
      timeout: 30000,
    });
    return res.data?.result;
  } catch (e) {
    log("warn", `  [CBS] Datastore query failed (${resourceId}): ${e.message}`);
    return null;
  }
}

async function cbsGet(endpoint, params) {
  const res = await axios.get(`${DATAGOV_BASE}/${endpoint}`, {
    params, headers: DATAGOV_HEADERS, timeout: 30000,
  });
  return res.data;
}

async function tryMetricFromPkgs(pkgs, areaCode, matchedArea, valueKeys) {
  const codeColumns = ["stat_cd", "STAT_CD", "area_code", "AREA_CODE", "statistical_area_code"];
  const cityColumns = ["city_name", "CITY_NAME", "yishuv_name", "YISHUV_NM"];

  for (const pkg of pkgs) {
    for (const r of (pkg.resources || [])) {
      if (!r.datastore_active) continue;
      log("info", `  [CBS]   Querying datastore: "${r.name}" (${r.id})`);
      const sample = await cbsDatastore(r.id, { limit: 3 });
      if (!sample?.records?.length) continue;
      const cols = Object.keys(sample.records[0]);
      log("info", `  [CBS]   Columns: ${cols.join(", ")}`);

      let record = null;

      if (areaCode) {
        for (const ck of codeColumns) {
          if (!cols.includes(ck)) continue;
          const ds = await cbsDatastore(r.id, {
            filters: JSON.stringify({ [ck]: areaCode }),
            limit: 1,
          });
          if (ds?.records?.[0]) { record = ds.records[0]; break; }
          // try numeric
          const ds2 = await cbsDatastore(r.id, {
            filters: JSON.stringify({ [ck]: Number(areaCode) }),
            limit: 1,
          });
          if (ds2?.records?.[0]) { record = ds2.records[0]; break; }
        }
      }

      if (!record && matchedArea) {
        const cityName = matchedArea.YISHUV_NM ?? matchedArea.yishuv_name ??
                         matchedArea.city_name  ?? matchedArea.CITY ?? null;
        if (cityName) {
          for (const ck of cityColumns) {
            if (!cols.includes(ck)) continue;
            const ds = await cbsDatastore(r.id, {
              filters: JSON.stringify({ [ck]: cityName }),
              limit: 1,
            });
            if (ds?.records?.[0]) { record = ds.records[0]; break; }
          }
        }
      }

      if (!record) continue;

      for (const key of valueKeys) {
        if (record[key] !== undefined && record[key] !== null && record[key] !== "") {
          return {
            value: record[key],
            source: { label: pkg.title, url: `https://data.gov.il/dataset/${pkg.id}` },
          };
        }
      }
    }
  }
  return { value: null, source: null };
}

async function fetchCBSData(lat, lon) {
  log("info", "Phase 2: CBS demographic data — data.gov.il CKAN API");

  const emptyMetrics = () => ({
    populationCount:      { value: null, source: null },
    populationDensity:    { value: null, source: null },
    vehicleOwnershipRate: { value: null, source: null },
    housingTenureOwners:  { value: null, source: null },
    housingTenureRenters: { value: null, source: null },
  });

  const out = {
    boundaryGeoJSON: null,
    matchedArea: null,
    areaCode: null,
    areaName: null,
    boundarySrc: null,
    metrics:     emptyMetrics(),
    cityMetrics: emptyMetrics(),
  };

  // ── 1. Discover & download statistical area boundary ──────
  const boundaryQueries = [
    "גבולות אזורים סטטיסטיים",
    "statistical areas boundaries",
    "אזורים סטטיסטיים",
    "statistical area CBS",
  ];

  let boundaryPkgs = [];
  for (const q of boundaryQueries) {
    const pkgs = await cbsSearch(q);
    boundaryPkgs = boundaryPkgs.concat(pkgs);
    if (pkgs.length > 0) break;
  }
  { const seen = new Set(); boundaryPkgs = boundaryPkgs.filter(p => !seen.has(p.id) && seen.add(p.id)); }

  outerBoundary:
  for (const pkg of boundaryPkgs) {
    for (const r of (pkg.resources || [])) {
      const fmt = (r.format || "").toLowerCase();
      const url = r.url || "";
      if (!(fmt === "geojson" || url.toLowerCase().includes("geojson"))) continue;
      log("info", `  [CBS] Downloading boundary: "${r.name}" from "${pkg.title}"`);
      try {
        const res = await axios.get(url, {
          headers: DATAGOV_HEADERS,
          timeout: 120000,
          maxContentLength: 200 * 1024 * 1024,
        });
        const features = res.data?.features || [];
        log("info", `  [CBS] Boundary file: ${features.length} features`);
        for (const feat of features) {
          if (!featureContainsPoint(feat, lon, lat)) continue;
          out.matchedArea    = feat.properties;
          out.boundaryGeoJSON = { type: "FeatureCollection", features: [feat] };
          out.boundarySrc    = { label: pkg.title, url: `https://data.gov.il/dataset/${pkg.id}` };
          log("ok", `  [CBS] Matched area: ${JSON.stringify(feat.properties).slice(0, 200)}`);
          break outerBoundary;
        }
      } catch (e) {
        log("warn", `  [CBS] Download failed: ${e.message}`);
      }
    }
  }

  if (out.matchedArea) {
    const p = out.matchedArea;
    out.areaCode = p.STAT_CD ?? p.stat_cd ?? p.YISHUV_STAT_CD ?? p.sml_azor_st ??
                   p.sml_azor ?? p.SEMEL ?? p.semel ?? p.stat_area ?? p.STATAREA ?? null;
    out.areaName = p.STAT_NM ?? p.stat_name ?? p.stat_nm ?? p.NAME ?? p.name ??
                   p.YISHUV_NM ?? p.yishuv_name ??
                   (out.areaCode ? `Area ${out.areaCode}` : "Unknown");
    log("ok", `  [CBS] Area: "${out.areaName}" (code: ${out.areaCode})`);
  } else {
    log("warn", "  [CBS] No statistical area matched — will use city-level aggregates");
  }

  // ── 2. Query census 2022 dataset directly ─────────────────
  const CENSUS_RESOURCE = "9a9e085f-3bc8-41df-b15f-be0daaf99e30";

  // Resolve citation URL via resource_show (discovers the package_id)
  let censusSrc = {
    label: "מפקד 2022 — נתונים נבחרים לפי יישובים ואזורים סטטיסטיים",
    url:   "https://data.gov.il/dataset/census2022",
  };
  try {
    const show = await cbsGet("resource_show", { id: CENSUS_RESOURCE });
    if (show?.result?.package_id) {
      censusSrc = {
        label: show.result.name ?? censusSrc.label,
        url:   `https://data.gov.il/dataset/${show.result.package_id}`,
      };
    }
  } catch (_) {}
  log("info", `  [CBS] Census source: ${censusSrc.url}`);

  // Determine LocalityCode from boundary properties, name search, or Tel Aviv default
  let localityCode = null;
  if (out.matchedArea) {
    const p = out.matchedArea;
    const raw = p.YISHUV_CD ?? p.LocalityCode ?? p.locality_code ?? null;
    if (raw !== null) localityCode = Number(raw) || null;
  }
  if (!localityCode && out.matchedArea) {
    const cityName = out.matchedArea.YISHUV_NM ?? out.matchedArea.yishuv_name ?? null;
    if (cityName) {
      log("info", `  [CBS] Looking up LocalityCode for "${cityName}"...`);
      const lookup = await cbsDatastore(CENSUS_RESOURCE, { q: cityName, limit: 1 });
      localityCode = lookup?.records?.[0]?.LocalityCode
        ? Number(lookup.records[0].LocalityCode) || null
        : null;
      if (localityCode) log("info", `  [CBS] Found LocalityCode: ${localityCode}`);
    }
  }
  if (!localityCode) {
    log("warn", "  [CBS] LocalityCode undetermined — defaulting to Tel Aviv (6900)");
    localityCode = 6900;
  }

  // Fetch all statistical areas in this locality
  log("info", `  [CBS] Fetching census records for LocalityCode=${localityCode}`);
  let censusRecords = [];
  for (const lcVal of [Number(localityCode), String(localityCode)]) {
    const cr = await cbsDatastore(CENSUS_RESOURCE, {
      filters: JSON.stringify({ LocalityCode: lcVal }),
      limit:   500,
    });
    censusRecords = cr?.records || [];
    if (censusRecords.length) break;
  }
  log("info", `  [CBS] Census records: ${censusRecords.length}`);
  if (censusRecords.length > 0) {
    log("info", `  [CBS] Columns: ${Object.keys(censusRecords[0]).join(", ")}`);
  }

  if (censusRecords.length > 0) {
    const wAvg = (col) => {
      let sumWV = 0, sumW = 0;
      for (const r of censusRecords) {
        const pop = Number(r.pop_approx) || 0;
        const val = parseFloat(r[col]);
        if (!isNaN(val)) { sumWV += val * pop; sumW += pop; }
      }
      return sumW > 0 ? (sumWV / sumW).toFixed(1) : null;
    };
    const totalPop = censusRecords.reduce((s, r) => s + (Number(r.pop_approx) || 0), 0);
    const cityRecord = {
      pop_approx:    totalPop || null,
      pop_density:   wAvg("pop_density"),
      Vehicle0_pcnt: wAvg("Vehicle0_pcnt"),
      own_pcnt:      wAvg("own_pcnt"),
      rent_pcnt:     wAvg("rent_pcnt"),
    };
    log("info", `  [CBS] City aggregate — pop=${cityRecord.pop_approx}, density=${cityRecord.pop_density}`);

    const fillMetrics = (target, record, src) => {
      const popVal = record.pop_approx ?? null;
      if (popVal !== null && Number(popVal) > 0)
        target.populationCount = { value: Number(popVal).toLocaleString(), source: src };
      const densVal = record.pop_density ?? null;
      if (densVal !== null) target.populationDensity = { value: densVal, source: src };
      const veh0 = parseFloat(record.Vehicle0_pcnt);
      if (!isNaN(veh0)) target.vehicleOwnershipRate = { value: (100 - veh0).toFixed(1), source: src };
      const ownPct = record.own_pcnt ?? null;
      if (ownPct !== null) target.housingTenureOwners = { value: ownPct, source: src };
      const rentPct = record.rent_pcnt ?? null;
      if (rentPct !== null) target.housingTenureRenters = { value: rentPct, source: src };
    };

    fillMetrics(out.cityMetrics, cityRecord, censusSrc);

    // Try exact statistical area match
    let areaRecord = null;
    if (out.areaCode) {
      const code = String(out.areaCode).trim();
      areaRecord = censusRecords.find(r => {
        const sa = String(r.StatArea ?? r.stat_area ?? "").trim();
        return sa === code || code.endsWith(sa) || sa.endsWith(code);
      }) ?? null;
      if (areaRecord) log("ok", `  [CBS] Matched census record for StatArea "${out.areaCode}"`);
    }

    if (areaRecord) {
      fillMetrics(out.metrics, areaRecord, censusSrc);
    } else {
      log("warn", `  [CBS] No exact StatArea match — using city-level aggregate for metrics`);
      fillMetrics(out.metrics, cityRecord, censusSrc);
      if (out.areaName) out.areaName += ` (city avg.)`;
      else out.areaName = `LocalityCode ${localityCode} (city avg., ${censusRecords.length} areas)`;
    }
  }

  const found = Object.values(out.metrics).filter(m => m.value !== null).length;
  log("ok", `  [CBS] Phase 2 done — ${found}/${Object.keys(out.metrics).length} metrics found`);
  return out;
}

// ---- Elevation data ----------------------------------------

async function fetchElevation(lat, lon) {
  log("info", "Fetching elevation data...");

  const apis = [
    {
      name: "OpenTopoData (ASTER)",
      url: `https://api.opentopodata.org/v1/aster30m?locations=${lat},${lon}`,
      parse: (d) => d?.results?.[0]?.elevation,
    },
    {
      name: "Open-Elevation",
      url: `https://api.open-elevation.com/api/v1/lookup?locations=${lat},${lon}`,
      parse: (d) => d?.results?.[0]?.elevation,
    },
  ];

  for (const api of apis) {
    try {
      const res = await axios.get(api.url, {
        timeout: 8000,
        headers: { "User-Agent": "map-context/1.0 (contact@cuboidstudio.com)" },
      });
      const elev = api.parse(res.data);
      if (elev !== null && elev !== undefined) {
        log("ok", `Site elevation (${api.name}): ${elev}m ASL`);
        return elev;
      }
    } catch (e) {
      log("warn", `  ${api.name} failed (${e.message}), trying next...`);
    }
  }
  log("warn", "All elevation APIs failed — skipping.");
  return null;
}

// ---- Demographics HTML helper ------------------------------

function buildDemographicsHTML(cbsData) {
  function metricRow(label, metric, suffix = "") {
    const val = metric?.value;
    const src = metric?.source;
    const display = (val !== null && val !== undefined)
      ? `${val}${suffix}`
      : `<span style="color:#3a3a3a">N/A</span>`;
    const cite = src
      ? ` <a href="${src.url}" target="_blank" rel="noopener" title="${src.label}" style="color:#555;font-size:9px;text-decoration:none">↗</a>`
      : "";
    return `    <div class="stat-row"><span class="stat-label">${label}</span><span class="stat-value">${display}${cite}</span></div>\n`;
  }

  const areaRow = cbsData.areaName
    ? `    <div class="stat-row"><span class="stat-label">Area</span><span class="stat-value" style="font-size:10px;max-width:140px;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${cbsData.areaName}">${cbsData.areaName}</span></div>\n`
    : "";

  const srcRow = cbsData.boundarySrc
    ? `    <div style="margin-top:8px;font-size:9px;color:#3a3a3a">Boundary: <a href="${cbsData.boundarySrc.url}" target="_blank" rel="noopener" style="color:#555;text-decoration:none">${cbsData.boundarySrc.label}</a></div>\n`
    : "";

  return `  <div class="section">
    <div class="section-title">Demographics</div>
${areaRow}${metricRow("Population", cbsData.metrics.populationCount)}${metricRow("Pop. Density", cbsData.metrics.populationDensity, " /km²")}${metricRow("Vehicles / 1,000", cbsData.metrics.vehicleOwnershipRate)}${metricRow("Homeowners", cbsData.metrics.housingTenureOwners, "%")}${metricRow("Renters", cbsData.metrics.housingTenureRenters, "%")}${srcRow}  </div>
`;
}

// ---- HTML template -----------------------------------------

function buildHTML(config, center, layers, elevation, cbsData, tabaData) {
  log("info", "Compiling HTML dashboard...");

  const { buildings, streets, trees, registrationBlocks, transit, institutions } = layers;
  const { lat, lon } = center;
  const { address, radius_meters } = config;
  const gush   = tabaData?.gush   ?? null;
  const chelka = tabaData?.chelka ?? null;
  const headerSubtitle = gush
    ? `${address} | גוש ${gush}${chelka ? ` חלקה ${chelka}` : ""}`
    : address;

  const buildingsJSON     = JSON.stringify(buildings);
  const streetsJSON       = JSON.stringify(streets);
  const treesJSON         = JSON.stringify(trees);
  const registrationJSON  = JSON.stringify(registrationBlocks);
  const lightRailJSON     = JSON.stringify(transit?.lightRail  ?? { type: "FeatureCollection", features: [] });
  const trainJSON         = JSON.stringify(transit?.train      ?? { type: "FeatureCollection", features: [] });
  const busLinesJSON      = JSON.stringify(transit?.busLines   ?? { type: "FeatureCollection", features: [] });
  const institutionsJSON  = JSON.stringify(institutions        ?? { type: "FeatureCollection", features: [] });
  const tabaJSON          = JSON.stringify(tabaData ?? { gush: null, chelka: null, plans: [], stats: {} });

  // CBS precomputed strings
  const cbsStatAreaJSON     = cbsData?.boundaryGeoJSON ? JSON.stringify(cbsData.boundaryGeoJSON) : "null";
  const cbsDemographicsHTML = cbsData ? buildDemographicsHTML(cbsData) : "";
  const cbsLayerToggleHTML  = cbsData?.boundaryGeoJSON
    ? `    <div class="layer-toggle" id="toggle-stat-area" style="--color:#c47fe8">
      <div class="toggle-switch on" style="--color:#c47fe8"></div>
      <div class="toggle-dot" style="--color:#c47fe8"></div>
      <span class="toggle-label">Statistical Area</span>
      <span class="toggle-count">1</span>
    </div>`
    : "";
  const cbsLayerJS = cbsData?.boundaryGeoJSON
    ? `
const DATA_STAT_AREA = ${cbsStatAreaJSON};
const layerStatArea = L.geoJSON(DATA_STAT_AREA, {
  style: { color: '#c47fe8', weight: 2, fillColor: '#c47fe8', fillOpacity: 0.08 },
  onEachFeature: function(feature, layer) {
    var p = feature.properties || {};
    var rows = Object.entries(p).slice(0, 12)
      .map(function(kv) { return '<b>' + kv[0] + '</b>: ' + kv[1]; })
      .join('<br>');
    layer.bindPopup('<div style="font-size:11px;max-height:200px;overflow:auto">' + rows + '</div>');
  }
}).addTo(map);
makeToggle('toggle-stat-area', layerStatArea);`
    : "";

  const elevNote = elevation !== null ? `${elevation}m ASL` : "N/A";

  return `<!DOCTYPE html>
<html lang="he">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Context Mapper — ${address}</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet"/>
<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"><\/script>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { display: flex; flex-direction: column; height: 100vh; font-family: 'Helvetica Neue', Arial, sans-serif; background: #f5f5f3; color: #222; }

  /* ── Tab bar ───────────────────────────────────────────── */
  #tab-bar {
    height: 36px; min-height: 36px;
    background: #fff;
    border-bottom: 1px solid #ddd;
    display: flex; align-items: stretch;
    direction: rtl;
    z-index: 2000;
    flex-shrink: 0;
  }
  .tab {
    padding: 0 16px;
    font-size: 12px; font-weight: 500;
    color: #666;
    cursor: pointer;
    display: flex; align-items: center;
    border-left: 1px solid #eee;
    white-space: nowrap;
    transition: color 0.15s, background 0.15s;
    user-select: none;
  }
  .tab:last-child { border-left: none; }
  .tab:hover { color: #222; background: #f8f8f6; }
  .tab.active { color: #222; font-weight: 700; border-bottom: 2px solid #222; background: #fff; }

  /* ── Tab content ────────────────────────────────────────── */
  #tab-content { flex: 1; display: flex; overflow: hidden; }
  .panel { display: none; flex: 1; overflow: hidden; }
  .panel.active { display: flex; }
  .panel-coming-soon {
    flex: 1; display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    color: #999; font-size: 13px; gap: 12px;
  }
  .panel-coming-soon h2 { font-size: 18px; color: #bbb; font-weight: 300; }
  .panel-coming-soon ul { list-style: none; font-size: 12px; color: #bbb; line-height: 1.8; text-align: center; direction: rtl; }

  /* ── Sidebar ────────────────────────────────────────────── */
  #sidebar {
    width: 280px; min-width: 280px;
    background: #fff;
    border-left: 1px solid #e0e0e0;
    display: flex; flex-direction: column;
    overflow-y: auto;
    z-index: 1000;
    order: 2;
  }

  .sidebar-header {
    padding: 18px 18px 14px;
    border-bottom: 1px solid #eee;
  }
  .sidebar-header h1 { font-size: 13px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #222; }
  .sidebar-header p  { font-size: 11px; color: #999; margin-top: 4px; line-height: 1.5; }

  .section { padding: 14px 18px; border-bottom: 1px solid #f0f0f0; }
  .section-title { font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #bbb; margin-bottom: 10px; }

  .stat-row { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 5px; }
  .stat-label { font-size: 11px; color: #888; }
  .stat-value { font-size: 12px; font-weight: 600; color: #333; }

  /* Accordion layer groups */
  .layer-group { border-bottom: 1px solid #f0f0f0; }
  .layer-group-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 18px;
    font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase;
    color: #aaa; cursor: pointer; user-select: none;
  }
  .layer-group-header:hover { color: #666; }
  .layer-group-header .arrow { font-size: 9px; transition: transform 0.2s; }
  .layer-group-header.open .arrow { transform: rotate(90deg); }
  .layer-group-body { padding: 0 18px 8px; display: none; }
  .layer-group-body.open { display: block; }

  .layer-toggle {
    display: flex; align-items: center; gap: 10px;
    padding: 6px 0;
    cursor: pointer;
    user-select: none;
  }
  .layer-toggle:hover .toggle-label { color: #111; }

  .toggle-switch {
    position: relative; width: 28px; height: 16px;
    background: #ccc; border-radius: 8px; transition: background 0.2s;
    flex-shrink: 0;
  }
  .toggle-switch.on { background: var(--color); }
  .toggle-switch::after {
    content: ''; position: absolute;
    width: 10px; height: 10px; background: #fff; border-radius: 50%;
    top: 3px; left: 3px; transition: transform 0.2s;
  }
  .toggle-switch.on::after { transform: translateX(12px); }

  .toggle-dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--color); flex-shrink: 0;
  }
  .toggle-label { font-size: 12px; color: #666; flex: 1; }
  .toggle-count { font-size: 10px; color: #bbb; }

  .export-btn {
    margin: 14px 18px;
    padding: 9px;
    background: #f5f5f3;
    border: 1px solid #ddd;
    border-radius: 4px;
    color: #555;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    cursor: pointer;
    text-align: center;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
  }
  .export-btn:hover { background: #eee; border-color: #bbb; color: #222; }

  #map-wrapper { flex: 1; order: 1; position: relative; min-height: 0; }
  #map-2d, #map-3d { position: absolute; inset: 0; }
  .leaflet-container { background: #e8e8e4; }

  .view-toggle-btn {
    margin: 0 18px 8px;
    padding: 9px;
    background: #222;
    border: 1px solid #333;
    border-radius: 4px;
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    cursor: pointer;
    text-align: center;
    transition: background 0.15s;
    user-select: none;
  }
  .view-toggle-btn:hover { background: #444; }

  /* ── TABA panel ─────────────────────────────────────────── */
  #taba-list-panel {
    width: 35%; min-width: 240px;
    background: #fff;
    border-right: 1px solid #e0e0e0;
    display: flex; flex-direction: column;
    overflow: hidden;
    order: 1;
  }
  #taba-map-panel { flex: 1; display: flex; flex-direction: column; order: 2; }
  #taba-map { flex: 1; }
  .taba-list-header {
    padding: 14px 14px 10px;
    border-bottom: 1px solid #eee;
    flex-shrink: 0;
  }
  .taba-search {
    display: block; width: 100%; margin-top: 8px;
    padding: 6px 10px; font-size: 12px;
    border: 1px solid #ddd; border-radius: 4px;
    outline: none; direction: rtl;
  }
  .taba-search:focus { border-color: #999; }
  #taba-meta { font-size: 10px; color: #bbb; margin-top: 6px; text-align: right; direction: rtl; }
  #taba-plan-list { flex: 1; overflow-y: auto; direction: rtl; }
  .taba-plan-item {
    padding: 10px 14px; border-bottom: 1px solid #f0f0f0;
    cursor: pointer; transition: background 0.1s;
  }
  .taba-plan-item:hover    { background: #f8f8f6; }
  .taba-plan-item.selected { background: #f0f0f0; }
  .taba-plan-num  { font-size: 11px; font-weight: 700; color: #333; }
  .taba-plan-name { font-size: 11px; color: #666; margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .taba-plan-meta { display: flex; align-items: center; gap: 8px; margin-top: 5px; flex-wrap: wrap; }
  .status-badge {
    display: inline-block; padding: 2px 6px;
    font-size: 9px; font-weight: 700; letter-spacing: 0.05em;
    border-radius: 10px; color: #fff; white-space: nowrap;
  }
  .status-badge.approved { background: #2d8a4e; }
  .status-badge.deposit  { background: #e67e22; }
  .status-badge.planning { background: #4a90d9; }
  .taba-area  { font-size: 10px; color: #999; }
  .taba-empty { padding: 32px 20px; text-align: center; color: #bbb; font-size: 12px; direction: rtl; line-height: 2; }
  #taba-detail-panel {
    display: none; flex-shrink: 0;
    border-top: 2px solid #4a90d9;
    background: #f9f9f9;
    padding: 12px 14px 14px;
    overflow-y: auto; max-height: 42%;
    direction: rtl; font-size: 12px;
  }
  #taba-detail-panel.visible { display: block; }
  .taba-detail-num  { font-family: monospace; font-size: 11px; color: #888; margin-bottom: 3px; }
  .taba-detail-name { font-weight: 700; font-size: 13px; color: #222; margin-bottom: 7px; line-height: 1.35; }
  .taba-detail-row  { font-size: 11px; color: #666; margin-bottom: 3px; }
  .taba-detail-docs { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  .taba-detail-docs a { font-size: 10px; color: #4a90d9; text-decoration: none; }
  .taba-detail-docs a:hover { text-decoration: underline; }
  .taba-detail-mavat { margin-top: 8px; padding-top: 7px; border-top: 1px solid #e8e8e8; }
  .taba-detail-mavat a { font-size: 10px; color: #999; text-decoration: none; }
  .taba-detail-mavat a:hover { color: #4a90d9; }
  .taba-detail-close {
    float: left; cursor: pointer; color: #bbb; font-size: 15px; line-height: 1;
    padding: 0 2px; margin-top: -2px;
  }
  .taba-detail-close:hover { color: #666; }
</style>
</head>
<body>

<div id="tab-bar">
  <div class="tab active" data-panel="panel-map">מפה</div>
  <div class="tab" data-panel="panel-dashboard">דשבורד</div>
  <div class="tab" data-panel="panel-gis">GIS</div>
  <div class="tab" data-panel="panel-stats">סטטיסטי</div>
  <div class="tab" data-panel="panel-env">סביבה</div>
  <div class="tab" data-panel="panel-realestate">נדל"ן</div>
  <div class="tab" data-panel="panel-plans">תב"עות</div>
</div>

<div id="tab-content">

  <!-- Map panel (active) -->
  <div id="panel-map" class="panel active">
    <div id="sidebar">
      <div class="sidebar-header">
        <h1>Context Mapper</h1>
        <p>${headerSubtitle}</p>
      </div>

      <div class="section">
        <div class="section-title">Site Data</div>
        <div class="stat-row"><span class="stat-label">Radius</span><span class="stat-value">${radius_meters}m</span></div>
        <div class="stat-row"><span class="stat-label">Elevation</span><span class="stat-value">${elevNote}</span></div>
        <div class="stat-row"><span class="stat-label">Lat / Lon</span><span class="stat-value">${lat.toFixed(5)}, ${lon.toFixed(5)}</span></div>
      </div>

      <!-- Layers accordion -->
      <div class="layer-group">
        <div class="layer-group-header open" onclick="toggleGroup(this)">
          <span>מבנים</span><span class="arrow">▶</span>
        </div>
        <div class="layer-group-body open">
          <div class="layer-toggle" id="toggle-buildings" style="--color:#4a90d9">
            <div class="toggle-switch on" style="--color:#4a90d9"></div>
            <div class="toggle-dot" style="--color:#4a90d9"></div>
            <span class="toggle-label">Buildings</span>
            <span class="toggle-count">${buildings.features.length}</span>
          </div>
        </div>
      </div>

      <div class="layer-group">
        <div class="layer-group-header open" onclick="toggleGroup(this)">
          <span>תחבורה</span><span class="arrow">▶</span>
        </div>
        <div class="layer-group-body open">
          <div class="layer-toggle" id="toggle-streets" style="--color:#555">
            <div class="toggle-switch on" style="--color:#555"></div>
            <div class="toggle-dot" style="--color:#555"></div>
            <span class="toggle-label">Streets</span>
            <span class="toggle-count">${streets.features.length}</span>
          </div>
          <div class="layer-toggle" id="toggle-lightrail" style="--color:#9b59b6">
            <div class="toggle-switch on" style="--color:#9b59b6"></div>
            <div class="toggle-dot" style="--color:#9b59b6"></div>
            <span class="toggle-label">Light Rail</span>
            <span class="toggle-count">${(transit?.lightRail?.features?.length ?? 0)}</span>
          </div>
          <div class="layer-toggle" id="toggle-train" style="--color:#e67e22">
            <div class="toggle-switch on" style="--color:#e67e22"></div>
            <div class="toggle-dot" style="--color:#e67e22"></div>
            <span class="toggle-label">Train</span>
            <span class="toggle-count">${(transit?.train?.features?.length ?? 0)}</span>
          </div>
        </div>
      </div>

      <div class="layer-group">
        <div class="layer-group-header open" onclick="toggleGroup(this)">
          <span>גושים</span><span class="arrow">▶</span>
        </div>
        <div class="layer-group-body open">
          <div class="layer-toggle" id="toggle-registration" style="--color:#8B4513">
            <div class="toggle-switch on" style="--color:#8B4513"></div>
            <div class="toggle-dot" style="--color:#8B4513"></div>
            <span class="toggle-label">Registration Blocks</span>
            <span class="toggle-count">${registrationBlocks.features.length}</span>
          </div>
        </div>
      </div>

      <div class="layer-group">
        <div class="layer-group-header open" onclick="toggleGroup(this)">
          <span>צמחייה</span><span class="arrow">▶</span>
        </div>
        <div class="layer-group-body open">
          <div class="layer-toggle" id="toggle-trees" style="--color:#2d8a4e">
            <div class="toggle-switch on" style="--color:#2d8a4e"></div>
            <div class="toggle-dot" style="--color:#2d8a4e"></div>
            <span class="toggle-label">Trees & Green</span>
            <span class="toggle-count">${trees.features.length}</span>
          </div>
        </div>
      </div>

      <div class="layer-group">
        <div class="layer-group-header open" onclick="toggleGroup(this)">
          <span>מוסדות</span><span class="arrow">▶</span>
        </div>
        <div class="layer-group-body open">
          <div class="layer-toggle" id="toggle-institutions" style="--color:#e74c3c">
            <div class="toggle-switch on" style="--color:#e74c3c"></div>
            <div class="toggle-dot" style="--color:#e74c3c"></div>
            <span class="toggle-label">Institutions</span>
            <span class="toggle-count">${(institutions?.features?.length ?? 0)}</span>
          </div>
${cbsLayerToggleHTML}
        </div>
      </div>

${cbsDemographicsHTML}
      <div class="section">
        <div class="section-title">Base Map</div>
        <div class="layer-toggle" id="toggle-basemap" style="--color:#888">
          <div class="toggle-switch" style="--color:#888"></div>
          <div class="toggle-dot" style="--color:#888"></div>
          <span class="toggle-label">Satellite</span>
        </div>
      </div>

      <div class="view-toggle-btn" id="viewToggle" onclick="toggleView()">3D View</div>

      <div class="export-btn" id="exportSVG">Export SVG for Rhino</div>
      <div class="export-btn" id="exportOBJ" style="display:none">Export OBJ for Rhino</div>
      <div style="padding: 0 18px 18px; font-size: 10px; color: #bbb; line-height: 1.6;" id="exportNote">
        SVG output uses metric coordinates (m) centred on site. Layer names preserved as group IDs. Import directly into Rhino — no rescaling needed.
      </div>
    </div>

    <div id="map-wrapper">
      <div id="map-2d"></div>
      <div id="map-3d"></div>
    </div>
  </div><!-- /panel-map -->

  <!-- Coming-soon panels -->
  <div id="panel-dashboard" class="panel">
    <div class="panel-coming-soon">
      <h2>דשבורד</h2>
      <p>coming soon</p>
      <ul><li>סיכום נתונים</li><li>גרפים השוואתיים</li><li>ציון אזורי</li></ul>
    </div>
  </div>
  <div id="panel-gis" class="panel">
    <div class="panel-coming-soon">
      <h2>GIS</h2>
      <p>coming soon</p>
      <ul><li>ייצוא שכבות</li><li>ניתוח מרחבי</li><li>קואורדינטות ITM</li></ul>
    </div>
  </div>
  <div id="panel-stats" class="panel">
    <div class="panel-coming-soon">
      <h2>סטטיסטי</h2>
      <p>coming soon</p>
      <ul><li>דמוגרפיה מורחבת</li><li>מפקד 2022</li><li>השוואה עירונית</li></ul>
    </div>
  </div>
  <div id="panel-env" class="panel">
    <div class="panel-coming-soon">
      <h2>סביבה</h2>
      <p>coming soon</p>
      <ul><li>נתוני עצים</li><li>מפגעי רעש</li><li>קרינה ואוויר</li></ul>
    </div>
  </div>
  <div id="panel-realestate" class="panel">
    <div class="panel-coming-soon">
      <h2>נדל"ן</h2>
      <p>coming soon</p>
      <ul><li>עסקאות</li><li>מחירי שכירות</li><li>מדד שוק</li></ul>
    </div>
  </div>
  <div id="panel-plans" class="panel">
    <div id="taba-list-panel">
      <div class="taba-list-header">
        <div class="section-title" style="margin:0">תב&quot;עות</div>
        <input type="text" id="taba-search" class="taba-search" placeholder="חיפוש לפי מספר / שם תכנית..." />
        <div id="taba-meta"></div>
      </div>
      <div id="taba-plan-list"></div>
      <div id="taba-detail-panel"></div>
    </div>
    <div id="taba-map-panel">
      <div id="taba-map"></div>
    </div>
  </div>

</div><!-- /tab-content -->

<script>
// ── Tab switching ─────────────────────────────────────────
document.querySelectorAll('.tab').forEach(function(tab) {
  tab.addEventListener('click', function() {
    document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
    document.querySelectorAll('.panel').forEach(function(p) { p.classList.remove('active'); });
    tab.classList.add('active');
    var panelId = tab.getAttribute('data-panel');
    var panel = document.getElementById(panelId);
    if (panel) {
      panel.classList.add('active');
      if (panelId === 'panel-map') { setTimeout(function() { map.invalidateSize(); }, 50); }
    }
  });
});

// Ensure map renders correctly on initial load (flex layout may not be
// settled when Leaflet initialises synchronously during script execution)
setTimeout(function() { map.invalidateSize(); }, 100);

// ── Layer group accordion ─────────────────────────────────
function toggleGroup(header) {
  header.classList.toggle('open');
  var body = header.nextElementSibling;
  body.classList.toggle('open');
}

// ── Injected GeoJSON data ─────────────────────────────────
const DATA_BUILDINGS    = ${buildingsJSON};
const DATA_STREETS      = ${streetsJSON};
const DATA_TREES        = ${treesJSON};
const DATA_REGISTRATION = ${registrationJSON};
const DATA_LIGHTRAIL    = ${lightRailJSON};
const DATA_TRAIN        = ${trainJSON};
const DATA_BUSLINES     = ${busLinesJSON};
const DATA_INSTITUTIONS = ${institutionsJSON};
const SITE_CENTER = { lat: ${lat}, lon: ${lon} };
const SITE_RADIUS = ${radius_meters};

// ── Map init ─────────────────────────────────────────────
const map = L.map('map-2d', { zoomControl: true, attributionControl: true })
  .setView([SITE_CENTER.lat, SITE_CENTER.lon], 17);

const basePositron = L.tileLayer(
  'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  { attribution: '© OpenStreetMap contributors © CARTO', maxZoom: 20 }
).addTo(map);

const baseSatellite = L.tileLayer(
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  { attribution: 'Esri World Imagery', maxZoom: 20 }
);

// Site radius circle
L.circle([SITE_CENTER.lat, SITE_CENTER.lon], {
  radius: SITE_RADIUS,
  color: '#333',
  weight: 1,
  fillOpacity: 0,
  dashArray: '4 4',
}).addTo(map);

// ── GeoJSON layers ───────────────────────────────────────
const layerBuildings = L.geoJSON(DATA_BUILDINGS, {
  style: { color: '#4a90d9', weight: 1.5, fillColor: '#4a90d9', fillOpacity: 0.4 }
}).addTo(map);

const layerStreets = L.geoJSON(DATA_STREETS, {
  style: { color: '#555', weight: 2, fillOpacity: 0 }
}).addTo(map);

const layerTrees = L.geoJSON(DATA_TREES, {
  style:        { color: '#2d8a4e', weight: 1, fillColor: '#2d8a4e', fillOpacity: 0.35 },
  pointToLayer: function(f, latlng) {
    return L.circleMarker(latlng, { radius: 4, color: '#2d8a4e', weight: 1, fillColor: '#2d8a4e', fillOpacity: 0.7 });
  }
}).addTo(map);

const layerRegistration = L.geoJSON(DATA_REGISTRATION, {
  style: { color: '#8B4513', weight: 1.5, fillOpacity: 0 }
}).addTo(map);

const layerLightRail = L.geoJSON(DATA_LIGHTRAIL, {
  style: { color: '#9b59b6', weight: 3, fillOpacity: 0 }
}).addTo(map);

const layerTrain = L.geoJSON(DATA_TRAIN, {
  style: { color: '#e67e22', weight: 3, fillOpacity: 0 }
}).addTo(map);

const INSTITUTION_COLORS = {
  school: '#e74c3c', university: '#e74c3c', college: '#e74c3c', kindergarten: '#e74c3c',
  hospital: '#c0392b', clinic: '#c0392b',
  library: '#2980b9',
  place_of_worship: '#8e44ad',
  police: '#1abc9c', fire_station: '#f39c12',
};
const layerInstitutions = L.geoJSON(DATA_INSTITUTIONS, {
  style: function(f) {
    var c = INSTITUTION_COLORS[f.properties && f.properties.amenity] || '#e74c3c';
    return { color: c, weight: 1.5, fillColor: c, fillOpacity: 0.3 };
  },
  pointToLayer: function(f, latlng) {
    var c = INSTITUTION_COLORS[f.properties && f.properties.amenity] || '#e74c3c';
    return L.circleMarker(latlng, { radius: 6, color: c, weight: 1.5, fillColor: c, fillOpacity: 0.8 });
  },
  onEachFeature: function(feature, layer) {
    var p = feature.properties || {};
    var name = p.name || p.amenity || 'Institution';
    layer.bindPopup('<b>' + name + '</b>' + (p.amenity ? '<br>' + p.amenity : ''));
  }
}).addTo(map);
${cbsLayerJS}

// ── Toggle logic ─────────────────────────────────────────
function makeToggle(id, layer, startOn) {
  var el   = document.getElementById(id);
  if (!el) return;
  var sw   = el.querySelector('.toggle-switch');
  var active = startOn !== false;
  if (!active) { map.removeLayer(layer); sw.classList.remove('on'); }
  el.addEventListener('click', function() {
    active = !active;
    sw.classList.toggle('on', active);
    active ? map.addLayer(layer) : map.removeLayer(layer);
  });
}

makeToggle('toggle-buildings',    layerBuildings);
makeToggle('toggle-streets',      layerStreets);
makeToggle('toggle-trees',        layerTrees);
makeToggle('toggle-registration', layerRegistration);
makeToggle('toggle-lightrail',    layerLightRail);
makeToggle('toggle-train',        layerTrain);
makeToggle('toggle-institutions', layerInstitutions);

var basemapToggle = document.getElementById('toggle-basemap');
if (basemapToggle) {
  var basemapSw = basemapToggle.querySelector('.toggle-switch');
  var basemapOn = false;
  basemapToggle.addEventListener('click', function() {
    basemapOn = !basemapOn;
    basemapSw.classList.toggle('on', basemapOn);
    basemapOn ? map.addLayer(baseSatellite) : map.removeLayer(baseSatellite);
  });
}

// ── SVG Export ───────────────────────────────────────────
// Converts WGS84 lon/lat → metric offsets (m) from site centre
// Uses equirectangular approximation; valid for small radii (< 5 km)
function toMeters(lon, lat) {
  const R     = 6378137;
  const dLat  = (lat - SITE_CENTER.lat) * (Math.PI / 180);
  const dLon  = (lon - SITE_CENTER.lon) * (Math.PI / 180);
  const latR  = SITE_CENTER.lat * (Math.PI / 180);
  const x     =  dLon * R * Math.cos(latR);
  const y     = -dLat * R;            // flip y: north = negative SVG-y
  return [x, y];
}

function coordsToMeters(coords) {
  if (!Array.isArray(coords[0])) return toMeters(coords[0], coords[1]);
  return coords.map(c => coordsToMeters(c));
}

function pad(n, digits = 4) { return n.toFixed(digits); }

function renderFeature(feature, svgScale) {
  const geom = feature.geometry;
  if (!geom) return '';

  function pointsStr(ring) {
    return ring.map(c => {
      const [mx, my] = Array.isArray(c[0]) ? coordsToMeters(c) : toMeters(c[0], c[1]);
      return \`\${pad(mx * svgScale)},\${pad(my * svgScale)}\`;
    }).join(' ');
  }

  if (geom.type === 'Point') {
    const [mx, my] = toMeters(geom.coordinates[0], geom.coordinates[1]);
    return \`<circle cx="\${pad(mx * svgScale)}" cy="\${pad(my * svgScale)}" r="\${pad(3 * svgScale)}"/>\`;
  }
  if (geom.type === 'LineString') {
    return \`<polyline points="\${pointsStr(geom.coordinates)}" fill="none"/>\`;
  }
  if (geom.type === 'Polygon') {
    const outer = pointsStr(geom.coordinates[0]);
    return \`<polygon points="\${outer}"/>\`;
  }
  if (geom.type === 'MultiPolygon') {
    return geom.coordinates.map(poly => \`<polygon points="\${pointsStr(poly[0])}"/>\`).join('\\n');
  }
  return '';
}

function buildLayerGroup(id, data, stroke, fill, strokeW, svgScale) {
  const features = data.features
    .map(f => renderFeature(f, svgScale))
    .filter(Boolean)
    .join('\\n    ');
  return \`<g id="\${id}" stroke="\${stroke}" fill="\${fill}" stroke-width="\${strokeW}">
    \${features}
  </g>\`;
}

document.getElementById('exportSVG').addEventListener('click', () => {
  const SVG_PX_PER_METER = 1;  // 1 SVG unit = 1 metre (Rhino imports mm; user sets units)
  const SCALE = SVG_PX_PER_METER;
  const HALF  = SITE_RADIUS * SCALE;
  const SIZE  = HALF * 2;

  const svgLayers = [];

  if (map.hasLayer(layerBuildings)) {
    svgLayers.push(buildLayerGroup('buildings',    DATA_BUILDINGS,    '#4a90d9', 'rgba(74,144,217,0.4)',  0.5, SCALE));
  }
  if (map.hasLayer(layerStreets)) {
    svgLayers.push(buildLayerGroup('streets',      DATA_STREETS,      '#555',    'none',                  1,   SCALE));
  }
  if (map.hasLayer(layerTrees)) {
    svgLayers.push(buildLayerGroup('trees',        DATA_TREES,        '#2d8a4e', 'rgba(45,138,78,0.4)',   0.5, SCALE));
  }
  if (map.hasLayer(layerRegistration)) {
    svgLayers.push(buildLayerGroup('registration', DATA_REGISTRATION, '#8B4513', 'none',                  1,   SCALE));
  }

  // Scale bar: 100 m
  const barLen = 100 * SCALE;
  const barY   = HALF - 20;
  const barX   = -HALF + 20;
  const scalebar = \`
  <g id="scalebar" font-family="Helvetica,Arial,sans-serif" font-size="\${8*SCALE}" fill="#333" stroke="#333">
    <line x1="\${pad(barX)}" y1="\${pad(barY)}" x2="\${pad(barX + barLen)}" y2="\${pad(barY)}" stroke-width="\${1.5*SCALE}"/>
    <line x1="\${pad(barX)}" y1="\${pad(barY - 4*SCALE)}" x2="\${pad(barX)}" y2="\${pad(barY + 4*SCALE)}" stroke-width="\${1.5*SCALE}"/>
    <line x1="\${pad(barX + barLen)}" y1="\${pad(barY - 4*SCALE)}" x2="\${pad(barX + barLen)}" y2="\${pad(barY + 4*SCALE)}" stroke-width="\${1.5*SCALE}"/>
    <text x="\${pad(barX + barLen/2)}" y="\${pad(barY - 6*SCALE)}" text-anchor="middle" stroke="none">100 m</text>
  </g>\`;

  // Site circle
  const siteCircle = \`<circle id="site_boundary" cx="0" cy="0" r="\${HALF}" fill="none" stroke="#999" stroke-width="\${0.5*SCALE}" stroke-dasharray="\${4*SCALE} \${4*SCALE}"/>\`;

  const svg = \`<?xml version="1.0" encoding="UTF-8"?>
<!-- Context Mapper SVG Export
     Site: ${address}
     CRS origin: \${SITE_CENTER.lat.toFixed(6)}, \${SITE_CENTER.lon.toFixed(6)}
     Units: 1 SVG unit = 1 metre
     Import into Rhino: File → Import → set model units to Metres
-->
<svg xmlns="http://www.w3.org/2000/svg"
     width="\${SIZE}" height="\${SIZE}"
     viewBox="\${-HALF} \${-HALF} \${SIZE} \${SIZE}">
  \${siteCircle}
  \${svgLayers.join('\\n  ')}
  \${scalebar}
</svg>\`;

  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = 'context_mapper_export.svg';
  a.click();
  URL.revokeObjectURL(a.href);
});
// ── 2D / 3D toggle ────────────────────────────────────────────
var map3d = null;
var is3D  = false;

var LAYER_3D_MAP = {
  'toggle-buildings': 'buildings-3d',
  'toggle-streets':   'streets-3d',
  'toggle-trees':     'trees-3d',
};

function sync3DVisibility() {
  if (!map3d) return;
  Object.keys(LAYER_3D_MAP).forEach(function(toggleId) {
    var layerId = LAYER_3D_MAP[toggleId];
    var el = document.getElementById(toggleId);
    if (!el || !map3d.getLayer(layerId)) return;
    var on = el.querySelector('.toggle-switch').classList.contains('on');
    map3d.setLayoutProperty(layerId, 'visibility', on ? 'visible' : 'none');
  });
}

// Add 3D sync listeners to existing toggles (after Leaflet toggles have run)
['toggle-buildings', 'toggle-streets', 'toggle-trees'].forEach(function(id) {
  var el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('click', function() {
    if (!map3d || !map3d.isStyleLoaded()) return;
    var on = el.querySelector('.toggle-switch').classList.contains('on');
    var layerId = LAYER_3D_MAP[id];
    if (layerId && map3d.getLayer(layerId)) {
      map3d.setLayoutProperty(layerId, 'visibility', on ? 'visible' : 'none');
    }
  });
});

function initMap3D() {
  map3d = new maplibregl.Map({
    container: 'map-3d',
    style: {
      version: 8,
      sources: {
        'carto': {
          type: 'raster',
          tiles: [
            'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
            'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
            'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
          ],
          tileSize: 256,
          attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
          maxzoom: 19,
        },
        'buildings-src':  { type: 'geojson', data: DATA_BUILDINGS },
        'streets-src':    { type: 'geojson', data: DATA_STREETS },
        'trees-src':      { type: 'geojson', data: DATA_TREES },
      },
      layers: [
        { id: 'background',    type: 'background', paint: { 'background-color': '#e8e8e4' } },
        { id: 'carto-raster',  type: 'raster',     source: 'carto' },
        {
          id: 'buildings-3d',
          type: 'fill-extrusion',
          source: 'buildings-src',
          paint: {
            'fill-extrusion-color':   '#4a90d9',
            'fill-extrusion-opacity': 0.75,
            'fill-extrusion-height':  ['coalesce', ['get', 'height'], 9.6],
            'fill-extrusion-base':    0,
          },
        },
        {
          id: 'streets-3d',
          type: 'line',
          source: 'streets-src',
          paint: { 'line-color': '#555', 'line-width': 2 },
        },
        {
          id: 'trees-3d',
          type: 'circle',
          source: 'trees-src',
          paint: { 'circle-color': '#2d8a4e', 'circle-radius': 4, 'circle-opacity': 0.7 },
        },
      ],
    },
    center:  [SITE_CENTER.lon, SITE_CENTER.lat],
    zoom:    16,
    pitch:   60,
    bearing: 0,
  });

  map3d.on('load', function() { sync3DVisibility(); });

  map3d.on('click', 'buildings-3d', function(e) {
    if (!e.features || !e.features.length) return;
    var p = e.features[0].properties;
    var h = p.height || 9.6;
    var floors = Math.round(h / 3.2);
    var srcMap = { attr: 'GIS attribute', floors: 'GIS attribute', osm: 'OSM levels', 'default': 'default' };
    var srcLabel = srcMap[p.heightSource] || (p.heightSource || 'default');
    new maplibregl.Popup({ closeButton: true, closeOnClick: true })
      .setLngLat(e.lngLat)
      .setHTML(
        '<div style="font-size:12px;line-height:1.6;min-width:140px">' +
        '<div style="font-weight:700;margin-bottom:4px">Building</div>' +
        '<div><b>' + h.toFixed(1) + ' m</b> height</div>' +
        '<div>' + floors + ' floor' + (floors !== 1 ? 's' : '') + '</div>' +
        '<div style="color:#888;font-size:10px;margin-top:4px">Source: ' + srcLabel + '</div>' +
        '</div>'
      )
      .addTo(map3d);
  });
  map3d.on('mouseenter', 'buildings-3d', function() { map3d.getCanvas().style.cursor = 'pointer'; });
  map3d.on('mouseleave', 'buildings-3d', function() { map3d.getCanvas().style.cursor = ''; });
}

function toggleView() {
  is3D = !is3D;
  var btn       = document.getElementById('viewToggle');
  var map2dEl   = document.getElementById('map-2d');
  var map3dEl   = document.getElementById('map-3d');
  var svgBtn    = document.getElementById('exportSVG');
  var objBtn    = document.getElementById('exportOBJ');
  var exportNote = document.getElementById('exportNote');

  if (is3D) {
    map2dEl.style.display   = 'none';
    map3dEl.style.display   = 'block';
    svgBtn.style.display    = 'none';
    objBtn.style.display    = 'block';
    exportNote.textContent  = 'OBJ output: closed meshes per building (walls + roof), streets as polylines, trees as line stubs. Metric coordinates (1 unit = 1m). Companion .mtl file with named materials.';
    btn.textContent         = '2D View';
    if (!map3d) {
      initMap3D();
    } else {
      map3d.resize();
    }
  } else {
    map3dEl.style.display   = 'none';
    map2dEl.style.display   = 'block';
    objBtn.style.display    = 'none';
    svgBtn.style.display    = 'block';
    exportNote.textContent  = 'SVG output uses metric coordinates (m) centred on site. Layer names preserved as group IDs. Import directly into Rhino — no rescaling needed.';
    btn.textContent         = '3D View';
    setTimeout(function() { map.invalidateSize(); }, 50);
  }
}

// ── OBJ Export ────────────────────────────────────────────────
document.getElementById('exportOBJ').addEventListener('click', function() {
  var R    = 6378137;
  var latR = SITE_CENTER.lat * Math.PI / 180;

  function toM(lon, lat) {
    var dx = (lon - SITE_CENTER.lon) * Math.PI / 180;
    var dy = (lat - SITE_CENTER.lat) * Math.PI / 180;
    return [dx * R * Math.cos(latR), dy * R];
  }
  function f4(n) { return n.toFixed(4); }

  var verts = [];   // [x, y, z] — 1-indexed in OBJ
  var objLines = [];
  var vi = 0;       // vertex counter

  function addVert(x, y, z) { verts.push([x, y, z]); return ++vi; }

  var bldgOn = document.getElementById('toggle-buildings').querySelector('.toggle-switch').classList.contains('on');
  if (bldgOn) {
    objLines.push('usemtl buildings');
    DATA_BUILDINGS.features.forEach(function(feature) {
      var h = (feature.properties && feature.properties.height) ? feature.properties.height : 9.6;
      var geom = feature.geometry;
      if (!geom) return;
      var rings = geom.type === 'Polygon' ? geom.coordinates
        : geom.type === 'MultiPolygon'   ? geom.coordinates.map(function(p) { return p[0]; })
        : [];
      rings.forEach(function(ring) {
        if (ring.length < 3) return;
        var n = ring.length - 1; // closed ring — skip duplicate last
        var bot = [], top = [];
        for (var i = 0; i < n; i++) {
          var m = toM(ring[i][0], ring[i][1]);
          bot.push(addVert(m[0], m[1], 0));
          top.push(addVert(m[0], m[1], h));
        }
        // Walls: one quad per edge
        for (var i = 0; i < n; i++) {
          var j = (i + 1) % n;
          objLines.push('f ' + bot[i] + ' ' + bot[j] + ' ' + top[j] + ' ' + top[i]);
        }
        // Flat roof: fan-triangulate from first vertex
        for (var i = 1; i < n - 1; i++) {
          objLines.push('f ' + top[0] + ' ' + top[i] + ' ' + top[i + 1]);
        }
        // Flat floor: fan-triangulate (reversed winding for inward normal)
        for (var i = 1; i < n - 1; i++) {
          objLines.push('f ' + bot[0] + ' ' + bot[i + 1] + ' ' + bot[i]);
        }
      });
    });
  }

  var stOn = document.getElementById('toggle-streets').querySelector('.toggle-switch').classList.contains('on');
  if (stOn) {
    objLines.push('usemtl streets');
    DATA_STREETS.features.forEach(function(feature) {
      var geom = feature.geometry;
      if (!geom || geom.type !== 'LineString') return;
      var cs = geom.coordinates;
      var ids = cs.map(function(c) { var m = toM(c[0], c[1]); return addVert(m[0], m[1], 0); });
      objLines.push('l ' + ids.join(' '));
    });
  }

  var trOn = document.getElementById('toggle-trees').querySelector('.toggle-switch').classList.contains('on');
  if (trOn) {
    objLines.push('usemtl trees');
    DATA_TREES.features.forEach(function(feature) {
      var geom = feature.geometry;
      if (!geom || geom.type !== 'Point') return;
      var p = feature.properties || {};
      var th = (p.canopy_radius || p.crown_radius || p.CANOPY_R || 3);
      var m = toM(geom.coordinates[0], geom.coordinates[1]);
      var base = addVert(m[0], m[1], 0);
      var tip  = addVert(m[0], m[1], th);
      objLines.push('l ' + base + ' ' + tip);
    });
  }

  // Build vertex block
  var vertBlock = verts.map(function(v) { return 'v ' + f4(v[0]) + ' ' + f4(v[1]) + ' ' + f4(v[2]); }).join('\\n');

  var obj = 'mtllib context_mapper_3d.mtl\\n# context mapper OBJ export\\n' +
    vertBlock + '\\n' + objLines.join('\\n') + '\\n';

  var mtl = 'newmtl buildings\\nKd 0.290 0.565 0.851\\nKa 0 0 0\\nKs 0 0 0\\n\\n' +
    'newmtl streets\\nKd 0.333 0.333 0.333\\nKa 0 0 0\\nKs 0 0 0\\n\\n' +
    'newmtl trees\\nKd 0.176 0.545 0.306\\nKa 0 0 0\\nKs 0 0 0\\n';

  function dl(content, filename, mime) {
    var blob = new Blob([content], { type: mime });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  dl(mtl, 'context_mapper_3d.mtl', 'text/plain');
  dl(obj, 'context_mapper_3d.obj', 'text/plain');
});

// ── TABA tab ─────────────────────────────────────────────────
const DATA_TABA = ${tabaJSON};
var tabaMap           = null;
var tabaMapInit       = false;
var tabaLayers        = {};
var tabaHighlightLayer = null;

var TABA_COLORS = { approved: '#2d8a4e', deposit: '#e67e22', planning: '#4a90d9' };
function tabaLabel(status) {
  return { approved: 'מאושרת', deposit: 'להפקדה', planning: 'הכנה' }[status] || status;
}

function buildTABAPopup(plan) {
  var color = TABA_COLORS[plan.status] || '#888';
  var h = '<div style="font-size:12px;min-width:260px;direction:rtl">';
  h += '<div style="font-weight:700;font-size:13px;margin-bottom:6px">' + (plan.name || plan.planNumber) + '</div>';
  h += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">';
  h += '<span style="font-family:monospace;font-size:11px;color:#666">' + plan.planNumber + '</span>';
  h += '<span style="background:' + color + ';color:#fff;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700">' + tabaLabel(plan.status) + '</span>';
  h += '</div>';
  if (plan.areaDunams)   h += '<div style="color:#666;font-size:11px;margin-bottom:3px">שטח: ' + plan.areaDunams + ' דונם</div>';
  if (plan.purposeCode)  h += '<div style="color:#666;font-size:11px;margin-bottom:3px">ייעוד: ' + plan.purposeCode + '</div>';
  if (plan.approvalDate) h += '<div style="color:#666;font-size:11px;margin-bottom:3px">תאריך אישור: ' + plan.approvalDate + '</div>';
  if (plan.parcels && plan.parcels.length) {
    h += '<div style="color:#666;font-size:10px;margin-top:6px;border-top:1px solid #eee;padding-top:6px">חלקות: ';
    h += plan.parcels.slice(0, 5).join(', ');
    if (plan.parcels.length > 5) h += ' ועוד ' + (plan.parcels.length - 5);
    h += '</div>';
  }
  var docs = [];
  if (plan.documents && plan.documents.main) docs.push('<a href="' + plan.documents.main + '" target="_blank" style="color:#4a90d9;font-size:10px;text-decoration:none">&#128196; תכנית ראשית</a>');
  if (plan.documents && plan.documents.K)    docs.push('<a href="' + plan.documents.K    + '" target="_blank" style="color:#4a90d9;font-size:10px;text-decoration:none">&#128506; שרטוטים (K)</a>');
  if (plan.documents && plan.documents.M)    docs.push('<a href="' + plan.documents.M    + '" target="_blank" style="color:#4a90d9;font-size:10px;text-decoration:none">&#128203; תקנון (M)</a>');
  if (docs.length) h += '<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:8px">' + docs.join('') + '</div>';
  var mavatHref = plan.mavatUrl || ('https://mavat.iplan.gov.il/SV3?text=' + encodeURIComponent(plan.planNumber));
  h += '<div style="margin-top:8px"><a href="' + mavatHref + '" target="_blank" rel="noopener" ';
  h += 'style="font-size:10px;color:#888;text-decoration:none">&#8599; פתח במקור (מבא&quot;ת)</a></div>';
  h += '</div>';
  return h;
}

function initTABAMap() {
  tabaMap = L.map('taba-map', { zoomControl: true }).setView([SITE_CENTER.lat, SITE_CENTER.lon], 15);

  var tabaPositron = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    { attribution: '&copy; OpenStreetMap contributors &copy; CARTO', maxZoom: 20 }
  ).addTo(tabaMap);

  var tabaSatellite = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Esri World Imagery', maxZoom: 20 }
  );

  // Basemap toggle button (top-right)
  var basemapBtn = L.control({ position: 'topright' });
  basemapBtn.onAdd = function() {
    var btn = L.DomUtil.create('div', '');
    btn.style.cssText = 'background:#fff;border:1px solid #ccc;border-radius:4px;padding:4px 8px;font-size:11px;cursor:pointer;user-select:none';
    btn.textContent = 'Satellite';
    var sat = false;
    btn.addEventListener('click', function() {
      sat = !sat;
      sat ? tabaMap.addLayer(tabaSatellite) : tabaMap.removeLayer(tabaSatellite);
      btn.textContent = sat ? 'CartoDB' : 'Satellite';
      btn.style.background = sat ? '#333' : '#fff';
      btn.style.color      = sat ? '#fff' : '';
    });
    return btn;
  };
  basemapBtn.addTo(tabaMap);

  L.circle([SITE_CENTER.lat, SITE_CENTER.lon], {
    radius: SITE_RADIUS, color: '#333', weight: 1, fillOpacity: 0, dashArray: '4 4'
  }).addTo(tabaMap);

  var plansWithPolygon = (DATA_TABA.plans || []).filter(function(p) { return p.polygon; });
  plansWithPolygon.forEach(function(plan) {
    var color = TABA_COLORS[plan.status] || '#888';
    var layer = L.geoJSON(plan.polygon, {
      style: { color: color, weight: 2, fillColor: color, fillOpacity: 0.15 },
    });
    layer.on('click', function(e) {
      L.DomEvent.stopPropagation(e);
      selectTABAPlan(plan.planNumber);
    });
    layer.addTo(tabaMap);
    tabaLayers[plan.planNumber] = layer;
  });

  // Meirim polygons — spatial context layer only; no link to TabaSearch plans
  var meirimLayers = [];
  (DATA_TABA.meirimPolygons || []).forEach(function(p) {
    if (!p.geom) return;
    var layer = L.geoJSON(p.geom, {
      style: { color: '#4a90d9', weight: 1, fillColor: '#4a90d9', fillOpacity: 0.12 },
      interactive: false,
    });
    var popupHtml = '<div style="font-size:12px;direction:rtl">';
    if (p.planNumber) popupHtml += '<div style="font-weight:700">' + p.planNumber + '</div>';
    if (p.name)       popupHtml += '<div style="color:#666;margin-top:2px">' + p.name + '</div>';
    popupHtml += '</div>';
    layer.bindPopup(popupHtml || 'תוכנית מיירים', { maxWidth: 300 });
    layer.addTo(tabaMap);
    meirimLayers.push(layer);
  });

  var allBoundLayers = Object.values(tabaLayers).concat(meirimLayers);
  if (allBoundLayers.length) {
    var group = L.featureGroup(allBoundLayers);
    tabaMap.fitBounds(group.getBounds(), { padding: [30, 30] });
  }
}

function renderTABAList(plans) {
  var container = document.getElementById('taba-plan-list');
  var meta      = document.getElementById('taba-meta');
  if (!plans || !plans.length) {
    container.innerHTML = '<div class="taba-empty">לא נמצאו תב&quot;עות</div>';
    if (meta) meta.textContent = '';
    return;
  }
  if (meta) {
    var gushNote = DATA_TABA.gush ? ' | גוש ' + DATA_TABA.gush + (DATA_TABA.chelka ? ' חלקה ' + DATA_TABA.chelka : '') : '';
    meta.textContent = plans.length + ' תכניות נמצאו' + gushNote;
  }
  var html = '';
  plans.forEach(function(plan) {
    var label    = tabaLabel(plan.status);
    var area     = plan.areaDunams ? plan.areaDunams + ' דונם' : '';
    var mavatUrl = plan.mavatUrl || ('https://mavat.iplan.gov.il/SV3?text=' + encodeURIComponent(plan.planNumber));
    html += '<div class="taba-plan-item" data-plan="' + plan.planNumber + '" onclick="selectTABAPlan(this.dataset.plan)">';
    html += '<div class="taba-plan-num">' + plan.planNumber + '</div>';
    if (plan.name) html += '<div class="taba-plan-name" title="' + plan.name + '">' + plan.name + '</div>';
    html += '<div class="taba-plan-meta">';
    html += '<span class="status-badge ' + plan.status + '">' + label + '</span>';
    if (area) html += '<span class="taba-area">' + area + '</span>';
    html += '</div>';
    html += '<div class="taba-plan-actions"><a href="' + mavatUrl + '" target="_blank" rel="noopener" ' +
      'onclick="event.stopPropagation()" ' +
      'style="font-size:10px;color:#4a90d9;text-decoration:none;direction:rtl">&#8599; פתח במקור</a></div>';
    html += '</div>';
  });
  container.innerHTML = html;
}

function showTABADetail(plan) {
  var panel = document.getElementById('taba-detail-panel');
  if (!panel) return;
  var color    = TABA_COLORS[plan.status] || '#888';
  var mavatUrl = plan.mavatUrl || ('https://mavat.iplan.gov.il/SV3?text=' + encodeURIComponent(plan.planNumber));
  var h = '<span class="taba-detail-close" onclick="closeTABADetail()">&#x2715;</span>';
  h += '<div class="taba-detail-num">' + plan.planNumber + '</div>';
  h += '<div class="taba-detail-name">' + (plan.name || plan.planNumber) + '</div>';
  h += '<div class="taba-detail-row">';
  h += '<span style="background:' + color + ';color:#fff;padding:2px 7px;border-radius:10px;font-size:9px;font-weight:700">' + tabaLabel(plan.status) + '</span>';
  if (plan.areaDunams) h += ' &nbsp;<span style="color:#999">' + plan.areaDunams + ' דונם</span>';
  h += '</div>';
  if (plan.approvalDate) h += '<div class="taba-detail-row">תאריך אישור: ' + plan.approvalDate + '</div>';
  if (plan.purposeCode)  h += '<div class="taba-detail-row">ייעוד: ' + plan.purposeCode + '</div>';
  var docs = [];
  if (plan.documents && plan.documents.main) docs.push('<a href="' + plan.documents.main + '" target="_blank">&#128196; תכנית ראשית</a>');
  if (plan.documents && plan.documents.K)    docs.push('<a href="' + plan.documents.K    + '" target="_blank">&#128506; שרטוטים (K)</a>');
  if (plan.documents && plan.documents.M)    docs.push('<a href="' + plan.documents.M    + '" target="_blank">&#128203; תקנון (M)</a>');
  if (docs.length) h += '<div class="taba-detail-docs">' + docs.join('') + '</div>';
  h += '<div class="taba-detail-mavat"><a href="' + mavatUrl + '" target="_blank" rel="noopener">&#8599; פתח במקור (מבא&quot;ת)</a></div>';
  panel.innerHTML = h;
  panel.classList.add('visible');
}

function closeTABADetail() {
  var panel = document.getElementById('taba-detail-panel');
  if (panel) { panel.classList.remove('visible'); panel.innerHTML = ''; }
  document.querySelectorAll('.taba-plan-item.selected').forEach(function(el) { el.classList.remove('selected'); });
  if (tabaMap && tabaHighlightLayer) { tabaMap.removeLayer(tabaHighlightLayer); tabaHighlightLayer = null; }
}

function selectTABAPlan(planNumber) {
  // Highlight list item
  document.querySelectorAll('.taba-plan-item.selected').forEach(function(el) { el.classList.remove('selected'); });
  var item = document.querySelector('.taba-plan-item[data-plan="' + planNumber + '"]');
  if (item) {
    item.classList.add('selected');
    item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // Show detail panel
  var plan = (DATA_TABA.plans || []).find(function(p) { return p.planNumber === planNumber; });
  if (plan) showTABADetail(plan);

  if (tabaMap) {
    // Force re-zoom on every click
    tabaMap.setView([SITE_CENTER.lat, SITE_CENTER.lon], 18, { animate: true });

    // Remove previous highlight
    if (tabaHighlightLayer) { tabaMap.removeLayer(tabaHighlightLayer); tabaHighlightLayer = null; }

    // Draw approximate-extent circle from plan area
    var rawRadius = plan && plan.areaDunams
      ? Math.sqrt(plan.areaDunams * 1000 / Math.PI)
      : 200;
    var radius = Math.min(800, Math.max(400, rawRadius));
    tabaHighlightLayer = L.circle([SITE_CENTER.lat, SITE_CENTER.lon], {
      radius: radius,
      color: '#f5a623', weight: 2.5, fillOpacity: 0, dashArray: '6 5',
    }).addTo(tabaMap);
  }
}

renderTABAList(DATA_TABA.plans || []);

document.getElementById('taba-search').addEventListener('input', function() {
  var q   = this.value.toLowerCase().trim();
  var all = DATA_TABA.plans || [];
  renderTABAList(q ? all.filter(function(p) {
    return p.planNumber.toLowerCase().includes(q) || (p.name || '').toLowerCase().includes(q);
  }) : all);
});

document.querySelector('.tab[data-panel="panel-plans"]').addEventListener('click', function() {
  if (!tabaMapInit) { initTABAMap(); tabaMapInit = true; }
  setTimeout(function() { if (tabaMap) tabaMap.invalidateSize(); }, 50);
});
<\/script>
</body>
</html>`;
}

// ---- Core analysis pipeline --------------------------------

async function runAnalysis(address, onProgress) {
  const cb = typeof onProgress === "function" ? onProgress : null;

  if (cb) cb({ step: "geocoding", label: "Locating address", percent: 5 });
  const center = await geocode(address);

  const radius   = CONFIG.radius_meters;
  const slug     = address.toLowerCase().replace(/[\s,]+/g, "-").replace(/-+/g, "-");
  const outDir   = path.resolve(CONFIG.output_dir  ?? "./output");
  const cacheDir = path.resolve(path.join(CONFIG.cache_dir ?? "./cache", slug));
  fs.mkdirSync(outDir,   { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  log("info", `Output dir: ${outDir}`);
  log("info", `Cache dir:  ${cacheDir}`);

  // Buildings — GovMap (with Tel Aviv GIS fallback)
  if (cb) cb({ step: "buildings", label: "Fetching buildings", percent: 15 });
  const buildings = await fetchGovMapBuildings(center.lat, center.lon, radius);

  // Trees — Tel Aviv Open Data (gisn.tel-aviv.gov.il)
  if (cb) cb({ step: "trees", label: "Fetching trees", percent: 25 });
  const trees = await fetchTelAvivTrees(center.lat, center.lon, radius);

  // Streets + transit + institutions — OSM combined query
  if (cb) cb({ step: "streets", label: "Fetching streets & transit", percent: 35 });
  const osmQuery = buildCombinedOverpassQuery(center.lat, center.lon, radius);
  const osmRaw   = await fetchOverpass(osmQuery);
  const { streets, transit, institutions } = parseAllOSMData(osmRaw);

  // Registration blocks — Tel Aviv GIS
  if (cb) cb({ step: "registration", label: "Fetching registration blocks", percent: 42 });
  const registrationBlocks = await fetchRegistrationBlocks(center.lat, center.lon, radius);

  const layers = { buildings, streets, trees, registrationBlocks, transit, institutions };

  // Run elevation, CBS, and TABA in parallel (TABA emits its own sub-step progress)
  if (cb) cb({ step: "elevation_cbs", label: "Elevation & demographics", percent: 50 });
  const [elevation, cbsData, tabaData] = await Promise.all([
    fetchElevation(center.lat, center.lon),
    fetchCBSData(center.lat, center.lon).catch(e => {
      log("warn", `CBS data fetch failed: ${e.message}`);
      return null;
    }),
    fetchTABAData(center.lat, center.lon, slug, cacheDir, outDir, cb).catch(e => {
      log("warn", `TABA data fetch failed: ${e.message}`);
      return { gush: null, chelka: null, plans: [], stats: { totalPlans: 0, withDocuments: 0, failedDownloads: 0 } };
    }),
  ]);

  if (tabaData) {
    log("ok", `TABA summary: ${tabaData.stats.totalPlans} plans, ${tabaData.stats.withDocuments} with documents, ${tabaData.stats.failedDownloads} failed downloads`);
  }

  if (cb) cb({ step: "compiling", label: "Compiling dashboard", percent: 95 });
  const runConfig = { ...CONFIG, address };
  const html = buildHTML(runConfig, center, layers, elevation, cbsData, tabaData);

  const data = {
    site_center: center,
    site_radius: radius,
    address,
    elevation: elevation ?? null,
    buildings,
    streets,
    trees,
    institutions,
    registration: registrationBlocks,
    transit: {
      lightrail: transit.lightRail,
      train:     transit.train,
    },
    demographics: cbsData  ?? null,
    taba:         tabaData ?? null,
  };

  if (cb) cb({ step: "done", label: "Done", percent: 100 });
  return { html, data };
}

module.exports = { runAnalysis };

// ---- CLI entry point ---------------------------------------

if (require.main === module) {
  // Read address override from config.json if present
  try {
    const _cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
    if (_cfg.address) CONFIG.address = _cfg.address;
  } catch (_) {}

  (async () => {
    console.log("\n╔══════════════════════════════════════╗");
    console.log("║        CONTEXT MAPPER  v1.0          ║");
    console.log("╚══════════════════════════════════════╝\n");

    try {
      const { html } = await runAnalysis(CONFIG.address);

      const outDir  = path.resolve(CONFIG.output_dir ?? "./output");
      const outPath = path.join(outDir, CONFIG.output_filename);
      log("info", `Writing HTML to: ${outPath}`);
      fs.writeFileSync(outPath, html, "utf8");

      const sizeKB = (fs.statSync(outPath).size / 1024).toFixed(1);
      log("ok", `Done! Output: ${outPath} (${sizeKB} KB)`);
      console.log(`\n  Open in browser: file://${outPath}\n`);
    } catch (err) {
      log("err", err.message);
      if (process.env.DEBUG) console.error(err.stack);
      process.exit(1);
    }
  })();
}
