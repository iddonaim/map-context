// ============================================================
// TEL AVIV ATLAS — HTML/Three.js page template
// ============================================================
// renderAtlasHTML(data) returns a single self-contained HTML page:
// the atlas data is embedded as JSON, and the scene/UI code below
// runs entirely in the browser. Three.js is loaded from /vendor
// (served by the launcher) with a CDN fallback so the file also
// works when opened directly from disk on a machine with internet.
//
// NOTE for future edits: the client code is written without
// template literals (no backticks) so it can live safely inside
// this Node template string. Avoid "${" sequences too.
//
// Graphics overview (all procedural, no downloaded textures):
// - ACES filmic tone mapping + real sun shadows (PCF soft), with the
//   shadow box following the camera so shadows stay crisp up close.
// - Shader sky dome: day gradient + sun; stars, moon and city-glow
//   horizon at night. Day/night is a single 0..1 uniform, animated
//   smoothly when toggled.
// - Buildings get procedural facade windows in the material shader
//   (window grids by world position, per-building variation); at
//   night a random subset of windows is emissive.
// - The sea is an animated shader: layered ripples, fresnel toward
//   the horizon and a sun/moon glitter path.
// - Parks get instanced low-poly trees; street lamps are additive
//   glow sprites; landmark beams use a soft vertical-gradient beam.
// - A quality toggle (and an automatic FPS-based fallback) turns
//   shadows off and drops resolution on weak devices.

function renderAtlasHTML(data) {
  const safeJson = JSON.stringify(data).replace(/<\/script>/gi, "<\\/script>");
  const safeTitle = String(data.meta.name).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  return (
    "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n" +
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, maximum-scale=1\">\n" +
    "<link rel=\"icon\" href=\"data:,\">\n" +
    "<title>" + safeTitle + " — 3D</title>\n" +
    "<style>\n" + CSS + "\n</style>\n</head>\n<body>\n" +
    HTML_BODY +
    "\n<script>\nwindow.ATLAS = " + safeJson + ";\n</script>\n" +
    "<script type=\"module\">\n" + CLIENT_JS + "\n</script>\n" +
    "</body>\n</html>\n"
  );
}

// ---- Styles --------------------------------------------------

const CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 100%; height: 100%; overflow: hidden; background: #0b0e14; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #e8eaf0; }
canvas#scene { position: fixed; inset: 0; display: block; }

/* subtle cinematic vignette over the 3D scene, under the UI */
#vignette { position: fixed; inset: 0; pointer-events: none; z-index: 4; background: radial-gradient(ellipse at center, transparent 58%, rgba(4,7,14,0.32) 100%); }

/* Loading overlay */
#loader { position: fixed; inset: 0; background: radial-gradient(ellipse at 50% 40%, #131a2b 0%, #0b0e14 70%); display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 50; transition: opacity .6s; gap: 14px; }
#loader.hide { opacity: 0; pointer-events: none; }
#loader .ring { width: 42px; height: 42px; border: 3px solid #2a3350; border-top-color: #f0b429; border-radius: 50%; animation: spin 0.9s linear infinite; }
#loader .t1 { font-size: 17px; font-weight: 700; letter-spacing: .05em; }
#loader .t2 { font-size: 12.5px; color: #8b93a8; }
@keyframes spin { to { transform: rotate(360deg); } }

/* Title */
#title { position: fixed; top: 14px; left: 16px; z-index: 10; pointer-events: none; }
#title .t1 { font-size: 15px; font-weight: 800; letter-spacing: .04em; text-shadow: 0 1px 8px rgba(0,0,0,.6); }
#title .t2 { font-size: 11px; color: rgba(232,234,240,.75); margin-top: 2px; text-shadow: 0 1px 6px rgba(0,0,0,.6); }

/* Search */
#search-wrap { position: fixed; top: 14px; left: 50%; transform: translateX(-50%); width: min(420px, calc(100vw - 220px)); z-index: 20; }
#search { width: 100%; padding: 9px 14px 9px 34px; border-radius: 20px; border: 1px solid rgba(255,255,255,.14); background: rgba(16,20,32,.82); color: #e8eaf0; font-size: 13px; outline: none; backdrop-filter: blur(8px); }
#search:focus { border-color: rgba(240,180,41,.55); }
#search-wrap .mag { position: absolute; left: 12px; top: 8px; opacity: .55; font-size: 13px; pointer-events: none; }
#results { position: absolute; top: calc(100% + 6px); left: 0; right: 0; background: rgba(16,20,32,.94); border: 1px solid rgba(255,255,255,.12); border-radius: 12px; overflow: hidden; display: none; backdrop-filter: blur(10px); }
#results.open { display: block; }
#results .item { display: flex; align-items: center; gap: 10px; padding: 9px 14px; font-size: 13px; cursor: pointer; }
#results .item:hover, #results .item.sel { background: rgba(240,180,41,.14); }
#results .item .k { font-size: 10px; padding: 2px 7px; border-radius: 8px; background: rgba(255,255,255,.1); color: #aab2c8; text-transform: uppercase; letter-spacing: .06em; flex-shrink: 0; }
#results .item .he { margin-left: auto; color: #8b93a8; direction: rtl; }

/* Mode switch + tool buttons */
#modes { position: fixed; top: 14px; right: 16px; display: flex; border-radius: 18px; overflow: hidden; border: 1px solid rgba(255,255,255,.14); background: rgba(16,20,32,.82); backdrop-filter: blur(8px); z-index: 20; }
#modes button { padding: 8px 16px; font-size: 12.5px; font-weight: 600; color: #aab2c8; background: transparent; border: none; cursor: pointer; }
#modes button.on { background: #f0b429; color: #14171f; }
#tools { position: fixed; top: 58px; right: 16px; display: flex; flex-direction: column; gap: 8px; z-index: 20; }
#tools button { width: 36px; height: 36px; border-radius: 10px; border: 1px solid rgba(255,255,255,.14); background: rgba(16,20,32,.82); color: #e8eaf0; font-size: 15px; cursor: pointer; backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; }
#tools button:hover { border-color: rgba(240,180,41,.6); }
#tools button.on { background: #f0b429; color: #14171f; }

/* Sun study panel */
#sunpanel { position: fixed; top: 58px; right: 62px; width: 248px; background: rgba(16,20,32,.92); border: 1px solid rgba(255,255,255,.14); border-radius: 14px; padding: 12px 14px; z-index: 25; display: none; backdrop-filter: blur(10px); }
#sunpanel.open { display: block; }
#sunpanel .sp-title { font-size: 11px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: #f0b429; margin-bottom: 10px; }
#sunpanel .row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
#sunpanel .lab { font-size: 12px; width: 52px; flex-shrink: 0; color: #e8eaf0; font-variant-numeric: tabular-nums; }
#sunpanel input[type=range] { flex: 1; accent-color: #f0b429; }
#sunpanel .meta { font-size: 11px; color: #8b93a8; line-height: 1.5; margin-top: 2px; }
#sunpanel .presets { display: flex; gap: 6px; margin-top: 8px; }
#sunpanel .presets button { flex: 1; padding: 4px 0; font-size: 11px; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #aab2c8; cursor: pointer; }
#sunpanel .presets button:hover { border-color: rgba(240,180,41,.6); color: #e8eaf0; }

/* Toast */
#toast { position: fixed; top: 64px; left: 50%; transform: translateX(-50%); padding: 8px 18px; border-radius: 16px; background: rgba(16,20,32,.9); border: 1px solid rgba(255,255,255,.14); font-size: 12.5px; z-index: 30; opacity: 0; transition: opacity .35s; pointer-events: none; backdrop-filter: blur(8px); }
#toast.show { opacity: 1; }
#toast b { color: #f0b429; }

/* Hint bar */
#hints { position: fixed; bottom: 12px; left: 50%; transform: translateX(-50%); display: flex; gap: 14px; padding: 7px 16px; border-radius: 14px; background: rgba(16,20,32,.72); border: 1px solid rgba(255,255,255,.1); font-size: 11px; color: #aab2c8; z-index: 10; backdrop-filter: blur(8px); white-space: nowrap; }
#hints b { color: #e8eaf0; font-weight: 600; }
@media (max-width: 760px) { #hints { display: none; } #search-wrap { width: calc(100vw - 190px); left: 12px; transform: none; } }

/* Minimap + FPS */
#minimap { position: fixed; bottom: 14px; right: 16px; width: 168px; height: 168px; border-radius: 12px; border: 1px solid rgba(255,255,255,.16); background: #10141f; z-index: 10; overflow: hidden; }
#minimap canvas { width: 100%; height: 100%; display: block; }
#fps { position: fixed; bottom: 190px; right: 16px; padding: 4px 10px; border-radius: 10px; background: rgba(16,20,32,.8); border: 1px solid rgba(255,255,255,.12); font-size: 11px; color: #8bd48f; z-index: 10; font-variant-numeric: tabular-nums; }

/* Info card */
#card { position: fixed; left: 16px; top: 84px; width: min(310px, calc(100vw - 32px)); background: rgba(16,20,32,.92); border: 1px solid rgba(255,255,255,.14); border-radius: 14px; padding: 16px 18px; z-index: 25; display: none; backdrop-filter: blur(10px); }
#card.open { display: block; }
#card .kind { display: inline-block; font-size: 10px; padding: 3px 8px; border-radius: 8px; background: rgba(240,180,41,.16); color: #f0b429; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 8px; }
#card h2 { font-size: 16px; font-weight: 800; margin-bottom: 2px; }
#card .he { font-size: 13px; color: #aab2c8; direction: rtl; text-align: left; margin-bottom: 8px; }
#card p { font-size: 12.5px; line-height: 1.55; color: #c9cfdd; }
#card .meta { margin-top: 10px; font-size: 11px; color: #8b93a8; }
#card .x { position: absolute; top: 10px; right: 12px; background: none; border: none; color: #8b93a8; font-size: 15px; cursor: pointer; }

/* Attribution */
#attrib { position: fixed; bottom: 12px; left: 16px; font-size: 10.5px; color: rgba(170,178,200,.75); z-index: 10; pointer-events: none; text-shadow: 0 1px 4px rgba(0,0,0,.7); }
#attrib .mock { color: #f08b8b; font-weight: 700; }
`;

// ---- Static DOM ----------------------------------------------

const HTML_BODY = `
<canvas id="scene"></canvas>
<div id="vignette"></div>
<div id="loader"><div class="ring"></div><div class="t1" id="loader-t1">Building Tel Aviv…</div><div class="t2" id="loader-t2"></div></div>
<div id="title"><div class="t1" id="title-t1"></div><div class="t2" id="title-t2"></div></div>
<div id="search-wrap"><span class="mag">⌕</span><input id="search" type="text" placeholder="Search landmarks, streets, neighborhoods…" autocomplete="off"><div id="results"></div></div>
<div id="modes"><button data-mode="orbit" class="on">Orbit</button><button data-mode="fly">Fly</button><button data-mode="walk">Walk</button></div>
<div id="tools">
  <button id="btn-night" title="Day / night (N)">☾</button>
  <button id="btn-sun" title="Sun & shadow study (S)">☀</button>
  <button id="btn-tour" title="Landmark tour (T)">▶</button>
  <button id="btn-reset" title="Reset view (R)">⌂</button>
  <button id="btn-quality" title="Graphics quality (shadows on/off)" class="on">✦</button>
  <button id="btn-full" title="Fullscreen">⛶</button>
</div>
<div id="sunpanel">
  <div class="sp-title">Sun &amp; shadow study</div>
  <div class="row"><span class="lab" id="sun-date">Jun 21</span><input id="sun-month" type="range" min="0" max="11" step="1" value="5"></div>
  <div class="row"><span class="lab" id="sun-time">13:00</span><input id="sun-hour" type="range" min="4.5" max="20.5" step="0.1" value="13"></div>
  <div class="meta" id="sun-meta"></div>
  <div class="presets"><button data-m="11">Dec 21</button><button data-m="2">Mar 21</button><button data-m="5">Jun 21</button></div>
</div>
<div id="toast"></div>
<div id="card"><button class="x" id="card-x">✕</button><span class="kind" id="card-kind"></span><h2 id="card-name"></h2><div class="he" id="card-he"></div><p id="card-blurb"></p><div class="meta" id="card-meta"></div></div>
<div id="hints"><span><b>Drag</b> rotate</span><span><b>Scroll</b> zoom</span><span><b>WASD</b> move</span><span><b>Dbl-click</b> fly to</span><span><b>T</b> tour</span><span><b>N</b> night</span></div>
<div id="minimap"><canvas id="minimap-canvas" width="336" height="336"></canvas></div>
<div id="fps">— fps</div>
<div id="attrib" ></div>
`;

// ---- Client code ---------------------------------------------
// (module script; no backticks / template literals below)

const CLIENT_JS = String.raw`
var THREE;
try { THREE = await import('/vendor/three.module.js'); }
catch (e) { THREE = await import('https://unpkg.com/three@0.169.0/build/three.module.js'); }

var A = window.ATLAS;
var R = A.meta.radius;

// ---------- palettes ----------
// Everything that changes between day and night is either a
// [dayColor, nightColor] pair lerped in applyEnvironment(), or a
// shader driven directly by the uNight uniform.
function C(hex) { return new THREE.Color(hex); }
var PAIR = {
  fog:       [C(0xbccddd), C(0x0a0f1c)],
  ground:    [C(0xd3cbb8), C(0x181c29)],
  roadMajor: [C(0x5e6066), C(0x30364a)],
  roadMinor: [C(0x757570), C(0x272d3e)],
  park:      [C(0x8fae6a), C(0x16211a)],
  beach:     [C(0xe6d7a8), C(0x23252e)],
  bTint:     [C(0xffffff), C(0x66719c)],
  sunColor:  [C(0xfff1dc), C(0x8fa6d8)],
  fillColor: [C(0xbcd3ff), C(0x2a3a5c)],
  hemiSky:   [C(0xcfe4ff), C(0x2a3a63)],
  hemiGnd:   [C(0xb8a98c), C(0x11141f)],
  canopy:    [C(0xffffff), C(0x4a5578)],
  trunk:     [C(0x6d5138), C(0x1a1a26)]
};
var LERP = { sunI: [2.6, 0.85], fillI: [0.5, 0.2], hemiI: [0.95, 0.55], exposure: [1.08, 0.98] };
var KIND_COLORS = { site: 0xff5d5d, tower: 0xf0b429, tech: 0x39c6b8, culture: 0xe86f9e, civic: 0x7fa8f0, market: 0xf07f45, place: 0xf0b429, park: 0x74c476, beach: 0xf0d998 };

// world-space light directions (scene → light)
var SUN_DIR = new THREE.Vector3(-0.45, 0.62, 0.42).normalize();   // default: pleasant afternoon sun over the sea (SW)
var MOON_DIR = new THREE.Vector3(0.35, 0.55, -0.5).normalize();
// the sun-study panel points this at the real computed sun position
var dayLightDir = SUN_DIR.clone();
var WARM_SUN = new THREE.Color(0xffa04e);
var sunWarmth = 0; // 0..1, rises toward sunrise/sunset for golden-hour light

// shared shader uniforms
var uNight = { value: 0 };
var uTime = { value: 0 };
var uSunDir = { value: SUN_DIR.clone() };
var uMoonDir = { value: MOON_DIR.clone() };

// ---------- renderer / scene ----------
var canvas = document.getElementById('scene');
var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = LERP.exposure[0];
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

var scene = new THREE.Scene();
var camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 1, R * 16);
scene.background = PAIR.fog[0].clone();
scene.fog = new THREE.Fog(PAIR.fog[0].clone(), R * 1.7, R * 6.5);

var hemi = new THREE.HemisphereLight(PAIR.hemiSky[0].clone(), PAIR.hemiGnd[0].clone(), LERP.hemiI[0]);
scene.add(hemi);

// main sun/moon light with a shadow box that follows the camera
var bigScreen = Math.min(window.innerWidth, window.innerHeight) * (window.devicePixelRatio || 1) > 1100;
var sun = new THREE.DirectionalLight(PAIR.sunColor[0].clone(), LERP.sunI[0]);
sun.castShadow = true;
sun.shadow.mapSize.set(bigScreen ? 4096 : 2048, bigScreen ? 4096 : 2048);
sun.shadow.bias = -0.0002;
scene.add(sun);
scene.add(sun.target);
var shadowSpan = 0;
var envLightDir = SUN_DIR.clone();
function updateSunPlacement() {
  var ax = mode === 'orbit' ? orbit.target.x : camera.position.x;
  var az = mode === 'orbit' ? orbit.target.z : camera.position.z;
  var span = mode === 'orbit'
    ? Math.min(Math.max(orbit.dist * 1.35, 260), R * 2.4)
    : Math.min(Math.max(camera.position.y * 6, 400), R * 2.4);
  var sdist = span * 2.0;
  sun.target.position.set(ax, 0, az);
  sun.position.set(ax + envLightDir.x * sdist, envLightDir.y * sdist, az + envLightDir.z * sdist);
  if (Math.abs(span - shadowSpan) > shadowSpan * 0.15) {
    shadowSpan = span;
    var sc = sun.shadow.camera;
    sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span;
    sc.near = sdist * 0.1; sc.far = sdist * 2.6;
    sc.updateProjectionMatrix();
    sun.shadow.normalBias = Math.max(1.2, span / 800);
  }
}

// cool fill from the opposite side so shaded facades aren't black
var fill = new THREE.DirectionalLight(PAIR.fillColor[0].clone(), LERP.fillI[0]);
fill.position.set(R, R * 0.7, -R * 0.6);
scene.add(fill);

// small light that travels with the camera so walk/fly stay readable at night
var camLight = new THREE.PointLight(0xffe0b0, 0, 160, 1.4);
scene.add(camLight);

// ---------- procedural canvas textures ----------
function glowTexture() {
  var cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  var ctx = cv.getContext('2d');
  var g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.22, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}
function beamTexture() {
  // vertical gradient: solid at the bottom, fading to nothing at the top
  var cv = document.createElement('canvas');
  cv.width = 8; cv.height = 128;
  var ctx = cv.getContext('2d');
  var g = ctx.createLinearGradient(0, 128, 0, 0);
  g.addColorStop(0, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.28)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, 128);
  return new THREE.CanvasTexture(cv);
}
function noiseTexture(sz, base, amp) {
  // low-contrast blotches to break up big flat surfaces
  var cv = document.createElement('canvas');
  cv.width = cv.height = sz;
  var ctx = cv.getContext('2d');
  ctx.fillStyle = 'rgb(' + base + ',' + base + ',' + base + ')';
  ctx.fillRect(0, 0, sz, sz);
  for (var i = 0; i < sz * 3; i++) {
    var v = base + Math.floor((hash01(i * 3.7) - 0.5) * amp * 2);
    ctx.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',0.18)';
    var rr = 4 + hash01(i * 1.3) * 26;
    ctx.beginPath();
    ctx.arc(hash01(i * 2.1) * sz, hash01(i * 5.9) * sz, rr, 0, Math.PI * 2);
    ctx.fill();
  }
  var tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ---------- helpers ----------
function hash01(i) { var x = Math.sin(i * 127.1) * 43758.5453; return x - Math.floor(x); }
function shapeFrom(points) {
  var s = new THREE.Shape();
  s.moveTo(points[0][0], -points[0][1]);
  for (var i = 1; i < points.length; i++) s.lineTo(points[i][0], -points[i][1]);
  s.closePath();
  return s;
}
function mergedShapeGeo(polys) {
  var geos = [];
  for (var i = 0; i < polys.length; i++) {
    if (!polys[i] || polys[i].length < 3) continue;
    try {
      var g = new THREE.ShapeGeometry(shapeFrom(polys[i]));
      g.rotateX(-Math.PI / 2);
      geos.push(g);
    } catch (e) { /* skip degenerate footprint */ }
  }
  if (!geos.length) return null;
  return mergeGeos(geos);
}
function mergeGeos(geos) {
  var total = 0;
  for (var i = 0; i < geos.length; i++) { geos[i] = geos[i].toNonIndexed(); total += geos[i].attributes.position.count; }
  var pos = new Float32Array(total * 3);
  var off = 0;
  for (var j = 0; j < geos.length; j++) {
    pos.set(geos[j].attributes.position.array, off);
    off += geos[j].attributes.position.array.length;
  }
  var g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
function pointInPoly(x, z, poly) {
  var inside = false;
  for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    var xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// ---------- sky dome (shader) ----------
var skyVert = [
  'varying vec3 vDir;',
  'void main() {',
  '  vDir = position;',
  '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
  '}'
].join('\n');
var skyFrag = [
  'uniform float uNight;',
  'uniform vec3 uSunDir;',
  'uniform vec3 uMoonDir;',
  'varying vec3 vDir;',
  'float shash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }',
  'void main() {',
  '  vec3 d = normalize(vDir);',
  '  float h = max(d.y, 0.0);',
  // day: warm hazy horizon lifting into blue
  '  vec3 day = mix(vec3(0.66, 0.77, 0.88), vec3(0.19, 0.41, 0.75), pow(h, 0.38));',
  '  float sd = max(dot(d, uSunDir), 0.0);',
  '  day += vec3(1.0, 0.86, 0.6) * (pow(sd, 380.0) * 2.2 + pow(sd, 26.0) * 0.22 + pow(sd, 4.0) * 0.09);',
  // night: deep blue with stars, a moon and a faint city glow at the horizon
  '  vec3 nite = mix(vec3(0.065, 0.085, 0.15), vec3(0.008, 0.014, 0.038), pow(h, 0.5));',
  '  nite += vec3(0.36, 0.26, 0.12) * pow(1.0 - h, 6.0) * 0.8;',
  '  float md = max(dot(d, uMoonDir), 0.0);',
  '  nite += vec3(0.95, 0.98, 1.05) * smoothstep(0.99955, 0.99985, md) * 1.1;',
  '  nite += vec3(0.55, 0.65, 0.9) * pow(md, 48.0) * 0.18;',
  '  vec3 sc = floor(d * 240.0);',
  '  float st = shash(sc);',
  '  float star = step(0.9986, st) * (0.35 + 0.65 * shash(sc + 7.0)) * smoothstep(0.02, 0.14, d.y);',
  '  nite += vec3(star);',
  '  vec3 col = mix(day, nite, uNight);',
  '  gl_FragColor = vec4(col, 1.0);',
  '  #include <tonemapping_fragment>',
  '  #include <colorspace_fragment>',
  '}'
].join('\n');
var sky = new THREE.Mesh(
  new THREE.SphereGeometry(R * 7, 48, 24),
  new THREE.ShaderMaterial({
    uniforms: { uNight: uNight, uSunDir: uSunDir, uMoonDir: uMoonDir },
    vertexShader: skyVert, fragmentShader: skyFrag,
    side: THREE.BackSide, depthWrite: false, fog: false
  })
);
scene.add(sky);

// ---------- ground / sea / beach / parks ----------
var groundTex = noiseTexture(256, 200, 26);
groundTex.repeat.set(36, 36);
var groundMat = new THREE.MeshLambertMaterial({ color: PAIR.ground[0].clone(), map: groundTex });
var ground = new THREE.Mesh(new THREE.CircleGeometry(R * 14, 64), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.4;
ground.receiveShadow = true;
scene.add(ground);

// animated sea shader: ripples + fresnel + sun/moon glitter
var seaVert = [
  '#include <fog_pars_vertex>',
  'varying vec3 vWPos;',
  'void main() {',
  '  vec4 wp = modelMatrix * vec4(position, 1.0);',
  '  vWPos = wp.xyz;',
  '  vec4 mvPosition = viewMatrix * wp;',
  '  gl_Position = projectionMatrix * mvPosition;',
  '  #include <fog_vertex>',
  '}'
].join('\n');
var seaFrag = [
  'uniform float uNight;',
  'uniform float uTime;',
  'uniform vec3 uSunDir;',
  'uniform vec3 uMoonDir;',
  'varying vec3 vWPos;',
  '#include <fog_pars_fragment>',
  'float whash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
  'void main() {',
  '  vec2 p = vWPos.xz;',
  '  float t = uTime;',
  '  float dcam = length(cameraPosition - vWPos);',
  '  float att = clamp(500.0 / dcam, 0.2, 1.0);',
  '  float n1 = sin(p.x * 0.055 + t * 1.1) + sin(p.y * 0.047 - t * 0.9);',
  '  float n2 = sin((p.x + p.y) * 0.021 + t * 0.6) + sin((p.x - p.y) * 0.017 - t * 0.45);',
  '  float n3 = sin(p.x * 0.15 + t * 1.9) * 0.4 + sin(p.y * 0.13 - t * 1.7) * 0.4;',
  '  vec3 nrm = normalize(vec3((n1 + n3) * 0.085 * att, 1.0, (n2 + n3) * 0.085 * att));',
  '  vec3 vdir = normalize(cameraPosition - vWPos);',
  '  vec3 deep = mix(vec3(0.045, 0.24, 0.37), vec3(0.010, 0.035, 0.075), uNight);',
  '  vec3 shal = mix(vec3(0.10, 0.40, 0.50), vec3(0.022, 0.06, 0.11), uNight);',
  '  float bands = sin((p.x + p.y * 0.6) * 0.008 + t * 0.35) * 0.5 + 0.5;',
  '  vec3 col = mix(deep, shal, 0.3 + 0.35 * bands);',
  '  float fres = pow(1.0 - max(dot(vdir, nrm), 0.0), 3.0);',
  '  vec3 skyc = mix(vec3(0.60, 0.71, 0.82), vec3(0.05, 0.07, 0.13), uNight);',
  '  col = mix(col, skyc, fres * 0.55);',
  '  vec3 ldir = normalize(mix(uSunDir, uMoonDir, uNight));',
  '  vec3 hf = normalize(ldir + vdir);',
  '  float spec = pow(max(dot(nrm, hf), 0.0), 260.0);',
  '  spec *= smoothstep(0.25, 1.0, whash(floor(p * 0.6) + floor(t * 5.0))) * 1.6 + 0.25;',
  '  col += mix(vec3(1.0, 0.9, 0.7), vec3(0.7, 0.8, 1.0), uNight) * spec * mix(1.6, 1.0, uNight);',
  '  gl_FragColor = vec4(col, 1.0);',
  '  #include <tonemapping_fragment>',
  '  #include <colorspace_fragment>',
  '  #include <fog_fragment>',
  '}'
].join('\n');
if (A.sea && A.sea.length > 2) {
  var seaGeo = mergedShapeGeo([A.sea]);
  if (seaGeo) {
    var seaMat = new THREE.ShaderMaterial({
      uniforms: {
        uNight: uNight, uTime: uTime, uSunDir: uSunDir, uMoonDir: uMoonDir,
        // NOTE: must be a fresh Color — the renderer writes the converted fog
        // color into this object every frame, so sharing scene.fog.color here
        // would corrupt the scene fog itself.
        fogColor: { value: new THREE.Color() }, fogNear: { value: scene.fog.near }, fogFar: { value: scene.fog.far }
      },
      vertexShader: seaVert, fragmentShader: seaFrag, fog: true, side: THREE.DoubleSide
    });
    var seaMesh = new THREE.Mesh(seaGeo, seaMat);
    seaMesh.position.y = 0.06;
    scene.add(seaMesh);
  }
}

var beachMat = null;
if (A.beaches && A.beaches.length) {
  var bg = mergedShapeGeo(A.beaches);
  if (bg) {
    beachMat = new THREE.MeshLambertMaterial({ color: PAIR.beach[0].clone(), side: THREE.DoubleSide });
    var bm = new THREE.Mesh(bg, beachMat);
    bm.position.y = 0.12;
    bm.receiveShadow = true;
    scene.add(bm);
  }
}
var parkMat = null;
if (A.parks && A.parks.length) {
  var pg = mergedShapeGeo(A.parks);
  if (pg) {
    parkMat = new THREE.MeshLambertMaterial({ color: PAIR.park[0].clone(), side: THREE.DoubleSide });
    var pm = new THREE.Mesh(pg, parkMat);
    pm.position.y = 0.14;
    pm.receiveShadow = true;
    scene.add(pm);
  }
}

// analysis-radius ring around the site (site-focused atlases only)
var siteRingMat = null;
if (A.meta.siteRadius) {
  var ringGeo = new THREE.RingGeometry(A.meta.siteRadius - 2.5, A.meta.siteRadius + 2.5, 128);
  ringGeo.rotateX(-Math.PI / 2);
  siteRingMat = new THREE.MeshBasicMaterial({ color: 0xff5d5d, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  var ring = new THREE.Mesh(ringGeo, siteRingMat);
  ring.position.y = 0.3;
  scene.add(ring);
}

// ---------- roads (flat ribbons) ----------
function buildRoads(major) {
  var pos = [];
  for (var i = 0; i < A.roads.length; i++) {
    var r = A.roads[i];
    if ((r.m === 1) !== major) continue;
    var w = r.w / 2;
    for (var s = 0; s < r.p.length - 1; s++) {
      var ax = r.p[s][0], az = r.p[s][1], bx = r.p[s + 1][0], bz = r.p[s + 1][1];
      var dx = bx - ax, dz = bz - az;
      var len = Math.hypot(dx, dz);
      if (len < 0.5) continue;
      var nx = -dz / len * w, nz = dx / len * w;
      pos.push(ax + nx, 0, az + nz, bx + nx, 0, bz + nz, bx - nx, 0, bz - nz);
      pos.push(ax + nx, 0, az + nz, bx - nx, 0, bz - nz, ax - nx, 0, az - nz);
    }
  }
  var g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.computeVertexNormals();
  return g;
}
var roadMajorMat = new THREE.MeshLambertMaterial({ color: PAIR.roadMajor[0].clone(), side: THREE.DoubleSide });
var roadMinorMat = new THREE.MeshLambertMaterial({ color: PAIR.roadMinor[0].clone(), side: THREE.DoubleSide });
var roadsMajor = new THREE.Mesh(buildRoads(true), roadMajorMat);
roadsMajor.position.y = 0.2; roadsMajor.receiveShadow = true; scene.add(roadsMajor);
var roadsMinor = new THREE.Mesh(buildRoads(false), roadMinorMat);
roadsMinor.position.y = 0.18; roadsMinor.receiveShadow = true; scene.add(roadsMinor);

// ---------- buildings (one merged mesh, vertex colors) ----------
var lmById = {};
for (var li = 0; li < A.landmarks.length; li++) lmById[A.landmarks[li].id] = A.landmarks[li];

function buildBuildings() {
  var pos = [], col = [], rnd = [];
  var c = new THREE.Color();
  for (var i = 0; i < A.buildings.length; i++) {
    var b = A.buildings[i];
    var ring = b.p;
    if (ring.length < 3) continue;
    var bRand = hash01(i + 0.37);
    // enforce CCW in shape space for consistent normals/triangulation
    var v2 = [];
    for (var k = 0; k < ring.length; k++) v2.push(new THREE.Vector2(ring[k][0], -ring[k][1]));
    if (THREE.ShapeUtils.area(v2) < 0) { v2.reverse(); ring = ring.slice().reverse(); }
    var h = Math.max(b.h, 3);
    // color: landmarks glow-tinted, others warm off-whites with slight variation
    if (b.lm && lmById[b.lm]) c.set(KIND_COLORS[lmById[b.lm].kind] || 0xf0b429);
    else {
      var v = 0.82 + hash01(i) * 0.15;
      c.setRGB(v, v * (0.97 + hash01(i + 7) * 0.03), v * (0.9 + hash01(i + 13) * 0.06));
    }
    var n = ring.length;
    // walls
    for (var e = 0; e < n; e++) {
      var p1 = ring[e], p2 = ring[(e + 1) % n];
      pos.push(p1[0], 0, p1[1], p2[0], 0, p2[1], p2[0], h, p2[1]);
      pos.push(p1[0], 0, p1[1], p2[0], h, p2[1], p1[0], h, p1[1]);
      // slightly darker walls than roof for depth
      for (var w6 = 0; w6 < 6; w6++) { col.push(c.r * 0.88, c.g * 0.88, c.b * 0.9); rnd.push(bRand); }
    }
    // roof — keep the triangulation's own vertex order: a CCW shape-space
    // triangle maps to an upward (+y) world normal under (x, h, -y).
    var tris;
    try { tris = THREE.ShapeUtils.triangulateShape(v2, []); } catch (err) { tris = []; }
    for (var t = 0; t < tris.length; t++) {
      var tr = tris[t];
      pos.push(v2[tr[0]].x, h, -v2[tr[0]].y, v2[tr[1]].x, h, -v2[tr[1]].y, v2[tr[2]].x, h, -v2[tr[2]].y);
      for (var r3 = 0; r3 < 3; r3++) { col.push(c.r, c.g, c.b); rnd.push(bRand); }
    }
  }
  var g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  g.setAttribute('aRand', new THREE.BufferAttribute(new Float32Array(rnd), 1));
  g.computeVertexNormals();
  return g;
}

// Facade shader: procedural window grids injected into the Lambert
// material. Windows are placed in a wall-space grid (tangent coord ×
// height), so they follow each facade regardless of orientation.
// At night a random subset of windows glows (emissive).
var buildingMat = new THREE.MeshLambertMaterial({ vertexColors: true, color: PAIR.bTint[0].clone() });
buildingMat.onBeforeCompile = function (sh) {
  sh.uniforms.uNight = uNight;
  sh.vertexShader = [
    'attribute float aRand;',
    'varying float vRand;',
    'varying vec3 vWPos;',
    'varying vec3 vWNrm;'
  ].join('\n') + '\n' + sh.vertexShader.replace(
    '#include <begin_vertex>',
    [
      '#include <begin_vertex>',
      'vRand = aRand;',
      // the buildings mesh has an identity transform, so object space == world space
      'vWPos = position;',
      'vWNrm = normal;'
    ].join('\n')
  );
  sh.fragmentShader = [
    'uniform float uNight;',
    'varying float vRand;',
    'varying vec3 vWPos;',
    'varying vec3 vWNrm;',
    'float bhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }'
  ].join('\n') + '\n' + sh.fragmentShader.replace(
    '#include <color_fragment>',
    [
      '#include <color_fragment>',
      'vec3 wn = normalize(vWNrm);',
      'float wall = 1.0 - step(0.35, abs(wn.y));',
      'vec2 tang = normalize(wn.xz + vec2(1e-4, 0.0));',
      'float fu = dot(vWPos.xz, vec2(-tang.y, tang.x));',
      'float fv = vWPos.y;',
      'vec2 wcell = vec2(fu / 3.4, (fv - 0.6) / 3.0);',
      'vec2 wf = fract(wcell);',
      'vec2 wid = floor(wcell) + vRand * 917.37;',
      'float wmask = wall * step(0.28, wf.x) * step(wf.x, 0.72) * step(0.34, wf.y) * step(wf.y, 0.80) * step(2.4, fv);',
      // daytime glass: darker blue-gray insets
      'diffuseColor.rgb *= mix(vec3(1.0), vec3(0.40, 0.45, 0.52), wmask * 0.65);',
      // ambient occlusion toward street level (walls only)
      'diffuseColor.rgb *= mix(1.0, mix(0.62, 1.0, smoothstep(0.0, 6.5, fv)), wall);',
      // faint roof variation so large roofs aren't perfectly flat
      'diffuseColor.rgb *= mix(0.93 + 0.07 * bhash(floor(vWPos.xz / 7.0) + vRand), 1.0, wall);'
    ].join('\n')
  ).replace(
    '#include <emissivemap_fragment>',
    [
      '#include <emissivemap_fragment>',
      'float wlit = step(bhash(wid), 0.5) * wmask * uNight;',
      'vec3 wcol = mix(vec3(1.0, 0.72, 0.38), vec3(0.72, 0.82, 1.0), step(0.75, bhash(wid + 31.7)));',
      'totalEmissiveRadiance += wcol * wlit * 2.6;'
    ].join('\n')
  );
};
var buildings = new THREE.Mesh(buildBuildings(), buildingMat);
buildings.castShadow = true;
buildings.receiveShadow = true;
scene.add(buildings);

// ---------- trees in parks (instanced) ----------
var canopyMat = null, trunkMat = null;
(function buildTrees() {
  if (!A.parks || !A.parks.length) return;
  var spots = [];
  var seed = 3;
  for (var i = 0; i < A.parks.length && spots.length < 2200; i++) {
    var poly = A.parks[i];
    if (!poly || poly.length < 3) continue;
    var minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9, area = 0;
    for (var j = 0; j < poly.length; j++) {
      minx = Math.min(minx, poly[j][0]); maxx = Math.max(maxx, poly[j][0]);
      minz = Math.min(minz, poly[j][1]); maxz = Math.max(maxz, poly[j][1]);
      var k = (j + 1) % poly.length;
      area += poly[j][0] * poly[k][1] - poly[k][0] * poly[j][1];
    }
    area = Math.abs(area) / 2;
    var want = Math.min(Math.floor(area / 130), 320);
    var placed = 0, tries = 0;
    while (placed < want && tries < want * 8 && spots.length < 2200) {
      tries++;
      var x = minx + hash01(seed++) * (maxx - minx);
      var z = minz + hash01(seed++) * (maxz - minz);
      if (!pointInPoly(x, z, poly)) continue;
      spots.push([x, z, hash01(seed++), hash01(seed++)]);
      placed++;
    }
  }
  if (!spots.length) return;
  canopyMat = new THREE.MeshLambertMaterial({ color: PAIR.canopy[0].clone(), flatShading: true });
  trunkMat = new THREE.MeshLambertMaterial({ color: PAIR.trunk[0].clone() });
  var canopies = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), canopyMat, spots.length);
  var trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.2, 1, 5), trunkMat, spots.length);
  var dummy = new THREE.Object3D();
  var tc = new THREE.Color();
  for (var s = 0; s < spots.length; s++) {
    var sp = spots[s];
    var th = 3.0 + sp[2] * 3.2;               // canopy center height
    var tr = 1.5 + sp[3] * 1.9;               // canopy radius
    dummy.position.set(sp[0], th, sp[1]);
    dummy.scale.set(tr, tr * 0.85, tr);
    dummy.rotation.set(0, sp[2] * 6.28, 0);
    dummy.updateMatrix();
    canopies.setMatrixAt(s, dummy.matrix);
    tc.setHSL(0.26 + sp[3] * 0.06, 0.42, 0.3 + sp[2] * 0.12);
    canopies.setColorAt(s, tc);
    dummy.rotation.set(0, 0, 0);
    dummy.position.set(sp[0], th / 2, sp[1]);
    dummy.scale.set(1, th, 1);
    dummy.updateMatrix();
    trunks.setMatrixAt(s, dummy.matrix);
  }
  canopies.castShadow = true;
  scene.add(canopies);
  scene.add(trunks);
})();

// ---------- street lamps (additive glow sprites, night only) ----------
var glowTex = glowTexture();
function buildLamps() {
  var pts = [];
  for (var i = 0; i < A.roads.length && pts.length < 24000; i++) {
    var r = A.roads[i];
    if (r.m !== 1 && r.w < 8) continue;
    for (var s = 0; s < r.p.length - 1; s++) {
      var ax = r.p[s][0], az = r.p[s][1], bx = r.p[s + 1][0], bz = r.p[s + 1][1];
      var len = Math.hypot(bx - ax, bz - az);
      for (var d = 0; d < len; d += 34) {
        var f = d / len;
        pts.push(ax + (bx - ax) * f, 6.5, az + (bz - az) * f);
      }
    }
  }
  var g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
  var m = new THREE.PointsMaterial({
    color: 0xffc878, size: 18, sizeAttenuation: true, map: glowTex,
    transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending
  });
  var p = new THREE.Points(g, m);
  p.visible = false;
  return p;
}
var lamps = buildLamps();
var lampsMat = lamps.material;
scene.add(lamps);

// ---------- landmark beacons, labels, hitboxes ----------
function makeLabel(text, sub, big) {
  var cv = document.createElement('canvas');
  var ctx = cv.getContext('2d');
  var fs = big ? 44 : 34;
  ctx.font = '700 ' + fs + 'px -apple-system, "Segoe UI", sans-serif';
  var w = Math.ceil(ctx.measureText(text).width);
  var subFs = 24;
  var wh = 0;
  if (sub) { ctx.font = '400 ' + subFs + 'px -apple-system, "Segoe UI", sans-serif'; wh = Math.ceil(ctx.measureText(sub).width); }
  cv.width = Math.max(w, wh) + 36;
  cv.height = sub ? fs + subFs + 34 : fs + 24;
  ctx = cv.getContext('2d');
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0,0,0,0.95)';
  ctx.shadowBlur = 10;
  ctx.font = '700 ' + fs + 'px -apple-system, "Segoe UI", sans-serif';
  ctx.fillStyle = big ? 'rgba(255,255,255,0.95)' : '#fff1c4';
  ctx.fillText(text, cv.width / 2, fs + 6);
  if (sub) {
    ctx.font = '400 ' + subFs + 'px -apple-system, "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(220,226,240,0.85)';
    ctx.fillText(sub, cv.width / 2, fs + subFs + 16);
  }
  var tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  var mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  var sp = new THREE.Sprite(mat);
  var scale = big ? 0.85 : 0.72;
  sp.userData.baseW = cv.width * scale;
  sp.userData.baseH = cv.height * scale;
  sp.scale.set(sp.userData.baseW, sp.userData.baseH, 1);
  return sp;
}

var beamTex = beamTexture();
var beaconGroup = new THREE.Group();
var hitboxes = [];
var beaconLabels = [];
var beamMats = [];
for (var bi = 0; bi < A.landmarks.length; bi++) {
  var lm = A.landmarks[bi];
  var color = KIND_COLORS[lm.kind] || 0xf0b429;
  var top = Math.max(lm.h, 6);
  // soft light beam rising from the landmark
  var beamGeo = new THREE.CylinderGeometry(2.0, 2.6, 95, 10, 1, true);
  var beamMat = new THREE.MeshBasicMaterial({
    color: color, map: beamTex, transparent: true, opacity: 0.4,
    depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending
  });
  var beam = new THREE.Mesh(beamGeo, beamMat);
  beam.position.set(lm.x, top + 47, lm.z);
  beaconGroup.add(beam);
  beamMats.push(beamMat);
  // label
  var label = makeLabel(lm.name, lm.he, false);
  label.position.set(lm.x, top + 100, lm.z);
  beaconGroup.add(label);
  beaconLabels.push(label);
  // invisible hitbox for picking
  var hb = new THREE.Mesh(new THREE.CylinderGeometry(26, 26, Math.max(top, 26), 8), new THREE.MeshBasicMaterial({ visible: false }));
  hb.position.set(lm.x, Math.max(top, 26) / 2, lm.z);
  hb.userData.lm = lm;
  beaconGroup.add(hb);
  hitboxes.push(hb);
}
scene.add(beaconGroup);

var hoodGroup = new THREE.Group();
var hoodScale = Math.max(0.35, Math.min(1, R / 2200)); // shrink area labels in small site atlases
for (var hi = 0; hi < (A.hoods || []).length; hi++) {
  var hd = A.hoods[hi];
  var hl = makeLabel(hd.name, hd.he, true);
  hl.position.set(hd.x, Math.max(60, 120 * hoodScale), hd.z);
  hl.material.opacity = 0.55;
  hl.scale.set(hl.userData.baseW * hoodScale, hl.userData.baseH * hoodScale, 1);
  hoodGroup.add(hl);
}
scene.add(hoodGroup);

// ---------- camera rig / controls ----------
var mode = 'orbit';
var orbit = { target: new THREE.Vector3(R * 0.12, 0, 0), theta: Math.PI, phi: 0.98, dist: R * 1.15 };
var HOME = { target: new THREE.Vector3(R * 0.12, 0, 0), theta: Math.PI, phi: 0.98, dist: R * 1.15 };
var keys = {};
var flySpeed = 90;
var look = { yaw: 0, pitch: -0.2 };

function applyOrbit() {
  var sp = Math.sin(orbit.phi), cp = Math.cos(orbit.phi);
  camera.position.set(
    orbit.target.x + orbit.dist * sp * Math.cos(orbit.theta),
    orbit.target.y + orbit.dist * cp,
    orbit.target.z + orbit.dist * sp * Math.sin(orbit.theta)
  );
  camera.lookAt(orbit.target);
}
function syncLookFromCamera() {
  var d = new THREE.Vector3();
  camera.getWorldDirection(d);
  look.yaw = Math.atan2(d.x, -d.z);
  look.pitch = Math.asin(Math.max(-1, Math.min(1, d.y)));
}
function applyLook() {
  var cp = Math.cos(look.pitch);
  var d = new THREE.Vector3(Math.sin(look.yaw) * cp, Math.sin(look.pitch), -Math.cos(look.yaw) * cp);
  camera.lookAt(camera.position.clone().add(d));
}
applyOrbit();

var dragging = false, dragBtn = 0, px = 0, py = 0, moved = 0;
canvas.addEventListener('pointerdown', function (e) {
  dragging = true; dragBtn = e.button; px = e.clientX; py = e.clientY; moved = 0;
  stopTour(); stopFlyTween();
  if (mode === 'walk' && document.pointerLockElement !== canvas) canvas.requestPointerLock();
});
window.addEventListener('pointerup', function (e) {
  dragging = false;
  if (moved < 6) handleClick(e);
});
window.addEventListener('pointermove', function (e) {
  if (document.pointerLockElement === canvas) {
    look.yaw += e.movementX * 0.0022;
    look.pitch = Math.max(-1.45, Math.min(1.45, look.pitch - e.movementY * 0.0022));
    return;
  }
  if (!dragging) return;
  var dx = e.clientX - px, dy = e.clientY - py;
  px = e.clientX; py = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
  if (mode === 'orbit') {
    if (dragBtn === 2 || e.shiftKey) {
      var panScale = orbit.dist * 0.0011;
      var fw = new THREE.Vector3(Math.cos(orbit.theta), 0, Math.sin(orbit.theta));
      var rt = new THREE.Vector3(-fw.z, 0, fw.x);
      orbit.target.addScaledVector(rt, dx * panScale);
      orbit.target.addScaledVector(fw, dy * panScale);
    } else {
      orbit.theta += dx * 0.0055;
      orbit.phi = Math.max(0.12, Math.min(1.52, orbit.phi - dy * 0.0045));
    }
  } else if (mode === 'fly') {
    look.yaw += dx * 0.0032;
    look.pitch = Math.max(-1.45, Math.min(1.45, look.pitch - dy * 0.0032));
  }
});
canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
canvas.addEventListener('wheel', function (e) {
  e.preventDefault();
  stopFlyTween();
  if (mode === 'orbit') {
    orbit.dist = Math.max(35, Math.min(R * 6, orbit.dist * (1 + e.deltaY * 0.0011)));
  } else if (mode === 'fly') {
    flySpeed = Math.max(15, Math.min(600, flySpeed * (1 - e.deltaY * 0.001)));
    toast('Fly speed <b>' + Math.round(flySpeed) + '</b> m/s');
  }
}, { passive: false });

// touch: pinch zoom
var pinchD = 0;
canvas.addEventListener('touchstart', function (e) { if (e.touches.length === 2) pinchD = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); }, { passive: true });
canvas.addEventListener('touchmove', function (e) {
  if (e.touches.length === 2 && mode === 'orbit') {
    var d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    if (pinchD > 0) orbit.dist = Math.max(35, Math.min(R * 6, orbit.dist * (pinchD / d)));
    pinchD = d;
  }
}, { passive: true });

window.addEventListener('keydown', function (e) {
  if (e.target.tagName === 'INPUT') return;
  keys[e.code] = true;
  if (e.code === 'KeyN') { closeSunStudy(); toggleNight(); }
  if (e.code === 'KeyS') sunStudy.active ? closeSunStudy() : openSunStudy();
  if (e.code === 'KeyT') tourActive ? stopTour(true) : startTour();
  if (e.code === 'KeyR') resetView();
  if (e.code === 'Digit1') setMode('orbit');
  if (e.code === 'Digit2') setMode('fly');
  if (e.code === 'Digit3') setMode('walk');
  if (e.code === 'Escape') { closeCard(); stopTour(true); }
});
window.addEventListener('keyup', function (e) { keys[e.code] = false; });

function setMode(m) {
  if (m === mode) return;
  stopTour(); stopFlyTween();
  if (m !== 'walk' && document.pointerLockElement === canvas) document.exitPointerLock();
  if (m === 'fly') {
    if (mode === 'orbit') syncLookFromCamera();
    if (camera.position.y < 25) camera.position.y = 60;
  }
  if (m === 'walk') {
    if (mode === 'orbit') {
      syncLookFromCamera();
      camera.position.x = orbit.target.x;
      camera.position.z = orbit.target.z;
    }
    camera.position.y = 1.75;
    look.pitch = 0.05;
    toast('Walk mode — click the scene to look around, <b>WASD</b> to move, <b>Esc</b> to release');
  }
  if (m === 'orbit' && mode !== 'orbit') {
    // rebuild an orbit target in front of the camera
    var d = new THREE.Vector3(); camera.getWorldDirection(d);
    var t = camera.position.clone().addScaledVector(d, Math.max(camera.position.y * 1.6, 220));
    t.y = 0;
    orbit.target.copy(t);
    orbit.dist = camera.position.distanceTo(t);
    var off = camera.position.clone().sub(t);
    orbit.theta = Math.atan2(off.z, off.x);
    orbit.phi = Math.acos(Math.max(-1, Math.min(1, off.y / orbit.dist)));
  }
  mode = m;
  var btns = document.querySelectorAll('#modes button');
  for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('on', btns[i].dataset.mode === m);
}
var modeBtns = document.querySelectorAll('#modes button');
for (var mb = 0; mb < modeBtns.length; mb++) modeBtns[mb].addEventListener('click', function () { setMode(this.dataset.mode); });

function clampToWorld(p) {
  var L = R * 2.2;
  p.x = Math.max(-L, Math.min(L, p.x));
  p.z = Math.max(-L, Math.min(L, p.z));
  p.y = Math.max(mode === 'walk' ? 1.75 : 3, Math.min(R * 4, p.y));
}

// ---------- fly-to tween ----------
var tween = null;
function flyTo(targetPos, dist, dur) {
  var startT = orbit.target.clone(), endT = targetPos.clone();
  var startD = orbit.dist, endD = dist || 260;
  var startPhi = orbit.phi, endPhi = 0.9;
  var t0 = performance.now();
  setMode('orbit');
  tween = function (now) {
    var f = Math.min(1, (now - t0) / (dur || 1400));
    var e = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
    orbit.target.lerpVectors(startT, endT, e);
    orbit.dist = startD + (endD - startD) * e;
    orbit.phi = startPhi + (endPhi - startPhi) * e;
    if (f >= 1) tween = null;
  };
}
function stopFlyTween() { tween = null; }

// ---------- picking ----------
var raycaster = new THREE.Raycaster();
function pickAt(clientX, clientY, targets) {
  var ndc = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  return raycaster.intersectObjects(targets, false);
}
function handleClick(e) {
  if (e.target !== canvas) return;
  var hits = pickAt(e.clientX, e.clientY, hitboxes);
  if (hits.length) { selectLandmark(hits[0].object.userData.lm, false); return; }
}
canvas.addEventListener('dblclick', function (e) {
  var hits = pickAt(e.clientX, e.clientY, [buildings, ground].concat(hitboxes));
  if (!hits.length) return;
  var p = hits[0].point.clone(); p.y = 0;
  flyTo(p, 240, 1300);
});

// ---------- info card ----------
var card = document.getElementById('card');
function selectLandmark(lm, fly) {
  document.getElementById('card-kind').textContent = lm.kind;
  document.getElementById('card-name').textContent = lm.name;
  document.getElementById('card-he').textContent = lm.he || '';
  document.getElementById('card-blurb').textContent = lm.blurb || '';
  document.getElementById('card-meta').textContent = (lm.h > 3 ? 'Height ~' + Math.round(lm.h) + ' m · ' : '') + Math.round(Math.hypot(lm.x, lm.z)) + ' m from center';
  card.classList.add('open');
  if (fly) flyTo(new THREE.Vector3(lm.x, 0, lm.z), Math.max(220, lm.h * 2.6), 1500);
}
function closeCard() { card.classList.remove('open'); }
document.getElementById('card-x').addEventListener('click', closeCard);

// ---------- search ----------
var searchIndex = [];
(function buildIndex() {
  var i;
  for (i = 0; i < A.landmarks.length; i++) {
    var lm = A.landmarks[i];
    searchIndex.push({ kind: lm.kind, label: lm.name, he: lm.he || '', x: lm.x, z: lm.z, lm: lm });
  }
  for (i = 0; i < (A.hoods || []).length; i++) {
    var hd = A.hoods[i];
    searchIndex.push({ kind: 'area', label: hd.name, he: hd.he || '', x: hd.x, z: hd.z, dist: 700 });
  }
  var seen = {};
  for (i = 0; i < A.roads.length; i++) {
    var r = A.roads[i];
    if (!r.n || seen[r.n]) continue;
    seen[r.n] = true;
    var mid = r.p[Math.floor(r.p.length / 2)];
    searchIndex.push({ kind: 'street', label: r.e || r.n, he: r.e ? r.n : '', x: mid[0], z: mid[1], dist: 420 });
  }
})();
var searchEl = document.getElementById('search');
var resultsEl = document.getElementById('results');
var currentResults = [];
searchEl.addEventListener('input', function () {
  var qv = searchEl.value.trim().toLowerCase();
  resultsEl.innerHTML = '';
  currentResults = [];
  if (qv.length < 2) { resultsEl.classList.remove('open'); return; }
  for (var i = 0; i < searchIndex.length && currentResults.length < 8; i++) {
    var it = searchIndex[i];
    if (it.label.toLowerCase().indexOf(qv) >= 0 || (it.he && it.he.indexOf(searchEl.value.trim()) >= 0)) currentResults.push(it);
  }
  if (!currentResults.length) { resultsEl.classList.remove('open'); return; }
  for (var j = 0; j < currentResults.length; j++) {
    var d = document.createElement('div');
    d.className = 'item';
    d.innerHTML = '<span class="k">' + currentResults[j].kind + '</span><span>' + currentResults[j].label + '</span><span class="he">' + (currentResults[j].he || '') + '</span>';
    (function (item) { d.addEventListener('click', function () { goToResult(item); }); })(currentResults[j]);
    resultsEl.appendChild(d);
  }
  resultsEl.classList.add('open');
});
searchEl.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && currentResults.length) goToResult(currentResults[0]);
  if (e.key === 'Escape') { resultsEl.classList.remove('open'); searchEl.blur(); }
});
function goToResult(item) {
  resultsEl.classList.remove('open');
  searchEl.value = item.label;
  searchEl.blur();
  if (item.lm) selectLandmark(item.lm, true);
  else { closeCard(); flyTo(new THREE.Vector3(item.x, 0, item.z), item.dist || 300, 1500); }
}

// ---------- day / night (smooth transition) ----------
var night = false;
var night01 = 0, nightTarget = 0;
function lerpPair(mat, pair, t) { mat.color.copy(pair[0]).lerp(pair[1], t); }
function applyEnvironment(t) {
  night01 = t;
  uNight.value = t;
  scene.fog.color.copy(PAIR.fog[0]).lerp(PAIR.fog[1], t);
  scene.background.copy(scene.fog.color);
  envLightDir.copy(dayLightDir).lerp(MOON_DIR, t).normalize();
  sun.color.copy(PAIR.sunColor[0]).lerp(WARM_SUN, sunWarmth * (1 - t)).lerp(PAIR.sunColor[1], t);
  sun.intensity = (LERP.sunI[0] + (LERP.sunI[1] - LERP.sunI[0]) * t) * (1 - 0.3 * sunWarmth * (1 - t));
  fill.color.copy(PAIR.fillColor[0]).lerp(PAIR.fillColor[1], t);
  fill.intensity = LERP.fillI[0] + (LERP.fillI[1] - LERP.fillI[0]) * t;
  hemi.color.copy(PAIR.hemiSky[0]).lerp(PAIR.hemiSky[1], t);
  hemi.groundColor.copy(PAIR.hemiGnd[0]).lerp(PAIR.hemiGnd[1], t);
  hemi.intensity = LERP.hemiI[0] + (LERP.hemiI[1] - LERP.hemiI[0]) * t;
  renderer.toneMappingExposure = LERP.exposure[0] + (LERP.exposure[1] - LERP.exposure[0]) * t;
  lerpPair(groundMat, PAIR.ground, t);
  lerpPair(roadMajorMat, PAIR.roadMajor, t);
  lerpPair(roadMinorMat, PAIR.roadMinor, t);
  lerpPair(buildingMat, PAIR.bTint, t);
  if (parkMat) lerpPair(parkMat, PAIR.park, t);
  if (beachMat) lerpPair(beachMat, PAIR.beach, t);
  if (canopyMat) lerpPair(canopyMat, PAIR.canopy, t);
  if (trunkMat) lerpPair(trunkMat, PAIR.trunk, t);
  lampsMat.opacity = 0.95 * t;
  lamps.visible = t > 0.02;
  for (var i = 0; i < beamMats.length; i++) beamMats[i].opacity = 0.3 + 0.3 * t;
}
applyEnvironment(0);
function toggleNight() {
  nightTarget = nightTarget === 1 ? 0 : 1;
  night = nightTarget === 1;
  document.getElementById('btn-night').classList.toggle('on', night);
  toast(night ? '<b>Night mode</b> — windows are on' : '<b>Day mode</b>');
}
document.getElementById('btn-night').addEventListener('click', function () { closeSunStudy(); toggleNight(); });

// ---------- sun & shadow study ----------
// Real solar geometry for the atlas' own coordinates: pick a month and a
// time of day, and the scene sun (and its shadows) moves to where the sun
// really is. Uses the 21st of each month, Israel clock time (IST/IDT).
var _now = new Date();
var sunStudy = { active: false, month: _now.getMonth(), hour: Math.min(19, Math.max(6, _now.getHours() + _now.getMinutes() / 60)) };
var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var DAYS_BEFORE = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
function solarPosition(month, hour) {
  var lat = A.meta.center.lat, lon = A.meta.center.lon;
  var n = DAYS_BEFORE[month] + 21;
  var decl = 0.4093 * Math.sin(2 * Math.PI * (284 + n) / 365);
  var B = 2 * Math.PI * (n - 81) / 364;
  var eot = (9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B)) / 60;
  var tz = month >= 3 && month <= 9 ? 3 : 2; // Israel daylight saving, approx.
  var offset = lon / 15 - tz + eot;           // clock time → solar time
  var H = (hour + offset - 12) * Math.PI / 12;
  var phi = lat * Math.PI / 180;
  var el = Math.asin(Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H));
  var az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) + Math.PI;
  var cosH0 = -Math.tan(phi) * Math.tan(decl);
  var H0 = Math.acos(Math.max(-1, Math.min(1, cosH0))) * 12 / Math.PI;
  return { el: el, az: az, rise: 12 - H0 - offset, set: 12 + H0 - offset };
}
function fmtTime(h) {
  h = (h + 24) % 24;
  var hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  if (mm === 60) { hh += 1; mm = 0; }
  return hh + ':' + (mm < 10 ? '0' : '') + mm;
}
function applySunStudy() {
  var sp = solarPosition(sunStudy.month, sunStudy.hour);
  var elDeg = sp.el * 180 / Math.PI;
  // blend to night as the sun drops: full day above +6°, full night below -3°
  var t = Math.max(0, Math.min(1, (6 - elDeg) / 9));
  sunWarmth = Math.max(0, Math.min(1, 1 - elDeg / 25));
  uSunDir.value.set(Math.sin(sp.az) * Math.cos(sp.el), Math.sin(sp.el), -Math.cos(sp.az) * Math.cos(sp.el));
  // the shadow-casting light keeps a minimum elevation so shadows stay finite
  var elC = Math.max(sp.el, 0.05);
  dayLightDir.set(Math.sin(sp.az) * Math.cos(elC), Math.sin(elC), -Math.cos(sp.az) * Math.cos(elC));
  nightTarget = t;
  applyEnvironment(t);
  night = t > 0.6;
  document.getElementById('btn-night').classList.toggle('on', night);
  document.getElementById('sun-date').textContent = MONTHS[sunStudy.month] + ' 21';
  document.getElementById('sun-time').textContent = fmtTime(sunStudy.hour);
  document.getElementById('sun-meta').innerHTML = (elDeg > 0
    ? 'Sun <b>' + Math.round(elDeg) + '&deg;</b> above horizon &middot; azimuth ' + Math.round(sp.az * 180 / Math.PI) + '&deg;'
    : 'Sun below the horizon') +
    '<br>Sunrise ' + fmtTime(sp.rise) + ' &middot; sunset ' + fmtTime(sp.set);
}
function openSunStudy() {
  if (sunStudy.active) return;
  sunStudy.active = true;
  stopTour();
  document.getElementById('sunpanel').classList.add('open');
  document.getElementById('btn-sun').classList.add('on');
  document.getElementById('sun-month').value = sunStudy.month;
  document.getElementById('sun-hour').value = sunStudy.hour;
  if (quality === 'low') toast('Tip: shadows are off — press <b>✦</b> to see them in the study');
  applySunStudy();
}
function closeSunStudy() {
  if (!sunStudy.active) return;
  sunStudy.active = false;
  document.getElementById('sunpanel').classList.remove('open');
  document.getElementById('btn-sun').classList.remove('on');
  sunWarmth = 0;
  dayLightDir.copy(SUN_DIR);
  uSunDir.value.copy(SUN_DIR);
  nightTarget = night ? 1 : 0;
  applyEnvironment(nightTarget);
}
document.getElementById('btn-sun').addEventListener('click', function () { sunStudy.active ? closeSunStudy() : openSunStudy(); });
document.getElementById('sun-month').addEventListener('input', function () { sunStudy.month = parseInt(this.value, 10); applySunStudy(); });
document.getElementById('sun-hour').addEventListener('input', function () { sunStudy.hour = parseFloat(this.value); applySunStudy(); });
var presetBtns = document.querySelectorAll('#sunpanel .presets button');
for (var pb = 0; pb < presetBtns.length; pb++) presetBtns[pb].addEventListener('click', function () {
  sunStudy.month = parseInt(this.dataset.m, 10);
  document.getElementById('sun-month').value = sunStudy.month;
  applySunStudy();
});

// ---------- graphics quality ----------
var quality = 'high';
var userQualityLock = false;
function setQuality(q, auto) {
  quality = q;
  var high = q === 'high';
  sun.castShadow = high;
  renderer.setPixelRatio(high ? Math.min(window.devicePixelRatio, 2) : 1);
  document.getElementById('btn-quality').classList.toggle('on', high);
  toast(auto
    ? 'Low frame rate — <b>reduced graphics</b> (✦ turns them back on)'
    : (high ? '<b>High</b> graphics — shadows on' : '<b>Low</b> graphics — shadows off'));
}
document.getElementById('btn-quality').addEventListener('click', function () {
  userQualityLock = true;
  setQuality(quality === 'high' ? 'low' : 'high', false);
});
// ?graphics=high|low pins the quality (high also disables the FPS auto-fallback)
var qparam = new URLSearchParams(location.search).get('graphics');
if (qparam === 'low') { userQualityLock = true; setQuality('low', false); }
else if (qparam === 'high') { userQualityLock = true; }
// tiny debug handle for automated screenshots / tinkering
window.__atlasProbe = function (cx, cy) {
  var ndc = new THREE.Vector2((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
  var rc = new THREE.Raycaster();
  rc.setFromCamera(ndc, camera);
  rc.far = 1e9;
  var hits = rc.intersectObjects(scene.children, true);
  return {
    cam: camera.position.toArray().map(function (v) { return Math.round(v); }),
    fog: scene.fog.color.getHexString(),
    night: uNight.value,
    hits: hits.slice(0, 4).map(function (h) {
      return { d: Math.round(h.distance), type: h.object.type, mat: h.object.material && h.object.material.type, geo: h.object.geometry && h.object.geometry.type };
    })
  };
};
window.__atlas = {
  setNight: function (v) { closeSunStudy(); nightTarget = v ? 1 : 0; night = !!v; applyEnvironment(nightTarget); document.getElementById('btn-night').classList.toggle('on', night); },
  setSun: function (m, h) { openSunStudy(); sunStudy.month = m; sunStudy.hour = h; document.getElementById('sun-month').value = m; document.getElementById('sun-hour').value = h; applySunStudy(); },
  setQuality: setQuality
};

// ---------- tour ----------
var tourActive = false, tourIdx = 0, tourTimer = null;
function tourStops() {
  var stops = [];
  for (var i = 0; i < A.landmarks.length; i++) if (A.landmarks[i].kind !== 'park') stops.push(A.landmarks[i]);
  return stops;
}
function startTour() {
  var stops = tourStops();
  if (!stops.length) return;
  tourActive = true; tourIdx = 0;
  document.getElementById('btn-tour').classList.add('on');
  toast('<b>Tour</b> started — drag or press T to stop');
  tourNext();
}
function tourNext() {
  if (!tourActive) return;
  var stops = tourStops();
  var lm = stops[tourIdx % stops.length];
  tourIdx++;
  selectLandmark(lm, false);
  flyTo(new THREE.Vector3(lm.x, 0, lm.z), Math.max(240, lm.h * 2.4), 1700);
  tourTimer = setTimeout(tourNext, 4300);
}
function stopTour(announce) {
  if (!tourActive) return;
  tourActive = false;
  clearTimeout(tourTimer);
  document.getElementById('btn-tour').classList.remove('on');
  if (announce) toast('Tour stopped');
}
document.getElementById('btn-tour').addEventListener('click', function () { tourActive ? stopTour(true) : startTour(); });

// ---------- misc UI ----------
var toastTimer = null;
function toast(html) {
  var t = document.getElementById('toast');
  t.innerHTML = html;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2400);
}
function resetView() {
  setMode('orbit');
  stopTour(); closeCard();
  flyTo(HOME.target.clone(), HOME.dist, 1200);
  orbit.theta = HOME.theta;
}
document.getElementById('btn-reset').addEventListener('click', resetView);
document.getElementById('btn-full').addEventListener('click', function () {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen();
});
document.getElementById('title-t1').textContent = A.meta.name + ' — ' + (A.meta.name_he || '');
document.getElementById('title-t2').textContent = A.meta.counts.buildings.toLocaleString() + ' buildings · ' + A.meta.counts.landmarks + ' landmarks · OpenStreetMap';
document.getElementById('attrib').innerHTML = (A.meta.mock ? '<span class="mock">MOCK DATA (offline preview) · </span>' : '') + 'Data © OpenStreetMap contributors · built ' + A.meta.built_at.slice(0, 10);

// ---------- minimap ----------
var mm = document.getElementById('minimap-canvas');
var mmCtx = mm.getContext('2d');
var mmBase = document.createElement('canvas');
mmBase.width = mm.width; mmBase.height = mm.height;
(function drawBase() {
  var c = mmBase.getContext('2d');
  var S = mm.width, half = S / 2, scl = half / (R * 1.15);
  c.fillStyle = '#151a26'; c.fillRect(0, 0, S, S);
  function tx(x) { return half + x * scl; }
  function tz(z) { return half + z * scl; }
  if (A.sea) {
    c.fillStyle = '#1c3a55';
    c.beginPath();
    c.moveTo(tx(A.sea[0][0]), tz(A.sea[0][1]));
    for (var i = 1; i < A.sea.length; i++) c.lineTo(tx(A.sea[i][0]), tz(A.sea[i][1]));
    c.closePath(); c.fill();
  }
  c.fillStyle = '#1f3322';
  for (var p = 0; p < (A.parks || []).length; p++) {
    var pk = A.parks[p];
    c.beginPath();
    c.moveTo(tx(pk[0][0]), tz(pk[0][1]));
    for (var j = 1; j < pk.length; j++) c.lineTo(tx(pk[j][0]), tz(pk[j][1]));
    c.closePath(); c.fill();
  }
  for (var r = 0; r < A.roads.length; r++) {
    var rd = A.roads[r];
    c.strokeStyle = rd.m ? 'rgba(150,160,185,0.8)' : 'rgba(90,98,120,0.5)';
    c.lineWidth = rd.m ? 1.6 : 0.7;
    c.beginPath();
    c.moveTo(tx(rd.p[0][0]), tz(rd.p[0][1]));
    for (var s = 1; s < rd.p.length; s++) c.lineTo(tx(rd.p[s][0]), tz(rd.p[s][1]));
    c.stroke();
  }
  c.fillStyle = '#f0b429';
  for (var l = 0; l < A.landmarks.length; l++) {
    c.beginPath();
    c.arc(tx(A.landmarks[l].x), tz(A.landmarks[l].z), 2.1, 0, Math.PI * 2);
    c.fill();
  }
})();
var mmFrame = 0;
function drawMinimap() {
  if (mmFrame++ % 6 !== 0) return;
  var S = mm.width, half = S / 2, scl = half / (R * 1.15);
  mmCtx.drawImage(mmBase, 0, 0);
  var cx = half + camera.position.x * scl, cz = half + camera.position.z * scl;
  var d = new THREE.Vector3(); camera.getWorldDirection(d);
  var ang = Math.atan2(d.z, d.x);
  mmCtx.fillStyle = 'rgba(240,180,41,0.28)';
  mmCtx.beginPath();
  mmCtx.moveTo(cx, cz);
  mmCtx.arc(cx, cz, 26, ang - 0.5, ang + 0.5);
  mmCtx.closePath(); mmCtx.fill();
  mmCtx.fillStyle = '#ffffff';
  mmCtx.beginPath(); mmCtx.arc(cx, cz, 3.2, 0, Math.PI * 2); mmCtx.fill();
  mmCtx.strokeStyle = '#f0b429'; mmCtx.lineWidth = 1.4;
  mmCtx.beginPath(); mmCtx.arc(cx, cz, 3.2, 0, Math.PI * 2); mmCtx.stroke();
}
mm.parentElement.addEventListener('click', function (e) {
  var rect = mm.parentElement.getBoundingClientRect();
  var S = mm.width, half = S / 2, scl = half / (R * 1.15);
  var x = ((e.clientX - rect.left) / rect.width * S - half) / scl;
  var z = ((e.clientY - rect.top) / rect.height * S - half) / scl;
  flyTo(new THREE.Vector3(x, 0, z), 320, 1300);
});

// ---------- resize / loop ----------
window.addEventListener('resize', function () {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

var fpsEl = document.getElementById('fps');
var frames = 0, lastFps = performance.now();
var lastT = performance.now();
var lowFpsStreak = 0;
var bootT = performance.now();

function animate(now) {
  requestAnimationFrame(animate);
  var dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  uTime.value = (now / 1000) % 3600;

  if (tween) tween(now);

  if (mode === 'orbit') {
    applyOrbit();
  } else {
    var sp = (mode === 'walk' ? 12 : flySpeed) * (keys['ShiftLeft'] || keys['ShiftRight'] ? 2.6 : 1) * dt;
    var cp = Math.cos(look.pitch);
    var fw = new THREE.Vector3(Math.sin(look.yaw) * cp, mode === 'fly' ? Math.sin(look.pitch) : 0, -Math.cos(look.yaw) * cp).normalize();
    var rt = new THREE.Vector3(-fw.z, 0, fw.x).normalize();
    if (keys['KeyW'] || keys['ArrowUp']) camera.position.addScaledVector(fw, sp);
    if (keys['KeyS'] || keys['ArrowDown']) camera.position.addScaledVector(fw, -sp);
    if (keys['KeyA'] || keys['ArrowLeft']) camera.position.addScaledVector(rt, -sp);
    if (keys['KeyD'] || keys['ArrowRight']) camera.position.addScaledVector(rt, sp);
    if (mode === 'fly') {
      if (keys['Space']) camera.position.y += sp;
      if (keys['KeyC']) camera.position.y -= sp;
    }
    clampToWorld(camera.position);
    if (mode === 'walk') camera.position.y = 1.75;
    applyLook();
  }

  // smooth day/night transition
  if (night01 !== nightTarget) {
    var stp = dt / 1.8;
    var nv = night01 + Math.max(-stp, Math.min(stp, nightTarget - night01));
    if (Math.abs(nv - nightTarget) < 0.004) nv = nightTarget;
    applyEnvironment(nv);
  }

  // shadow box + camera light follow the view
  updateSunPlacement();
  camLight.position.copy(camera.position);
  camLight.intensity = mode === 'orbit' ? 0 : night01 * (mode === 'walk' ? 220 : 120);

  // site ring gently pulses
  if (siteRingMat) siteRingMat.opacity = 0.45 + 0.18 * Math.sin(now / 500);

  // hood labels fade out when close to the ground
  hoodGroup.visible = camera.position.y > 60 || mode === 'orbit';

  // landmark labels: roughly constant screen size (scale with distance),
  // hidden entirely when the camera is about to fly through them
  for (var bl = 0; bl < beaconLabels.length; bl++) {
    var lbl = beaconLabels[bl];
    var ld = camera.position.distanceTo(lbl.position);
    lbl.visible = ld > 150;
    if (lbl.visible) {
      var lf = Math.max(0.22, Math.min(1.35, ld / 1200));
      lbl.scale.set(lbl.userData.baseW * lf, lbl.userData.baseH * lf, 1);
    }
  }

  drawMinimap();
  renderer.render(scene, camera);

  frames++;
  if (now - lastFps > 600) {
    var fps = Math.round(frames * 1000 / (now - lastFps));
    fpsEl.textContent = fps + ' fps';
    frames = 0; lastFps = now;
    // auto-fallback: sustained low FPS after startup turns shadows off
    if (!userQualityLock && quality === 'high' && now - bootT > 6000) {
      lowFpsStreak = fps < 17 ? lowFpsStreak + 1 : 0;
      if (lowFpsStreak >= 4) setQuality('low', true);
    }
  }
}

document.getElementById('loader-t2').textContent = A.meta.counts.buildings.toLocaleString() + ' buildings · ' + A.roads.length.toLocaleString() + ' street segments';
requestAnimationFrame(animate);
setTimeout(function () { document.getElementById('loader').classList.add('hide'); }, 350);
`;

module.exports = { renderAtlasHTML };
