// Integration tests for the launcher page's param-boot path.
// launcher.js only listens (and opens a browser) when run directly, so
// requiring it here gives us the express app without side effects.
const { test, after } = require("node:test");
const assert = require("node:assert");
const { app } = require("../launcher");

let server;
let baseUrl;

function ensureServer() {
  if (server) return Promise.resolve();
  return new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
}

after(() => new Promise((resolve) => (server ? server.close(resolve) : resolve())));

async function getRoot(query = "") {
  await ensureServer();
  const res = await fetch(`${baseUrl}/${query}`);
  return { status: res.status, body: await res.text() };
}

test("GET / without params serves the picker (BOOT_SITE null)", async () => {
  const { status, body } = await getRoot();
  assert.strictEqual(status, 200);
  assert.match(body, /var BOOT_SITE = null;/);
  assert.match(body, /addr-input/); // picker UI present
});

test("GET / with valid params injects the boot site", async () => {
  const { status, body } = await getRoot("?lat=32.0784&lon=34.7743&address=Dizengoff%20100&r=600");
  assert.strictEqual(status, 200);
  const m = body.match(/var BOOT_SITE = (\{.*?\});/);
  assert.ok(m, "BOOT_SITE JSON not found in page");
  const boot = JSON.parse(m[1]);
  assert.deepStrictEqual(boot, { lat: 32.0784, lon: 34.7743, radius: 600, address: "Dizengoff 100" });
});

test("GET / with out-of-bounds coords falls back to the picker", async () => {
  const { body } = await getRoot("?lat=48.85&lon=2.35&address=Paris");
  assert.match(body, /var BOOT_SITE = null;/);
});

test("GET / escapes script-breaking address content", async () => {
  const { body } = await getRoot("?lat=32.0784&lon=34.7743&address=" + encodeURIComponent('</script><b>x</b>'));
  // Raw "</script>" from the address must not appear inside the page script.
  const m = body.match(/var BOOT_SITE = (.*?);\n/);
  assert.ok(m, "BOOT_SITE assignment not found");
  assert.ok(!m[1].includes("</script>"), "unescaped </script> inside BOOT_SITE");
  const boot = JSON.parse(m[1].replace(/\\u003c/g, "<"));
  assert.strictEqual(boot.address, "</script><b>x</b>");
});

test("back button navigates to / instead of reloading (keeps params from re-running)", async () => {
  const { body } = await getRoot();
  assert.ok(!body.includes("window.location.reload()"), "back button still uses location.reload()");
  assert.match(body, /window\.location\.href = '\/'/);
});
