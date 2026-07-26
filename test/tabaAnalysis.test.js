const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  analyzePlan,
  withGovernsSitePoint,
  categorizeDesignation,
  planSafeName,
  _internal,
} = require("../lib/tabaAnalysis");
const rights = require("../lib/takanonRights");
const { buildShp, buildDbf, buildStoredZip } = require("./fixtures/buildMmgZip");

// ── Fixture: an mmg.zip with a boundary layer and a land-use layer ──
// Coordinates in ITM (EPSG:2039), a ~100×100 m square in central Tel Aviv.

const ITM_SQUARE = [[
  [180000, 665000], [180100, 665000], [180100, 665100], [180000, 665100], [180000, 665000],
]];

function makeFixtureZip() {
  const boundaryShp = buildShp([ITM_SQUARE]);
  const boundaryDbf = buildDbf([{ name: "PL_NAME", length: 30 }], [{ PL_NAME: "test plan" }]);
  const landuseShp  = buildShp([ITM_SQUARE]);
  const landuseDbf  = buildDbf(
    [{ name: "LAND_USE", length: 40 }, { name: "USE_CODE", length: 10 }],
    [{ LAND_USE: "residential zone", USE_CODE: "120" }]
  );
  return buildStoredZip([
    { name: "plan_GVUL.shp", data: boundaryShp },
    { name: "plan_GVUL.dbf", data: boundaryDbf },
    { name: "plan_YEUD.shp", data: landuseShp },
    { name: "plan_YEUD.dbf", data: landuseDbf },
  ]);
}

function makeTmpDirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "taba-an-"));
  const docsDir = path.join(root, "docs");
  const cacheDir = path.join(root, "cache");
  fs.mkdirSync(docsDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  return { root, docsDir, cacheDir };
}

// ── Unit: helpers ────────────────────────────────────────────

test("planSafeName matches the downloader's sanitization", () => {
  assert.strictEqual(planSafeName('תא/1043'), "___1043"); // ת, א, / → _ _ _
  assert.strictEqual(planSafeName("507-0123456"), "507-0123456");
});

test("classifyLayerName recognizes מבא\"ת layer-name conventions", () => {
  assert.strictEqual(_internal.classifyLayerName("123_GVUL"), "boundary");
  assert.strictEqual(_internal.classifyLayerName("plan_border_x"), "boundary");
  assert.strictEqual(_internal.classifyLayerName("YEUD_KARKA"), "landuse");
  assert.strictEqual(_internal.classifyLayerName("some_landuse"), "landuse");
  assert.strictEqual(_internal.classifyLayerName("MIGRASHIM"), "lots");
  assert.strictEqual(_internal.classifyLayerName("whatever"), null);
});

test("looksLikeITM distinguishes projected meters from lon/lat", () => {
  assert.strictEqual(_internal.looksLikeITM({ type: "Polygon", coordinates: ITM_SQUARE }), true);
  assert.strictEqual(_internal.looksLikeITM({ type: "Polygon", coordinates: [[[34.77, 32.06], [34.78, 32.06], [34.78, 32.07], [34.77, 32.06]]] }), false);
});

test("reprojectITMToWGS84 lands the TLV test square in the right place", () => {
  const wgs = _internal.reprojectITMToWGS84({ type: "Polygon", coordinates: ITM_SQUARE });
  const [lon, lat] = wgs.coordinates[0][0];
  assert.ok(lon > 34.7 && lon < 34.9, `lon ${lon}`);
  assert.ok(lat > 32.0 && lat < 32.2, `lat ${lat}`);
});

test("projectedAreaSqm computes the 100x100 m square", () => {
  const area = _internal.projectedAreaSqm({ type: "Polygon", coordinates: ITM_SQUARE });
  assert.ok(Math.abs(area - 10000) < 1, `area ${area}`);
});

test("categorizeDesignation maps Hebrew designations incl. gershayim forms", () => {
  assert.strictEqual(categorizeDesignation("מגורים ד'").category, "residential");
  assert.strictEqual(categorizeDesignation('שצ"פ').category, "open-public");
  assert.strictEqual(categorizeDesignation("דרך מאושרת").category, "road");
  assert.strictEqual(categorizeDesignation("residential zone").category, "residential");
  assert.strictEqual(categorizeDesignation("something else").category, "other");
  assert.ok(/^#[0-9a-f]{6}$/i.test(categorizeDesignation(null).color));
});

// ── Integration: mmg.zip through the real shapefile/unzipper path ──

test("readMmgZip extracts boundary + land use from a real zip", async () => {
  const { root } = makeTmpDirs();
  const zipPath = path.join(root, "mmg.zip");
  fs.writeFileSync(zipPath, makeFixtureZip());

  const out = await _internal.readMmgZip(zipPath);

  assert.ok(out.boundary, "boundary extracted");
  assert.strictEqual(out.boundary.type, "Polygon");
  const [lon] = out.boundary.coordinates[0][0];
  assert.ok(lon > 34 && lon < 35, "boundary reprojected to WGS84");

  assert.strictEqual(out.landUse.length, 1);
  const lu = out.landUse[0];
  assert.strictEqual(lu.designation, "residential zone");
  assert.strictEqual(lu.category, "residential");
  assert.strictEqual(lu.code, "120");
  assert.ok(Math.abs(lu.areaDunams - 10) < 0.1, `areaDunams ${lu.areaDunams}`);

  const roles = out.layersFound.map(l => l.role).sort();
  assert.deepStrictEqual(roles, ["boundary", "landuse"]);
});

test("analyzePlan: full offline flow with cache round-trip", async () => {
  const { docsDir, cacheDir } = makeTmpDirs();
  const plan = "507-1234567";
  const planDir = path.join(docsDir, planSafeName(plan));
  fs.mkdirSync(planDir, { recursive: true });
  fs.writeFileSync(path.join(planDir, "mmg.zip"), makeFixtureZip());

  const record = await analyzePlan(plan, { docsDir, cacheDir, network: false });
  assert.deepStrictEqual(record.sources, ["mmg"]);
  assert.strictEqual(record.confidence, "medium"); // geometry but no rights
  assert.strictEqual(record.landUse.length, 1);
  assert.ok(record.boundary);

  // Cache round-trip: poison the analyzer inputs, expect the cached record.
  fs.rmSync(planDir, { recursive: true, force: true });
  const again = await analyzePlan(plan, { docsDir, cacheDir, network: false });
  assert.strictEqual(again.landUse.length, 1);
});

test("analyzePlan: unknown plan degrades to a low-confidence empty record", async () => {
  const { docsDir, cacheDir } = makeTmpDirs();
  const record = await analyzePlan("no-such-plan", { docsDir, cacheDir, network: false });
  assert.deepStrictEqual(record.sources, []);
  assert.strictEqual(record.confidence, "low");
  assert.strictEqual(record.boundary, null);
  assert.ok(record.notes.some(n => n.includes("no mmg.zip")));
});

test("withGovernsSitePoint: inside vs outside the boundary", async () => {
  const { root } = makeTmpDirs();
  const zipPath = path.join(root, "mmg.zip");
  fs.writeFileSync(zipPath, makeFixtureZip());
  const { boundary } = await _internal.readMmgZip(zipPath);
  const record = { boundary, landUse: [] };

  // Center of the ITM square ≈ 34.787, 32.078
  const inside = withGovernsSitePoint(record, 32.0779, 34.787);
  assert.strictEqual(inside.governsSitePoint, true);
  const outside = withGovernsSitePoint(record, 32.2, 34.9);
  assert.strictEqual(outside.governsSitePoint, false);
  // No coordinates → field absent
  assert.ok(!("governsSitePoint" in withGovernsSitePoint(record, NaN, NaN)));
});

// ── Unit: takanon Table 5 reconstruction ─────────────────────

test("itemsToRows clusters by y and orders cells right-to-left", () => {
  const rows = rights._internal.itemsToRows([
    { str: "B", x: 100, y: 700 },
    { str: "A", x: 200, y: 701 },   // same row, further right → first (RTL)
    { str: "C", x: 150, y: 650 },
  ]);
  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual(rows[0].cells.map(c => c.str), ["A", "B"]);
  assert.strictEqual(rows[1].cells[0].str, "C");
});

test("parseRightsTable reconstructs a Hebrew rights table", () => {
  // Simulated Table 5: headers at y=700, two data rows below.
  // RTL layout: designation column is rightmost (largest x).
  const items = [
    { str: "ייעוד",        x: 500, y: 700 },
    { str: "אחוזי בניה",   x: 400, y: 700 },
    { str: "תכסית",        x: 320, y: 700 },
    { str: "מס' קומות",    x: 240, y: 700 },
    { str: "גובה",         x: 160, y: 700 },
    { str: 'יח"ד',         x: 80,  y: 700 },

    { str: "מגורים ד'",    x: 500, y: 670 },
    { str: "180%",         x: 400, y: 670 },
    { str: "40",           x: 320, y: 670 },
    { str: "9",            x: 240, y: 670 },
    { str: "32.5",         x: 160, y: 670 },
    { str: "24",           x: 80,  y: 670 },

    { str: "מסחר",         x: 500, y: 640 },
    { str: "220%",         x: 400, y: 640 },
    { str: "60",           x: 320, y: 640 },
    { str: "4",            x: 240, y: 640 },
  ];
  const parsed = rights._internal.parseRightsTable(rights._internal.itemsToRows(items));
  assert.strictEqual(parsed.length, 2);
  assert.strictEqual(parsed[0].designation, "מגורים ד'");
  assert.strictEqual(parsed[0].farPercent, 180);
  assert.strictEqual(parsed[0].coveragePercent, 40);
  assert.strictEqual(parsed[0].floorsAbove, 9);
  assert.strictEqual(parsed[0].heightM, 32.5);
  assert.strictEqual(parsed[0].units, 24);
  assert.strictEqual(parsed[1].designation, "מסחר");
  assert.strictEqual(parsed[1].farPercent, 220);
  assert.strictEqual(parsed[1].units, null);
});

test("parseRightsTable returns null when no header row exists", () => {
  const parsed = rights._internal.parseRightsTable(rights._internal.itemsToRows([
    { str: "סתם טקסט", x: 100, y: 700 },
    { str: "עוד טקסט", x: 100, y: 650 },
  ]));
  assert.strictEqual(parsed, null);
});

test("maybeFixReversedHebrew un-reverses visual-order Hebrew", () => {
  const reversed = [..."מגורים"].reverse().join("");
  assert.strictEqual(rights._internal.maybeFixReversedHebrew(reversed), "מגורים");
  assert.strictEqual(rights._internal.maybeFixReversedHebrew("מגורים"), "מגורים");
  assert.strictEqual(rights._internal.maybeFixReversedHebrew("plain"), "plain");
});

test("pageLooksLikeTable5 detects the marker forms", () => {
  const n = rights._internal.normalizeHe;
  assert.ok(rights._internal.pageLooksLikeTable5(n("טבלה 5 - טבלת זכויות והוראות בנייה")));
  assert.ok(rights._internal.pageLooksLikeTable5(n("טבלת זכויות בניה")));
  assert.ok(!rights._internal.pageLooksLikeTable5(n("סתם עמוד רגיל בתקנון")));
});

test("extractRightsFromTakanon degrades gracefully on a non-PDF file", async () => {
  const { root } = makeTmpDirs();
  const p = path.join(root, "takanon.pdf");
  fs.writeFileSync(p, "not a pdf at all");
  const out = await rights.extractRightsFromTakanon(p);
  assert.deepStrictEqual(out.rights, []);
  assert.strictEqual(out.confidence, "low");
  assert.ok(out.note);
});

// ── Unit: on-demand document store (lib/tabaDocs) ────────────

const tabaDocs = require("../lib/tabaDocs");

test("ensurePlanDoc rejects traversal-ish names and unknown files", async () => {
  assert.strictEqual(await tabaDocs.ensurePlanDoc("../evil", "takanon.pdf"), null);
  assert.strictEqual(await tabaDocs.ensurePlanDoc("plan/../..", "takanon.pdf"), null);
  assert.strictEqual(await tabaDocs.ensurePlanDoc("ok-plan", "etc-passwd"), null);
});

test("ensurePlanDoc serves an existing file and nulls on missing sources", async () => {
  const { docsDir } = makeTmpDirs();
  const planDir = path.join(docsDir, "P1");
  fs.mkdirSync(planDir, { recursive: true });
  fs.writeFileSync(path.join(planDir, "tasrit.pdf"), "%PDF fake");

  const hit = await tabaDocs.ensurePlanDoc("P1", "tasrit.pdf", { docsDir });
  assert.strictEqual(hit, path.join(planDir, "tasrit.pdf"));
  // No sources.json → cannot download the missing one
  assert.strictEqual(await tabaDocs.ensurePlanDoc("P1", "takanon.pdf", { docsDir }), null);
});
