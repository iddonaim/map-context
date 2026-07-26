// ADDRESS LAUNCHER — select address, then run analysis

const express = require("express");
const path    = require("path");
const axios           = require("axios");
const fs              = require("fs");
const { runAnalysis, fetchCBSData, TABA_DOCS_DIR } = require("./index");
const { buildAtlas }  = require("./atlas");
const { parseSiteParams } = require("./lib/siteParams");
const { analyzePlan, withGovernsSitePoint } = require("./lib/tabaAnalysis");
const { ensurePlanDoc } = require("./lib/tabaDocs");

const PORT = process.env.PORT || 3111;

const app = express();
app.use(express.json());

// Plan documents — the dashboard's document links (/taba-docs/<plan>/<file>)
// resolve here. Already-downloaded files are served statically; a miss falls
// through to the on-demand downloader, which fetches the file from the
// source recorded during the run, caches it, then serves it.
app.use("/taba-docs", express.static(TABA_DOCS_DIR));

app.get("/taba-docs/:safe/:file", async (req, res) => {
  try {
    const localPath = await ensurePlanDoc(req.params.safe, req.params.file);
    if (!localPath) return res.status(404).send("document unavailable");
    res.sendFile(localPath);
  } catch (err) {
    res.status(500).send("document fetch failed");
  }
});

// ---- Endpoint: deferred CBS demographics ---------------------
// The web dashboard ships before demographics resolve and fetches them
// here (the data payload's demographicsUrl points here too). fetchCBSData
// keeps its own per-coordinate disk cache, so repeats are instant.

const cbsRuns = new Map(); // in-flight dedupe by rounded coordinate

app.get("/cbs-data", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 29 || lat > 34 || lon < 33.5 || lon > 36) {
    return res.status(400).json({ error: "valid lat/lon required" });
  }
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  try {
    if (!cbsRuns.has(key)) {
      cbsRuns.set(key, fetchCBSData(lat, lon).finally(() => cbsRuns.delete(key)));
    }
    res.json(await cbsRuns.get(key));
  } catch (err) {
    res.status(500).json({ error: err.message || "CBS fetch failed" });
  }
});

// ---- Endpoint: Nominatim reverse proxy (pin-drop → address) --

app.get("/reverse", async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: "lat/lon required" });
  }
  try {
    const response = await axios.get("https://nominatim.openstreetmap.org/reverse", {
      params: { lat, lon, format: "json", zoom: 18, "accept-language": "he,en" },
      headers: { "User-Agent": "map-context/1.0 (contact@cuboidstudio.com)" },
      timeout: 8000,
    });
    res.json(response.data);
  } catch (err) {
    res.status(502).json({ error: "reverse geocode failed" });
  }
});

// ---- Endpoint: per-plan document analysis (lazy) -------------
// Parses the plan's downloaded documents (mmg.zip shapefiles, takanon PDF)
// into structured land-use + rights data. Deliberately NOT part of
// runAnalysis: first request parses and caches (plan facts are
// address-independent), later requests are instant. ?lat&lon adds a
// computed governsSitePoint for that site point.

const analysisRuns = new Map(); // in-flight dedupe, keyed by plan number

app.get("/taba-analysis/:plan", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const plan = String(req.params.plan || "").trim().slice(0, 80);
  if (!plan) return res.status(400).json({ error: "plan number required" });

  try {
    if (!analysisRuns.has(plan)) {
      analysisRuns.set(plan, analyzePlan(plan).finally(() => analysisRuns.delete(plan)));
    }
    const record = await analysisRuns.get(plan);
    const lat = parseFloat(req.query.lat);
    const lon = parseFloat(req.query.lon);
    res.json(withGovernsSitePoint(record, lat, lon));
  } catch (err) {
    res.status(500).json({ error: err.message || "analysis failed" });
  }
});

// ---- Endpoint: run analysis as a service --------------------

app.post("/analyze", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  const { address, lat, lon, radius } = req.body || {};
  if (!address || typeof address !== "string" || !address.trim()) {
    return res.status(400).json({ error: "address is required" });
  }

  try {
    // When the client supplies valid in-bounds coordinates, use them as the
    // analysis center instead of re-geocoding the address string (a geocoder
    // round-trip can resolve a picked suggestion to a different point).
    const site = parseSiteParams({ lat, lon, address, r: radius });
    const result = await runAnalysis(address.trim(), null, {
      center: site ? { lat: site.lat, lon: site.lon } : null,
      radius: site ? site.radius : radius,
    });
    res.json(result);
  } catch (err) {
    const isGeocode = err.message && err.message.startsWith("No geocoding result");
    const status = isGeocode ? 422 : 500;
    res.status(status).json({ error: err.message || "Analysis failed" });
  }
});

app.options("/analyze", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.sendStatus(204);
});

// ---- Endpoint: Nominatim proxy (avoids browser CORS/UA issues) -------

app.get("/search", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.json([]);
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5&countrycodes=il`;
  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent":      "map-context/1.0 (contact@cuboidstudio.com)",
        "Accept-Language": "he,en",
      },
      timeout: 8000,
    });
    res.json(response.data);
  } catch (err) {
    res.status(502).json({ error: "geocode lookup failed" });
  }
});

// ---- Endpoint: run analysis, stream progress via SSE --------

app.post("/run", async (req, res) => {
  const { address, lat, lon, radius } = req.body;
  if (!address) {
    res.setHeader("Content-Type", "application/json");
    return res.status(400).json({ status: "error", message: "address required" });
  }

  // Honor client-picked coordinates and radius when valid (see /analyze).
  const site = parseSiteParams({ lat, lon, address, r: radius });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const sendEvent = (type, data) => {
    if (type === "progress") {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } else {
      res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };

  try {
    // deferCbs: the dashboard ships as soon as the fast layers resolve;
    // demographics stream in afterwards via /cbs-data.
    const result = await runAnalysis(address.trim(), (progress) => {
      sendEvent("progress", progress);
    }, {
      center: site ? { lat: site.lat, lon: site.lon } : null,
      radius: site ? site.radius : radius,
      deferCbs: true,
    });
    // Embed SITE_DATA as a JSON constant and fire postMessage when the dashboard iframe loads.
    // </script> inside JSON values is escaped to <\/script> so the HTML parser won't close the tag early.
    const safeJson = JSON.stringify(result.data).replace(/<\/script>/gi, '<\\/script>');
    const pmScript = '<script>(function(){var SITE_DATA=' + safeJson + ';window.parent.postMessage({type:"analysis-complete",data:SITE_DATA},"*");})();<\/script>';
    const html = result.html.replace('</body>', pmScript + '</body>');
    sendEvent("complete", { html });
    res.end();
  } catch (err) {
    sendEvent("error", { message: err.message || "Analysis failed" });
    res.end();
  }
});

// ---- Endpoint: 3D Atlas ---------------------------------------
// Without parameters: the city-wide Tel Aviv atlas. With
// ?lat=..&lon=..&r=..&label=.. : an atlas centered on an analyzed
// site (used by the dashboard's 3D view). Generates on first
// request (downloads OSM data once, then cached on disk).
// ?rebuild=1 forces a fresh build, ?mock=1 uses the offline
// procedural test city.

const atlasBuilds = new Map(); // per-site in-flight build promises

app.get("/atlas", async (req, res) => {
  const mock  = req.query.mock === "1";
  const force = req.query.rebuild === "1" || mock;

  let site = null;
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    if (lat < 29 || lat > 34 || lon < 33.5 || lon > 36) {
      return res.status(400).send("lat/lon outside supported bounds");
    }
    const radius = Math.min(Math.max(parseInt(req.query.r, 10) || 400, 100), 3000);
    const label  = String(req.query.label || "").slice(0, 160) || null;
    site = { lat, lon, radius, label };
  }

  const key = mock ? "mock" : site ? `${lat.toFixed(4)},${lon.toFixed(4)},${site.radius}` : "default";
  try {
    if (!atlasBuilds.has(key)) {
      atlasBuilds.set(key, buildAtlas({ mock, force, site }).finally(() => atlasBuilds.delete(key)));
    }
    const result = await atlasBuilds.get(key);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(result.html);
  } catch (err) {
    const retryQS = new URLSearchParams({ ...req.query, rebuild: "1" }).toString();
    res.status(500).setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<body style="font-family:sans-serif;background:#0b0e14;color:#e8eaf0;display:flex;align-items:center;justify-content:center;height:100vh"><div><h2>Atlas build failed</h2><p>${(err.message || "unknown error").replace(/</g, "&lt;")}</p><p><a style="color:#f0b429" href="/atlas?${retryQS}">Try again</a></p></div></body>`);
  }
});

// Serve three.js from node_modules so the atlas page works without a CDN
app.get("/vendor/three.module.js", (_req, res) => {
  const p = path.join(__dirname, "node_modules", "three", "build", "three.module.js");
  if (!fs.existsSync(p)) return res.status(404).send("three.js not installed — run npm install");
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.send(fs.readFileSync(p, "utf8"));
});

// ---- Main page -----------------------------------------------
// Without query params: the address picker. With valid
// ?lat=..&lon=..&address=..&r=.. (same validation as /atlas): the page
// boots straight into the analysis for that site — used by embedding apps
// (Cuboid Studio's Analysis tab) to restore a previously analyzed site.
// Invalid or out-of-bounds params fall back to the plain picker.

app.get("/", (req, res) => {
  const site = parseSiteParams(req.query);
  // JSON is embedded inside a <script>; escape "<" so an address containing
  // "</script>" can't break out of the tag.
  const bootJson = JSON.stringify(site).replace(/</g, "\\u003c");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(HTML.replace("__BOOT_SITE__", bootJson));
});

// ---- Start ---------------------------------------------------
// Only listen (and pop a browser) when run directly — `npm start` /
// Railway. Tests require this file to get the app without side effects.

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n╔══════════════════════════════════════╗`);
    console.log(`║     CONTEXT MAPPER — Address Picker  ║`);
    console.log(`╚══════════════════════════════════════╝`);
    console.log(`\n  http://localhost:${PORT}\n`);
    import("open").then(m => m.default(`http://localhost:${PORT}`)).catch(() => {});
  });
}

module.exports = { app };

// ---- HTML ----------------------------------------------------

const HTML = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Context Mapper — בחירת כתובת</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #f4f4f0;
    min-height: 100vh;
  }
  /* Map-first: the map IS the page; the search card floats above it. */
  #pin-map {
    position: fixed;
    inset: 0;
    z-index: 1;
    cursor: crosshair;
  }
  .card {
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 1000;
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 4px 24px rgba(0,0,0,.18);
    padding: 24px 28px;
    width: 380px;
    max-width: calc(100vw - 40px);
    max-height: calc(100vh - 40px);
    overflow: visible;
  }
  h1 { font-size: 20px; font-weight: 700; letter-spacing: .04em; color: #111; margin-bottom: 4px; }
  .subtitle { font-size: 13px; color: #888; margin-bottom: 32px; }
  label { display: block; font-size: 12px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: #555; margin-bottom: 8px; }
  .input-wrap { position: relative; }
  input[type=text] {
    width: 100%;
    padding: 12px 16px;
    font-size: 15px;
    border: 1.5px solid #ddd;
    border-radius: 8px;
    outline: none;
    transition: border-color .15s;
    background: #fafafa;
    direction: ltr;
    text-align: left;
  }
  input[type=text]:focus { border-color: #333; background: #fff; }
  .dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0; right: 0;
    background: #fff;
    border: 1.5px solid #ddd;
    border-radius: 8px;
    box-shadow: 0 6px 20px rgba(0,0,0,.12);
    z-index: 100;
    overflow: hidden;
    display: none;
  }
  .dropdown.open { display: block; }
  .dropdown-item {
    padding: 12px 16px;
    font-size: 14px;
    color: #222;
    cursor: pointer;
    border-bottom: 1px solid #f0f0f0;
    direction: ltr;
    text-align: left;
    transition: background .1s;
  }
  .dropdown-item:last-child { border-bottom: none; }
  .dropdown-item:hover { background: #f5f5f5; }
  .spinner {
    position: absolute;
    top: 50%; right: 14px;
    transform: translateY(-50%);
    width: 16px; height: 16px;
    border: 2px solid #ddd;
    border-top-color: #555;
    border-radius: 50%;
    animation: spin .7s linear infinite;
    display: none;
  }
  .spinner.active { display: block; }
  @keyframes spin { to { transform: translateY(-50%) rotate(360deg); } }

  .pin-hint { font-size: 11px; color: #999; margin-top: 10px; }
  .locate-btn {
    background: #fff;
    border: 2px solid rgba(0,0,0,.2);
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 12px;
    font-weight: 600;
    color: #333;
    cursor: pointer;
    user-select: none;
    direction: rtl;
    white-space: nowrap;
    box-shadow: 0 1px 4px rgba(0,0,0,.15);
  }
  .locate-btn:hover { background: #f4f4f4; }

  .progress-wrap {
    margin-top: 20px;
    display: none;
  }
  .progress-wrap.show { display: block; }
  .stop-btn {
    padding: 4px 12px;
    background: #fff;
    border: 1px solid #ccc;
    border-radius: 6px;
    font-size: 12px;
    color: #888;
    cursor: pointer;
    transition: color .15s, border-color .15s;
  }
  .stop-btn:hover { color: #b91c1c; border-color: #fca5a5; }
  .progress-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
  }
  .progress-step-label {
    font-size: 13px;
    color: #555;
  }
  .progress-pct {
    font-size: 13px;
    font-weight: 600;
    color: #111;
  }
  .progress-track {
    height: 6px;
    background: #e8e8e8;
    border-radius: 3px;
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    background: #111;
    border-radius: 3px;
    width: 0%;
    transition: width 0.35s ease;
  }
  .error-msg {
    margin-top: 16px;
    display: none;
    padding: 12px 14px;
    background: #fff5f5;
    border: 1px solid #fca5a5;
    border-radius: 8px;
    font-size: 13px;
    color: #b91c1c;
  }
  .error-msg.show { display: block; }
  .retry-btn {
    display: inline-block;
    margin-top: 10px;
    padding: 8px 16px;
    background: #111;
    color: #fff;
    border: none;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background .15s;
  }
  .retry-btn:hover { background: #333; }

  .confirm-card {
    margin-top: 24px;
    padding: 20px 20px;
    background: #f8f9ff;
    border: 1.5px solid #d0d8ff;
    border-radius: 8px;
    display: none;
  }
  .confirm-card.show { display: block; }
  .confirm-address { font-size: 14px; color: #222; direction: ltr; text-align: left; margin-bottom: 8px; word-break: break-word; }
  .confirm-cadastral { font-size: 13px; color: #555; font-weight: 600; }
  .confirm-cadastral .badge {
    display: inline-block;
    background: #e8edff;
    color: #3344aa;
    border-radius: 4px;
    padding: 2px 8px;
    margin-left: 6px;
    font-size: 12px;
  }
  .confirm-missing { font-size: 12px; color: #e08000; }

  button#run-btn {
    margin-top: 20px;
    width: 100%;
    padding: 14px;
    background: #111;
    color: #fff;
    border: none;
    border-radius: 8px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    letter-spacing: .02em;
    transition: background .15s;
    display: none;
  }
  button#run-btn:hover { background: #333; }
  button#run-btn.show { display: block; }
  button#run-btn:disabled { background: #aaa; cursor: default; }
</style>
</head>
<body>
<div id="pin-map"></div>
<div class="card">
  <h1>Context Mapper</h1>
  <p class="subtitle">חפש כתובת או לחץ על המפה כדי להתחיל בניתוח</p>

  <label for="addr-input">כתובת</label>
  <div class="input-wrap">
    <input type="text" id="addr-input" placeholder="e.g. Rothschild Blvd 1, Tel Aviv" autocomplete="off">
    <div class="spinner" id="spinner"></div>
    <div class="dropdown" id="dropdown"></div>
  </div>
  <div class="pin-hint">לחיצה על המפה בוחרת את נקודת הניתוח</div>

  <div class="confirm-card" id="confirm-card">
    <div class="confirm-address" id="confirm-address"></div>
    <div id="confirm-cadastral"></div>
  </div>

  <button id="run-btn">הפעל ניתוח</button>

  <div class="progress-wrap" id="progress-wrap">
    <div class="progress-header">
      <span class="progress-step-label" id="progress-label">מתחיל...</span>
      <span>
        <span class="progress-pct" id="progress-pct">0%</span>
        <button class="stop-btn" id="stop-btn" style="margin-right:10px">עצור</button>
      </span>
    </div>
    <div class="progress-track">
      <div class="progress-fill" id="progress-fill"></div>
    </div>
  </div>

  <div class="error-msg" id="error-msg">
    <span id="error-text"></span>
    <br>
    <button class="retry-btn" id="retry-btn">נסה שנית</button>
  </div>

</div>

<script>
// Injected by the server: {lat, lon, radius, address} when the page was
// opened with valid site query params, null for the plain picker.
var BOOT_SITE = __BOOT_SITE__;

(function () {
  // Relay "analysis-complete" upward. The dashboard lives in a nested srcdoc
  // iframe, so its window.parent is THIS page — without this relay the message
  // never reaches an embedding app (e.g. Cuboid Studio's Map tab). Only this
  // one known message type is forwarded, and only from our own dashboard
  // iframe (srcdoc inherits this page's origin). The payload is public map
  // analysis data; '*' matches the dashboard's own targetOrigin.
  window.addEventListener('message', function (ev) {
    if (window.parent === window) return;
    if (ev.origin !== window.location.origin) return;
    if (!ev.data || ev.data.type !== 'analysis-complete') return;
    window.parent.postMessage(ev.data, '*');
  });

  var input        = document.getElementById('addr-input');
  var dropdown     = document.getElementById('dropdown');
  var spinner      = document.getElementById('spinner');
  var confirmCard  = document.getElementById('confirm-card');
  var confirmAddr  = document.getElementById('confirm-address');
  var confirmCad   = document.getElementById('confirm-cadastral');
  var runBtn       = document.getElementById('run-btn');
  var progressWrap = document.getElementById('progress-wrap');
  var progressLabel= document.getElementById('progress-label');
  var progressPct  = document.getElementById('progress-pct');
  var progressFill = document.getElementById('progress-fill');
  var errorMsg     = document.getElementById('error-msg');
  var errorText    = document.getElementById('error-text');
  var retryBtn     = document.getElementById('retry-btn');

  var stopBtn         = document.getElementById('stop-btn');

  var debounceTimer   = null;
  var selectedAddress = null;
  var selectedLat     = null;
  var selectedLon     = null;
  var selectedRadius  = null;
  var runAbort        = null;

  function showConfirm() {
    confirmAddr.textContent = selectedAddress;
    confirmCad.innerHTML =
      '<span style="color:#888;font-size:12px">' +
      selectedLat.toFixed(6) + ', ' + selectedLon.toFixed(6) +
      '</span>';
    confirmCard.classList.add('show');
    runBtn.classList.add('show');
  }

  // ---- Pin-drop map (alternative to address search) --------

  var pinMarker = null;
  var pinMap = L.map('pin-map').setView(
    BOOT_SITE ? [BOOT_SITE.lat, BOOT_SITE.lon] : [32.07, 34.78], 13);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO', maxZoom: 20,
  }).addTo(pinMap);

  function setPin(lat, lon) {
    if (pinMarker) pinMap.removeLayer(pinMarker);
    pinMarker = L.marker([lat, lon]).addTo(pinMap);
  }

  // Select a point as the analysis site (map click / my-location).
  function selectPoint(lat, lon) {
    setPin(lat, lon);
    selectedLat = lat;
    selectedLon = lon;
    selectedAddress = lat.toFixed(5) + ', ' + lon.toFixed(5);
    input.value = selectedAddress;
    closeDropdown();
    showConfirm();
    // Enrich with a reverse-geocoded address; coordinates already work.
    fetch('/reverse?lat=' + lat + '&lon=' + lon)
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.display_name) {
          selectedAddress = d.display_name;
          input.value = selectedAddress;
          showConfirm();
        }
      })
      .catch(function () {});
  }

  pinMap.on('click', function (ev) {
    selectPoint(ev.latlng.lat, ev.latlng.lng);
  });

  // ---- "My location" control -------------------------------
  // Browser geolocation (needs HTTPS or localhost, and user permission;
  // inside an embedding iframe the iframe also needs allow="geolocation").

  var locateControl = L.control({ position: 'topleft' });
  locateControl.onAdd = function () {
    var btn = L.DomUtil.create('div', 'locate-btn');
    btn.innerHTML = '&#9678; המיקום שלי';
    btn.title = 'מרכז את המפה על מיקומך';
    L.DomEvent.disableClickPropagation(btn);
    btn.addEventListener('click', function () {
      if (!navigator.geolocation) {
        btn.innerHTML = 'אין תמיכה במיקום';
        return;
      }
      btn.innerHTML = '&#9678; מאתר...';
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          btn.innerHTML = '&#9678; המיקום שלי';
          var lat = pos.coords.latitude, lon = pos.coords.longitude;
          // Outside the supported Israel bounds — center but don't select.
          if (lat < 29 || lat > 34 || lon < 33.5 || lon > 36) {
            btn.innerHTML = 'המיקום מחוץ לישראל';
            pinMap.setView([lat, lon], 10);
            return;
          }
          pinMap.setView([lat, lon], 16);
          selectPoint(lat, lon);
        },
        function () {
          btn.innerHTML = 'איתור מיקום נכשל';
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
    return btn;
  };
  locateControl.addTo(pinMap);

  // ---- Autocomplete ----------------------------------------

  input.addEventListener('input', function () {
    clearTimeout(debounceTimer);
    var q = input.value.trim();
    if (q.length < 3) { closeDropdown(); return; }
    debounceTimer = setTimeout(function () { queryNominatim(q); }, 500);
  });

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeDropdown();
  });

  document.addEventListener('click', function (e) {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) closeDropdown();
  });

  function queryNominatim(q) {
    spinner.classList.add('active');
    var url = '/search?q=' + encodeURIComponent(q);
    fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (results) {
        spinner.classList.remove('active');
        renderDropdown(Array.isArray(results) ? results : []);
      })
      .catch(function () {
        spinner.classList.remove('active');
        closeDropdown();
      });
  }

  function renderDropdown(results) {
    dropdown.innerHTML = '';
    if (!results.length) { closeDropdown(); return; }
    results.forEach(function (r) {
      var item = document.createElement('div');
      item.className = 'dropdown-item';
      item.textContent = r.display_name;
      item.addEventListener('click', function () { selectResult(r); });
      dropdown.appendChild(item);
    });
    dropdown.classList.add('open');
  }

  function closeDropdown() {
    dropdown.classList.remove('open');
    dropdown.innerHTML = '';
  }

  // ---- Selection → confirm card ----------------------------

  function selectResult(r) {
    selectedAddress = r.display_name;
    selectedLat     = parseFloat(r.lat);
    selectedLon     = parseFloat(r.lon);

    input.value = selectedAddress;
    closeDropdown();
    setPin(selectedLat, selectedLon);
    pinMap.setView([selectedLat, selectedLon], 15);
    showConfirm();
  }

  // ---- Progress helpers ------------------------------------

  function setProgress(label, pct) {
    progressLabel.textContent = label;
    progressPct.textContent   = pct + '%';
    progressFill.style.width  = pct + '%';
  }

  function showError(message) {
    progressWrap.classList.remove('show');
    errorText.textContent = 'שגיאה: ' + (message || 'ניתוח נכשל');
    errorMsg.classList.add('show');
    runBtn.disabled = false;
  }

  function showDashboard(html) {
    var backBtn = document.createElement('button');
    backBtn.textContent = '← ניתוח חדש';
    backBtn.style.cssText = [
      'position:fixed', 'top:12px', 'left:12px', 'z-index:9999',
      'padding:8px 14px', 'background:#111', 'color:#fff',
      'border:none', 'border-radius:6px', 'font-size:13px',
      'font-weight:600', 'cursor:pointer', 'box-shadow:0 2px 8px rgba(0,0,0,.3)',
      'transition:background .15s',
    ].join(';');
    backBtn.addEventListener('mouseover',  function () { backBtn.style.background = '#333'; });
    backBtn.addEventListener('mouseout',   function () { backBtn.style.background = '#111'; });
    // Navigate to a clean "/" — never reload. When the page was booted via
    // query params, a reload would re-trigger the auto-run instead of
    // returning to the picker.
    backBtn.addEventListener('click', function () { window.location.href = '/'; });

    var frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;border:none;z-index:9998';
    frame.srcdoc = html;

    document.body.innerHTML = '';
    document.body.style.margin = '0';
    document.body.appendChild(frame);
    document.body.appendChild(backBtn);
  }

  // ---- Run Analysis via SSE --------------------------------

  retryBtn.addEventListener('click', function () {
    errorMsg.classList.remove('show');
    runAnalysis();
  });

  runBtn.addEventListener('click', function () {
    if (!selectedAddress) return;
    runAnalysis();
  });

  function resetRunUI() {
    progressWrap.classList.remove('show');
    runBtn.disabled = false;
    runAbort = null;
  }

  stopBtn.addEventListener('click', function () {
    if (runAbort) runAbort.abort();
  });

  function runAnalysis() {
    runBtn.disabled = true;
    errorMsg.classList.remove('show');
    setProgress('מתחיל...', 0);
    progressWrap.classList.add('show');
    runAbort = new AbortController();

    fetch('/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: selectedAddress, lat: selectedLat, lon: selectedLon, radius: selectedRadius }),
      signal: runAbort.signal,
    }).then(function (response) {
      if (!response.ok || !response.body) {
        return response.json().then(function (d) {
          throw new Error(d.message || 'Analysis failed');
        });
      }

      var reader  = response.body.getReader();
      var decoder = new TextDecoder();
      var buffer  = '';

      function pump() {
        return reader.read().then(function (chunk) {
          if (chunk.done) return;
          buffer += decoder.decode(chunk.value, { stream: true });

          // Split on double newline (SSE event boundary)
          var events = buffer.split('\\n\\n');
          buffer = events.pop(); // keep incomplete tail

          events.forEach(function (eventStr) {
            if (!eventStr.trim()) return;
            var eventType = 'progress';
            var dataStr   = '';
            eventStr.split('\\n').forEach(function (line) {
              if (line.startsWith('event: ')) eventType = line.slice(7).trim();
              if (line.startsWith('data: '))  dataStr   = line.slice(6).trim();
            });
            if (!dataStr) return;

            var data;
            try { data = JSON.parse(dataStr); } catch (_) { return; }

            if (eventType === 'progress') {
              setProgress(data.label, data.percent);
            } else if (eventType === 'complete') {
              setProgress('בוצע', 100);
              showDashboard(data.html);
            } else if (eventType === 'error') {
              showError(data.message);
            }
          });

          return pump();
        });
      }

      return pump();
    }).catch(function (err) {
      // User pressed עצור — quietly return to the picker, no error banner.
      if (err && err.name === 'AbortError') { resetRunUI(); return; }
      showError(err.message || 'שגיאת תקשורת');
    });
  }

  // ---- Param boot ------------------------------------------
  // When the server injected a site (valid ?lat&lon&address&r), skip the
  // picker and start the analysis immediately with the same SSE progress
  // UI. The resulting dashboard fires the analysis-complete postMessage
  // exactly like a manual run, so an embedding app stays in sync.

  if (BOOT_SITE) {
    selectedAddress = BOOT_SITE.address;
    selectedLat     = BOOT_SITE.lat;
    selectedLon     = BOOT_SITE.lon;
    selectedRadius  = BOOT_SITE.radius;

    setPin(selectedLat, selectedLon);
    pinMap.setView([selectedLat, selectedLon], 15);
    input.value = selectedAddress;
    confirmAddr.textContent = selectedAddress;
    confirmCad.innerHTML =
      '<span style="color:#888;font-size:12px">' +
      selectedLat.toFixed(6) + ', ' + selectedLon.toFixed(6) +
      '</span>';
    confirmCard.classList.add('show');
    runAnalysis();
  }
})();
</script>
</body>
</html>`;
