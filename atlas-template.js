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
// this Node template string.

function renderAtlasHTML(data) {
  const safeJson = JSON.stringify(data).replace(/<\/script>/gi, "<\\/script>");

  return (
    "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n" +
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, maximum-scale=1\">\n" +
    "<title>" + data.meta.name + " — 3D</title>\n" +
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

/* Loading overlay */
#loader { position: fixed; inset: 0; background: #0b0e14; display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 50; transition: opacity .6s; gap: 14px; }
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
<div id="loader"><div class="ring"></div><div class="t1" id="loader-t1">Building Tel Aviv…</div><div class="t2" id="loader-t2"></div></div>
<div id="title"><div class="t1" id="title-t1"></div><div class="t2" id="title-t2"></div></div>
<div id="search-wrap"><span class="mag">⌕</span><input id="search" type="text" placeholder="Search landmarks, streets, neighborhoods…" autocomplete="off"><div id="results"></div></div>
<div id="modes"><button data-mode="orbit" class="on">Orbit</button><button data-mode="fly">Fly</button><button data-mode="walk">Walk</button></div>
<div id="tools">
  <button id="btn-night" title="Day / night (N)">☾</button>
  <button id="btn-tour" title="Landmark tour (T)">▶</button>
  <button id="btn-reset" title="Reset view (R)">⌂</button>
  <button id="btn-full" title="Fullscreen">⛶</button>
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
var DAY = {
  sky: 0xbcd7e8, fog: 0xc4d9e6, ground: 0xd8d3c4, sea: 0x4f8fb8, beach: 0xe8dbb5,
  park: 0x9dbb7e, roadMajor: 0x8f8e88, roadMinor: 0xa6a49c, bTint: 0xffffff,
  hemiSky: 0xd8e8f5, hemiGround: 0xb0a890, hemiI: 0.85, sunI: 1.35, sunColor: 0xfff2dd
};
var NIGHT = {
  sky: 0x070b16, fog: 0x0a1020, ground: 0x11151f, sea: 0x0d2135, beach: 0x1a1d24,
  park: 0x14211a, roadMajor: 0x232733, roadMinor: 0x1b1f2a, bTint: 0x39415c,
  hemiSky: 0x1c2740, hemiGround: 0x0c0f16, hemiI: 0.5, sunI: 0.22, sunColor: 0xa8c0ff
};
var KIND_COLORS = { tower: 0xf0b429, tech: 0x39c6b8, culture: 0xe86f9e, civic: 0x7fa8f0, market: 0xf07f45, place: 0xf0b429, park: 0x74c476, beach: 0xf0d998 };

// ---------- renderer / scene ----------
var canvas = document.getElementById('scene');
var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
var scene = new THREE.Scene();
var camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 1, R * 12);

var hemi = new THREE.HemisphereLight(DAY.hemiSky, DAY.hemiGround, DAY.hemiI);
scene.add(hemi);
var sun = new THREE.DirectionalLight(DAY.sunColor, DAY.sunI);
sun.position.set(-0.6 * R, 1.1 * R, -0.5 * R);
scene.add(sun);
scene.fog = new THREE.Fog(DAY.fog, R * 1.2, R * 5.2);
scene.background = new THREE.Color(DAY.sky);

// ---------- helpers ----------
function shapeFrom(points) {
  var s = new THREE.Shape();
  s.moveTo(points[0][0], -points[0][1]);
  for (var i = 1; i < points.length; i++) s.lineTo(points[i][0], -points[i][1]);
  s.closePath();
  return s;
}
function flatShapeMesh(polys, color, y) {
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
  var merged = mergeGeos(geos);
  // Basic (unlit) + DoubleSide: flat ground surfaces render the same
  // regardless of polygon winding, and still receive fog.
  var mat = new THREE.MeshBasicMaterial({ color: color, side: THREE.DoubleSide });
  var mesh = new THREE.Mesh(merged, mat);
  mesh.position.y = y;
  return mesh;
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

// ---------- ground / sea / beach / parks ----------
var groundMat = new THREE.MeshBasicMaterial({ color: DAY.ground });
var ground = new THREE.Mesh(new THREE.PlaneGeometry(R * 10, R * 10), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.4;
scene.add(ground);

var seaMat = null;
if (A.sea && A.sea.length > 2) {
  var seaMesh = flatShapeMesh([A.sea], DAY.sea, 0.06);
  if (seaMesh) { seaMat = seaMesh.material; seaMat.transparent = true; seaMat.opacity = 0.94; scene.add(seaMesh); }
}
var beachMat = null;
if (A.beaches && A.beaches.length) {
  var bm = flatShapeMesh(A.beaches, DAY.beach, 0.12);
  if (bm) { beachMat = bm.material; scene.add(bm); }
}
var parkMat = null;
if (A.parks && A.parks.length) {
  var pm = flatShapeMesh(A.parks, DAY.park, 0.14);
  if (pm) { parkMat = pm.material; scene.add(pm); }
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
var roadMajorMat = new THREE.MeshBasicMaterial({ color: DAY.roadMajor, side: THREE.DoubleSide });
var roadMinorMat = new THREE.MeshBasicMaterial({ color: DAY.roadMinor, side: THREE.DoubleSide });
var roadsMajor = new THREE.Mesh(buildRoads(true), roadMajorMat); roadsMajor.position.y = 0.2; scene.add(roadsMajor);
var roadsMinor = new THREE.Mesh(buildRoads(false), roadMinorMat); roadsMinor.position.y = 0.18; scene.add(roadsMinor);

// ---------- buildings (one merged mesh, vertex colors) ----------
var lmById = {};
for (var li = 0; li < A.landmarks.length; li++) lmById[A.landmarks[li].id] = A.landmarks[li];

function hash01(i) { var x = Math.sin(i * 127.1) * 43758.5453; return x - Math.floor(x); }

function buildBuildings() {
  var pos = [], col = [];
  var c = new THREE.Color();
  for (var i = 0; i < A.buildings.length; i++) {
    var b = A.buildings[i];
    var ring = b.p;
    if (ring.length < 3) continue;
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
      for (var w6 = 0; w6 < 6; w6++) col.push(c.r * 0.88, c.g * 0.88, c.b * 0.9);
    }
    // roof
    var tris;
    try { tris = THREE.ShapeUtils.triangulateShape(v2, []); } catch (err) { tris = []; }
    for (var t = 0; t < tris.length; t++) {
      var tr = tris[t];
      // shape space y = -z  →  back to world z
      pos.push(v2[tr[0]].x, h, -v2[tr[0]].y, v2[tr[2]].x, h, -v2[tr[2]].y, v2[tr[1]].x, h, -v2[tr[1]].y);
      for (var r3 = 0; r3 < 3; r3++) col.push(c.r, c.g, c.b);
    }
  }
  var g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  g.computeVertexNormals();
  return g;
}
var buildingMat = new THREE.MeshLambertMaterial({ vertexColors: true, color: DAY.bTint });
var buildings = new THREE.Mesh(buildBuildings(), buildingMat);
scene.add(buildings);

// ---------- night windows + street lamps (Points) ----------
function buildWindows() {
  // estimate density so total points stay ~130k
  var est = 0;
  for (var i = 0; i < A.buildings.length; i++) {
    var b = A.buildings[i];
    var per = 0;
    for (var e = 0; e < b.p.length; e++) {
      var p1 = b.p[e], p2 = b.p[(e + 1) % b.p.length];
      per += Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    }
    est += (per / 6) * Math.max(1, Math.floor((b.h - 3) / 3.2));
  }
  var keep = Math.min(1, 130000 / Math.max(est, 1)) * 0.45;
  var pts = [], seed = 1;
  for (var i2 = 0; i2 < A.buildings.length; i2++) {
    var b2 = A.buildings[i2];
    for (var e2 = 0; e2 < b2.p.length; e2++) {
      var q1 = b2.p[e2], q2 = b2.p[(e2 + 1) % b2.p.length];
      var dx = q2[0] - q1[0], dz = q2[1] - q1[1];
      var len = Math.hypot(dx, dz);
      if (len < 3) continue;
      var nxo = -dz / len * 0.5, nzo = dx / len * 0.5;
      for (var d = 3; d < len - 2; d += 6) {
        for (var y = 4; y < b2.h - 0.5; y += 3.2) {
          if (hash01(seed++) > keep) continue;
          var f = d / len;
          pts.push(q1[0] + dx * f + nxo, y, q1[1] + dz * f + nzo);
        }
      }
    }
  }
  var g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
  var m = new THREE.PointsMaterial({ color: 0xffd98a, size: 1.7, sizeAttenuation: true, transparent: true, opacity: 0.95 });
  var p = new THREE.Points(g, m);
  p.visible = false;
  return p;
}
function buildLamps() {
  var pts = [];
  for (var i = 0; i < A.roads.length && pts.length < 24000; i++) {
    var r = A.roads[i];
    if (r.m !== 1) continue;
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
  var m = new THREE.PointsMaterial({ color: 0xffb45e, size: 2.6, sizeAttenuation: true, transparent: true, opacity: 0.85 });
  var p = new THREE.Points(g, m);
  p.visible = false;
  return p;
}
var windows = buildWindows(); scene.add(windows);
var lamps = buildLamps(); scene.add(lamps);

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

var beaconGroup = new THREE.Group();
var hitboxes = [];
var beaconLabels = [];
for (var bi = 0; bi < A.landmarks.length; bi++) {
  var lm = A.landmarks[bi];
  var color = KIND_COLORS[lm.kind] || 0xf0b429;
  var top = Math.max(lm.h, 6);
  // light beam
  var beamGeo = new THREE.CylinderGeometry(2.2, 2.2, 90, 8, 1, true);
  var beamMat = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.33, depthWrite: false, side: THREE.DoubleSide });
  var beam = new THREE.Mesh(beamGeo, beamMat);
  beam.position.set(lm.x, top + 45, lm.z);
  beaconGroup.add(beam);
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
for (var hi = 0; hi < (A.hoods || []).length; hi++) {
  var hd = A.hoods[hi];
  var hl = makeLabel(hd.name, hd.he, true);
  hl.position.set(hd.x, 120, hd.z);
  hl.material.opacity = 0.55;
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
  if (e.code === 'KeyN') toggleNight();
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

// ---------- day / night ----------
var night = false;
function lerpColor(mat, hex) { mat.color.set(hex); }
function toggleNight() {
  night = !night;
  var P = night ? NIGHT : DAY;
  scene.background.set(P.sky);
  scene.fog.color.set(P.fog);
  hemi.color.set(P.hemiSky); hemi.groundColor.set(P.hemiGround); hemi.intensity = P.hemiI;
  sun.intensity = P.sunI; sun.color.set(P.sunColor);
  groundMat.color.set(P.ground);
  if (seaMat) seaMat.color.set(P.sea);
  if (beachMat) beachMat.color.set(P.beach);
  if (parkMat) parkMat.color.set(P.park);
  roadMajorMat.color.set(P.roadMajor);
  roadMinorMat.color.set(P.roadMinor);
  buildingMat.color.set(P.bTint);
  windows.visible = night;
  lamps.visible = night;
  document.getElementById('btn-night').classList.toggle('on', night);
  toast(night ? '<b>Night mode</b> — windows are on' : '<b>Day mode</b>');
}
document.getElementById('btn-night').addEventListener('click', toggleNight);

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
var seaPhase = 0;

function animate(now) {
  requestAnimationFrame(animate);
  var dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;

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

  // gentle sea shimmer
  if (seaMat) {
    seaPhase += dt;
    seaMat.opacity = 0.9 + Math.sin(seaPhase * 0.9) * 0.05;
  }

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
    fpsEl.textContent = Math.round(frames * 1000 / (now - lastFps)) + ' fps';
    frames = 0; lastFps = now;
  }
}

document.getElementById('loader-t2').textContent = A.meta.counts.buildings.toLocaleString() + ' buildings · ' + A.roads.length.toLocaleString() + ' street segments';
requestAnimationFrame(animate);
setTimeout(function () { document.getElementById('loader').classList.add('hide'); }, 350);
`;

module.exports = { renderAtlasHTML };
