const { test } = require("node:test");
const assert = require("node:assert");
const { parseSiteParams, clampRadius, RADIUS_DEFAULT } = require("../lib/siteParams");

test("parseSiteParams: valid lat/lon/address/r", () => {
  const site = parseSiteParams({ lat: "32.0784", lon: "34.7743", address: "Dizengoff 100, Tel Aviv", r: "600" });
  assert.deepStrictEqual(site, {
    lat: 32.0784,
    lon: 34.7743,
    radius: 600,
    address: "Dizengoff 100, Tel Aviv",
  });
});

test("parseSiteParams: missing lat/lon returns null", () => {
  assert.strictEqual(parseSiteParams({}), null);
  assert.strictEqual(parseSiteParams({ lat: "32.07" }), null);
  assert.strictEqual(parseSiteParams({ lon: "34.77" }), null);
  assert.strictEqual(parseSiteParams({ address: "Tel Aviv" }), null);
});

test("parseSiteParams: non-numeric lat/lon returns null", () => {
  assert.strictEqual(parseSiteParams({ lat: "abc", lon: "34.77" }), null);
  assert.strictEqual(parseSiteParams({ lat: "32.07", lon: "" }), null);
});

test("parseSiteParams: outside Israel bounds returns null (mirrors /atlas)", () => {
  assert.strictEqual(parseSiteParams({ lat: "48.85", lon: "2.35" }), null); // Paris
  assert.strictEqual(parseSiteParams({ lat: "28.99", lon: "34.5" }), null); // south of bounds
  assert.strictEqual(parseSiteParams({ lat: "34.01", lon: "34.5" }), null); // north of bounds
  assert.strictEqual(parseSiteParams({ lat: "32.0", lon: "33.49" }), null); // west of bounds
  assert.strictEqual(parseSiteParams({ lat: "32.0", lon: "36.01" }), null); // east of bounds
});

test("parseSiteParams: radius defaults and clamps like /atlas", () => {
  assert.strictEqual(parseSiteParams({ lat: "32.07", lon: "34.77" }).radius, RADIUS_DEFAULT);
  assert.strictEqual(parseSiteParams({ lat: "32.07", lon: "34.77", r: "50" }).radius, 100);
  assert.strictEqual(parseSiteParams({ lat: "32.07", lon: "34.77", r: "99999" }).radius, 3000);
  assert.strictEqual(parseSiteParams({ lat: "32.07", lon: "34.77", r: "junk" }).radius, RADIUS_DEFAULT);
});

test("parseSiteParams: missing address falls back to a coordinate label", () => {
  const site = parseSiteParams({ lat: "32.07", lon: "34.77" });
  assert.strictEqual(site.address, "32.070000, 34.770000");
});

test("parseSiteParams: address is trimmed and capped in length", () => {
  const site = parseSiteParams({ lat: "32.07", lon: "34.77", address: "  Tel Aviv  " });
  assert.strictEqual(site.address, "Tel Aviv");
  const long = parseSiteParams({ lat: "32.07", lon: "34.77", address: "x".repeat(500) });
  assert.strictEqual(long.address.length, 200);
});

test("clampRadius: numbers and strings", () => {
  assert.strictEqual(clampRadius(400), 400);
  assert.strictEqual(clampRadius("250"), 250);
  assert.strictEqual(clampRadius(10), 100);
  assert.strictEqual(clampRadius(99999), 3000);
  assert.strictEqual(clampRadius(undefined), RADIUS_DEFAULT);
  assert.strictEqual(clampRadius(null), RADIUS_DEFAULT);
  assert.strictEqual(clampRadius("nope"), RADIUS_DEFAULT);
});
