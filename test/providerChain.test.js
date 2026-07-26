const test = require("node:test");
const assert = require("node:assert");

const { _internal } = require("../index");
const { firstProvider, osmBuildingsFromElements, osmTreesFromElements } = _internal;

const fc = (n) => ({
  type: "FeatureCollection",
  features: Array.from({ length: n }, () => ({ type: "Feature", geometry: null, properties: {} })),
});

test("firstProvider: skips a throwing provider and returns the next", async () => {
  const { data, source } = await firstProvider("L", [
    { name: "a", fetch: async () => { throw new Error("boom"); } },
    { name: "b", fetch: async () => fc(3) },
    { name: "c", fetch: async () => { throw new Error("never reached"); } },
  ]);
  assert.strictEqual(source, "b");
  assert.strictEqual(data.features.length, 3);
});

test("firstProvider: skips an empty result and falls through", async () => {
  const { source } = await firstProvider("L", [
    { name: "a", fetch: async () => fc(0) },
    { name: "b", fetch: async () => fc(1) },
  ]);
  assert.strictEqual(source, "b");
});

test("firstProvider: all providers fail → empty layer, source 'none', no throw", async () => {
  const { data, source } = await firstProvider("L", [
    { name: "a", fetch: async () => { throw new Error("x"); } },
    { name: "b", fetch: async () => fc(0) },
  ]);
  assert.strictEqual(source, "none");
  assert.deepStrictEqual(data, { type: "FeatureCollection", features: [] });
});

// ── OSM fallback parsers ─────────────────────────────────────

const OSM_BUILDING_ELEMENTS = [
  { type: "node", id: 1, lon: 34.77, lat: 32.06 },
  { type: "node", id: 2, lon: 34.771, lat: 32.06 },
  { type: "node", id: 3, lon: 34.771, lat: 32.061 },
  { type: "node", id: 4, lon: 34.77, lat: 32.061 },
  // explicit height tag
  { type: "way", id: 10, nodes: [1, 2, 3, 1], tags: { building: "yes", height: "21.5" } },
  // levels only
  { type: "way", id: 11, nodes: [1, 2, 4, 1], tags: { building: "residential", "building:levels": "5" } },
  // no height info → default
  { type: "way", id: 12, nodes: [2, 3, 4, 2], tags: { building: "yes" } },
  // not a building → skipped
  { type: "way", id: 13, nodes: [1, 2, 3, 1], tags: { highway: "residential" } },
];

test("osmBuildingsFromElements: heights from tag, levels, and default", () => {
  const out = osmBuildingsFromElements(OSM_BUILDING_ELEMENTS);
  assert.strictEqual(out.features.length, 3);
  const byId = Object.fromEntries(out.features.map(f => [f.properties.osm_id, f.properties]));
  assert.strictEqual(byId[10].height, 21.5);
  assert.strictEqual(byId[10].heightSource, "attr");
  assert.strictEqual(byId[11].height, 16);      // 5 levels × 3.2
  assert.strictEqual(byId[11].heightSource, "osm");
  assert.strictEqual(byId[12].height, 9.6);
  assert.strictEqual(byId[12].heightSource, "default");
  assert.strictEqual(out.features[0].properties.layer, "buildings");
});

test("osmTreesFromElements: natural=tree nodes only, species picked up", () => {
  const out = osmTreesFromElements([
    { type: "node", id: 1, lon: 34.77, lat: 32.06, tags: { natural: "tree", species: "Ficus" } },
    { type: "node", id: 2, lon: 34.78, lat: 32.07, tags: { natural: "tree" } },
    { type: "node", id: 3, lon: 34.79, lat: 32.08, tags: { amenity: "bench" } },
    { type: "way",  id: 4, nodes: [1, 2], tags: { natural: "tree" } },
  ]);
  assert.strictEqual(out.features.length, 2);
  assert.strictEqual(out.features[0].properties.species, "Ficus");
  assert.strictEqual(out.features[0].geometry.type, "Point");
});
