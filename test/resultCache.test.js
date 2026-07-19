const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  resultCacheKey,
  readCachedResult,
  writeCachedResult,
  RESULT_TTL_MS,
} = require("../lib/resultCache");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "result-cache-test-"));
}

test("resultCacheKey: rounds coordinates to 4 decimals and includes radius", () => {
  assert.strictEqual(resultCacheKey(32.078412, 34.774299, 400), "32.0784,34.7743,400");
  // Nearby points (within ~11 m) share a key; different radius does not.
  assert.strictEqual(resultCacheKey(32.07841, 34.77431, 400), resultCacheKey(32.078439, 34.774329, 400));
  assert.notStrictEqual(resultCacheKey(32.0784, 34.7743, 400), resultCacheKey(32.0784, 34.7743, 600));
});

test("write then read round-trips html and data", () => {
  const dir = tmpDir();
  const key = resultCacheKey(32.0784, 34.7743, 400);
  const result = { html: "<html>dash</html>", data: { site_center: { lat: 32.0784, lon: 34.7743 } } };
  writeCachedResult(dir, key, result);
  assert.deepStrictEqual(readCachedResult(dir, key), result);
});

test("read returns null for a missing entry", () => {
  assert.strictEqual(readCachedResult(tmpDir(), "32.0000,34.0000,400"), null);
});

test("read returns null once the TTL has expired", () => {
  const dir = tmpDir();
  const key = resultCacheKey(32.0784, 34.7743, 400);
  const result = { html: "<html></html>", data: { ok: true } };
  const savedAt = Date.now();
  writeCachedResult(dir, key, result, savedAt);
  const justBefore = savedAt + RESULT_TTL_MS - 1000;
  const justAfter = savedAt + RESULT_TTL_MS + 1000;
  assert.deepStrictEqual(readCachedResult(dir, key, justBefore), result);
  assert.strictEqual(readCachedResult(dir, key, justAfter), null);
});

test("read returns null for corrupt or incomplete entries", () => {
  const dir = tmpDir();
  const key = "32.0001,34.0001,400";
  writeCachedResult(dir, key, { html: "<html></html>", data: {} });
  const files = fs.readdirSync(dir);
  assert.strictEqual(files.length, 1);
  fs.writeFileSync(path.join(dir, files[0]), "not json {{{");
  assert.strictEqual(readCachedResult(dir, key), null);
  // Entry missing html/data fields is also rejected.
  fs.writeFileSync(path.join(dir, files[0]), JSON.stringify({ savedAt: Date.now() }));
  assert.strictEqual(readCachedResult(dir, key), null);
});

test("write failures are swallowed (cache must never break a run)", () => {
  // A file path used as a directory forces mkdir/write to fail.
  const bogus = path.join(tmpDir(), "file-not-dir");
  fs.writeFileSync(bogus, "occupied");
  assert.doesNotThrow(() => writeCachedResult(bogus, "32.0,34.0,400", { html: "x", data: {} }));
});
