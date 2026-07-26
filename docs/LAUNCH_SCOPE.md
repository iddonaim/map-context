# Launch Readiness — Scope (2026-07-26)

> What stands between the current app and a demo/launch-worthy one.
> Companion to `AUDIT_2026-07-12.md` and `TABA_ANALYSIS_SCOPE.md`.
> Items marked ✅ shipped in the same PR as this doc.

## Shipped with this doc (PR #20 follow-up commits)

- ✅ **Whatever-loads-first-shows-first.** The web dashboard now ships as
  soon as the fast layers resolve (buildings, streets, trees, registration,
  elevation, plan list). The two slow layers left the critical path:
  - CBS demographics load lazily (`/cbs-data`), filling the sidebar after
    the dashboard is already interactive.
  - TABA plan documents are no longer downloaded during the run at all —
    the run records source paths only, and `/taba-docs/...` downloads a
    file the first time it's clicked (or when the plan analyzer needs it),
    then caches it. This removes the "Downloading plan documents" wait
    entirely.
- ✅ **Stop button** on the run progress bar (aborts the request, returns
  to the picker).
- ✅ **Pin-drop on a map** in the picker as an alternative to address
  search (click → reverse-geocoded address → run).
- ✅ **`analysis-reset` postMessage** to the embedding app when a new run
  starts or the user returns to the picker (Cuboid side must listen — see
  below).
- ✅ **Demographics no longer default to Tel Aviv** for non-TLV sites:
  reverse-geocode → census locality lookup; the 6900 fallback only applies
  inside Tel Aviv's bbox.

## Needs cuboid-studio access (handoff list)

1. **"Go to Encode" toast persists after "ניתוח חדש"** — listen for the new
   `{type: 'analysis-reset'}` postMessage (same relay path as
   `analysis-complete`) and dismiss the toast/CTA.
2. **Toast position** — it floats over the picker's progress text; move it
   to a bottom bar / larger button row as suggested.
3. Optional: consume `data.demographicsUrl` (demographics are no longer in
   the initial `analysis-complete` payload when the fast path is used) and
   `data.taba.analysisUrlTemplate` for per-plan rights.

## 4 — Pre-caching Tel Aviv (static-layer cache)

Buildings/heights, trees, and streets change slowly; there is no reason to
re-query per address.

**Proposal: city-pack cache.** One bulk fetch per layer for the TLV bbox,
stored as grid tiles (~1 km²) under `cache/citypack/telaviv/`, refreshed
every 30 days in the background:

- Buildings + heights: Tel Aviv GIS bulk query (paginated bbox sweep;
  ~60–80k footprints).
- Trees: same source (~200k points).
- Streets/transit/institutions: the atlas already downloads citywide OSM
  and caches it a week — reuse that cache for the dashboard instead of a
  per-address Overpass query.

`runAnalysis` then answers TLV addresses from local tiles (ms, offline-
tolerant) and only falls back to live queries outside the pack. Add
`npm run precache` + a post-deploy warm.
**Estimate: 1.5–2 days. Biggest remaining latency win after this PR.**

## 6 — Empty dashboard tabs (currently "coming soon")

Recommendation for launch: **ship 3 real tabs, hide the rest** (an empty
tab reads as broken; a hidden one doesn't exist). Priority order:

| Tab | Content (all from data we already have or can fetch cheaply) | Est. |
|---|---|---|
| דשבורד | KPI cards: buildings count / avg + max height, land-use mix (from TABA analysis of governing plans), demographics vs city average, governing-plans count, institutions count by type. No new sources. | 1 day |
| סטטיסטי | Client-side charts: building-height histogram, height-source breakdown, tree-species top 10, area-vs-city demographic bars. | 1–1.5 days |
| GIS | Raw layer explorer: per-layer toggles + attribute table + per-layer GeoJSON download buttons (the data is already in the page). | 0.5–1 day |
| נדל"ן | Real-estate deals near the site (nadlan.gov.il / רשות המסים data via govmap API) — table + price trend. Source is semi-open; needs a feasibility spike first. | spike 0.5d, then 1–2 days |
| סביבה | Parks/green cover (OSM), tree density per dunam, main-road noise proxy (buffer around arterials). | 1 day |

## 7 — More data layers (ranked by value ÷ effort, all key-free)

1. **Public transit reach (GTFS Israel, data.gov.il)** — stops near site,
   lines, peak frequency; the national GTFS zip is static and cacheable.
   High demo value. ~1 day.
2. **Preservation buildings (שימור)** — Tel Aviv GIS has a preservation
   layer; discovery+query is the same ArcGIS code path we already have.
   Half a day, big value for architects.
3. **Citywide compiled land use (Xplan)** — the current designations around
   the site (not just per selected plan) as a map layer. Reuses the P2
   client. Half a day once Xplan layer ids are calibrated.
4. **Bike lanes + parks** (OSM tags in the existing combined query —
   nearly free).
5. **Real-estate transactions** — see נדל"ן tab above.
6. **Slope/terrain profile** — grid-sample opentopodata around the site
   (already integrated for the single point). Half a day; niche value.
7. Deferred/likely closed sources: flood risk, official noise maps,
   sewer/infrastructure.

## Known launch risks (carried from earlier docs)

- Non-TLV addresses: buildings/trees come from Tel Aviv GIS only —
  outside TLV those layers are empty (see Petah Tikva run). GovMap
  national-layer discovery is the fix; treat as post-launch unless the
  demo includes non-TLV sites.
- TABA analysis heuristics await live calibration (`TABA_ANALYSIS_SCOPE.md`
  status note): run one real analysis, check `/taba-analysis/<plan>` JSON
  (`layersFound`, `notes`).
- `test/launcherBoot.test.js` + picker now depend on unpkg for Leaflet —
  fine online; the CLI dashboard equally already did.
