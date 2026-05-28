// ADDRESS LAUNCHER — select address, then run analysis

const express = require("express");
const path    = require("path");
const axios           = require("axios");
const { runAnalysis } = require("./index");

const PORT = process.env.PORT || 3111;

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
  const { address } = req.body;
  if (!address) {
    res.setHeader("Content-Type", "application/json");
    return res.status(400).json({ status: "error", message: "address required" });
  }

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
    const result = await runAnalysis(address.trim(), (progress) => {
      sendEvent("progress", progress);
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

  .progress-wrap {
    margin-top: 20px;
    display: none;
  }
  .progress-wrap.show { display: block; }
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

  <div class="progress-wrap" id="progress-wrap">
    <div class="progress-header">
      <span class="progress-step-label" id="progress-label">מתחיל...</span>
      <span class="progress-pct" id="progress-pct">0%</span>
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
(function () {
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

  var debounceTimer   = null;
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

    confirmAddr.textContent = selectedAddress;
    confirmCad.innerHTML =
      '<span style="color:#888;font-size:12px">' +
      selectedLat.toFixed(6) + ', ' + selectedLon.toFixed(6) +
      '</span>';
    confirmCard.classList.add('show');
    runBtn.classList.add('show');
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
    backBtn.addEventListener('click', function () { window.location.reload(); });

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

  function runAnalysis() {
    runBtn.disabled = true;
    errorMsg.classList.remove('show');
    setProgress('מתחיל...', 0);
    progressWrap.classList.add('show');

    fetch('/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: selectedAddress, lat: selectedLat, lon: selectedLon }),
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
          var events = buffer.split('\n\n');
          buffer = events.pop(); // keep incomplete tail

          events.forEach(function (eventStr) {
            if (!eventStr.trim()) return;
            var eventType = 'progress';
            var dataStr   = '';
            eventStr.split('\n').forEach(function (line) {
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
      showError(err.message || 'שגיאת תקשורת');
    });
  }
})();
</script>
</body>
</html>`;
