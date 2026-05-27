// ADDRESS LAUNCHER — select address, then run analysis

const express = require("express");
const fs      = require("fs");
const path    = require("path");
const { spawn, exec } = require("child_process");
const { runAnalysis } = require("./index");

const PORT = 3111;

const app = express();
app.use(express.json());

// ---- Endpoint: run analysis as a service --------------------

app.post("/analyze", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  const { address } = req.body || {};
  if (!address || typeof address !== "string" || !address.trim()) {
    return res.status(400).json({ error: "address is required" });
  }

  try {
    const result = await runAnalysis(address.trim());
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

// ---- Endpoint: write config.json and shut down ---------------

app.post("/run", (req, res) => {
  const { address } = req.body;
  if (!address) return res.status(400).json({ error: "address required" });
  fs.writeFileSync(
    path.join(__dirname, "config.json"),
    JSON.stringify({ address }, null, 2),
    "utf8"
  );
  res.json({ status: "started" });
  setTimeout(() => {
    const child = spawn("node", ["index.js"], {
      stdio: "inherit",
      cwd: __dirname,
      detached: true,
    });
    child.on("close", (code) => {
      if (code === 0) exec(`open "${path.join(__dirname, "output/site_analysis.html")}"`);
    });
    child.unref();
  }, 100);
});

// ---- Main page -----------------------------------------------

app.get("/", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(HTML);
});

// ---- Start ---------------------------------------------------

const server = app.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║     CONTEXT MAPPER — Address Picker  ║`);
  console.log(`╚══════════════════════════════════════╝`);
  console.log(`\n  http://localhost:${PORT}\n`);
  import("open").then(m => m.default(`http://localhost:${PORT}`)).catch(() => {});
});

// ---- HTML ----------------------------------------------------

const HTML = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Context Mapper — בחירת כתובת</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #f4f4f0;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 24px;
  }
  .card {
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 4px 24px rgba(0,0,0,.1);
    padding: 40px 48px;
    width: 100%;
    max-width: 560px;
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

  .status-msg {
    margin-top: 16px;
    display: none;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    color: #555;
  }
  .status-msg.show { display: flex; }
  .pulse-dot {
    width: 10px; height: 10px;
    border-radius: 50%;
    background: #4a90d9;
    flex-shrink: 0;
    animation: pulse 1.4s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50%       { opacity: .4; transform: scale(.7); }
  }
</style>
</head>
<body>
<div class="card">
  <h1>Context Mapper</h1>
  <p class="subtitle">חפש כתובת כדי להתחיל בניתוח</p>

  <label for="addr-input">כתובת</label>
  <div class="input-wrap">
    <input type="text" id="addr-input" placeholder="e.g. Rothschild Blvd 1, Tel Aviv" autocomplete="off">
    <div class="spinner" id="spinner"></div>
    <div class="dropdown" id="dropdown"></div>
  </div>

  <div class="confirm-card" id="confirm-card">
    <div class="confirm-address" id="confirm-address"></div>
    <div id="confirm-cadastral"></div>
  </div>

  <button id="run-btn">הפעל ניתוח</button>
  <div class="status-msg" id="status-msg">
    <div class="pulse-dot"></div>
    <span>מריץ ניתוח... זה יכול לקחת מספר דקות</span>
  </div>
</div>

<script>
(function () {
  var input       = document.getElementById('addr-input');
  var dropdown    = document.getElementById('dropdown');
  var spinner     = document.getElementById('spinner');
  var confirmCard = document.getElementById('confirm-card');
  var confirmAddr = document.getElementById('confirm-address');
  var confirmCad  = document.getElementById('confirm-cadastral');
  var runBtn      = document.getElementById('run-btn');
  var statusMsg   = document.getElementById('status-msg');

  var debounceTimer = null;
  var selectedAddress = null;
  var selectedLat     = null;
  var selectedLon     = null;

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
    var url = 'https://nominatim.openstreetmap.org/search?q=' +
      encodeURIComponent(q) + '&format=json&limit=5&countrycodes=il';
    fetch(url, { headers: { 'Accept-Language': 'he,en' } })
      .then(function (r) { return r.json(); })
      .then(function (results) {
        spinner.classList.remove('active');
        renderDropdown(results);
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

    confirmAddr.textContent = selectedAddress;
    confirmCad.innerHTML =
      '<span style="color:#888;font-size:12px">' +
      selectedLat.toFixed(6) + ', ' + selectedLon.toFixed(6) +
      '</span>';
    confirmCard.classList.add('show');
    runBtn.classList.add('show');
  }

  // ---- Run Analysis -----------------------------------------

  runBtn.addEventListener('click', function () {
    if (!selectedAddress) return;
    runBtn.disabled = true;
    statusMsg.classList.add('show');
    fetch('/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: selectedAddress, lat: selectedLat, lon: selectedLon }),
    }).catch(function () {});
  });
})();
</script>
</body>
</html>`;
