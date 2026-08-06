// N0 probe (docs/LAUNCH_SCOPE.md): run `npm run probe` from a machine with
// normal internet (the deployed server or your laptop) and paste the output
// back. It checks candidate ArcGIS catalogs for the national/city layers we
// need (buildings, cadastre, trees) and lists the Xplan layer ids so the
// keyword-discovered slots can be pinned to exact URLs.
//
// Read-only: only issues ?f=json catalog/metadata GETs.

const axios = require("axios");

const HEADERS = { "User-Agent": "map-context/1.0 (contact@cuboidstudio.com)", Accept: "*/*" };
const LAYER_KWS = /מבנים|בנין|בניין|building|bldg|גוש|חלק|parcel|cadast|kadast|עצים|tree|עץ|יעוד|ייעוד|land.?use/i;

const CANDIDATES = [
  { name: "govmap ags (current, observed 404)", url: "https://ags.govmap.gov.il/arcgis/rest/services" },
  { name: "govmap ags /ArcGIS casing",          url: "https://ags.govmap.gov.il/ArcGIS/rest/services" },
  { name: "govmap root host",                   url: "https://govmap.gov.il/arcgis/rest/services" },
  { name: "open.govmap",                        url: "https://open.govmap.gov.il/arcgis/rest/services" },
  { name: "mapi (Survey of Israel)",            url: "https://ags.mapi.gov.il/arcgis/rest/services" },
  { name: "mapi alt host",                      url: "https://gisserver.mapi.gov.il/arcgis/rest/services" },
  { name: "iplan (works — Xplan lives here)",   url: "https://ags.iplan.gov.il/arcgisiplan/rest/services" },
  { name: "Jerusalem muni",                     url: "https://gis.jerusalem.muni.il/arcgis/rest/services" },
  { name: "Haifa muni",                         url: "https://gis.haifa.muni.il/arcgis/rest/services" },
  { name: "Beer-Sheva muni",                    url: "https://gis.beer-sheva.muni.il/arcgis/rest/services" },
];

const XPLAN = "https://ags.iplan.gov.il/arcgisiplan/rest/services/PlanningPublic/Xplan/MapServer";

async function getJson(url, timeout = 10000) {
  const res = await axios.get(url, { params: { f: "json" }, headers: HEADERS, timeout });
  return res.data;
}

async function probeCatalog(c) {
  const out = [`\n━━ ${c.name}`, `   ${c.url}`];
  let data;
  try {
    data = await getJson(c.url);
  } catch (e) {
    out.push(`   ✗ ${e.response?.status ?? e.code ?? e.message}`);
    return out;
  }
  const folders  = data.folders  ?? [];
  const services = data.services ?? [];
  out.push(`   ✓ reachable — ${folders.length} folders, ${services.length} services`);

  const interesting = services.filter(s => LAYER_KWS.test(s.name));
  for (const s of interesting.slice(0, 15)) out.push(`   • service: ${s.name} (${s.type})`);

  // One level of folders, looking for relevant service names
  for (const folder of folders.slice(0, 25)) {
    try {
      const fd = await getJson(`${c.url}/${folder}`);
      const hits = (fd.services ?? []).filter(s => LAYER_KWS.test(s.name));
      for (const s of hits.slice(0, 10)) out.push(`   • ${folder}/: ${s.name} (${s.type})`);
    } catch (_) { /* skip unreadable folder */ }
  }
  if (!interesting.length && !folders.length) {
    for (const s of services.slice(0, 10)) out.push(`   · service: ${s.name} (${s.type})`);
  }
  return out;
}

/** Run the full probe; returns the report as text. Catalogs probe in
 *  parallel so the whole thing stays within ~30s even with timeouts. */
async function runProbe() {
  const lines = ["map-context source probe — paste this whole output back"];

  const sections = await Promise.all(CANDIDATES.map(c =>
    probeCatalog(c).catch(e => [`\n━━ ${c.name}`, `   ✗ probe error: ${e.message}`])
  ));
  for (const s of sections) lines.push(...s);

  lines.push(`\n━━ Xplan layer inventory`, `   ${XPLAN}`);
  try {
    const data = await getJson(XPLAN);
    for (const l of data.layers ?? []) {
      lines.push(`   layer ${String(l.id).padStart(3)}: ${l.name}`);
    }
  } catch (e) {
    lines.push(`   ✗ ${e.response?.status ?? e.message}`);
  }

  lines.push("\nDone.");
  return lines.join("\n");
}

module.exports = { runProbe };

if (require.main === module) {
  runProbe().then(text => console.log(text));
}
