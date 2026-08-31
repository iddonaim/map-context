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
- ✅ **Demographics no longer default to Tel Aviv** for non-TLV sites:
  reverse-geocode → census locality lookup; the 6900 fallback only applies
  inside Tel Aviv's bbox.

## Non-TLV (nationwide) coverage — scope

Where each layer stands today outside Tel Aviv, and the national source
that fixes it:

| Layer | Today | Outside TLV today | National source (proposed) |
|---|---|---|---|
| Geocoding, streets/transit/institutions, elevation | Nominatim / Overpass / OpenTopo | ✔ already national | — |
| Demographics | CBS census by locality | ✔ national since this PR | — |
| TABA plans + documents + Meirim | land.gov.il / Meirim | ✔ national APIs | — (needs gush/chelka, see cadastre) |
| **Buildings + heights** | GovMap catalog discovery (observed failing) → TLV GIS fallback | **empty** (Petah Tikva run: 0 buildings) | GovMap national buildings layer (probe & pin exact service); **OSM buildings as universal fallback** (footprints + `building:levels`) |
| **Cadastre (גוש/חלקה, registration blocks)** | TLV GIS layer | **empty** → TABA search gets no gush → plan lookup degrades | GovMap national parcels/gushim layers (Survey-of-Israel data, open ArcGIS) |
| **Trees** | TLV Open Data — and currently **fatal**: throws where no layer exists | **fails the whole run** in cities without a matching layer | OSM `natural=tree` fallback (sparse but honest); per-city GIS adapters (Jerusalem, Haifa expose ArcGIS) as optional upgrades |

### Plan

- ✅ **N1 — no layer is fatal (shipped 2026-07-26):** buildings, trees,
  registration blocks, and streets/transit all degrade to an empty layer
  plus a map coverage notice instead of failing the run. Only geocoding
  remains fatal (nothing to show without a point).
- ✅ **N2 — provider chains (shipped 2026-07-26):** each layer tries an
  ordered provider list; first provider returning features wins, and the
  winner is recorded in `data.layerSources` and cited by the coverage
  notices. Chains: `buildings: [govmap, telaviv-gis, osm]`,
  `trees: [telaviv-gis, osm]`, `registration/parcel-at-point:
  [telaviv-gis, govmap]`.
- ✅ **N3a — OSM fallback providers (shipped 2026-07-26):** OSM building
  footprints with heights from `height`/`building:levels` tags (9.6 m
  default otherwise, flagged), and OSM `natural=tree` points. Any Israeli
  address now gets at least OSM-quality buildings and the run cannot 500
  on a missing municipal layer.
- **N0 — probe (in progress):** live run 2026-07-26 confirmed
  `ags.govmap.gov.il/arcgis/rest/services` is a hard **404** — the govmap
  chain slots can never win at that URL. `npm run probe`
  (`scripts/probe-sources.js`) checks candidate catalogs (govmap URL
  variants, mapi.gov.il / Survey of Israel, Jerusalem/Haifa/Beer-Sheva
  municipal portals) and dumps the Xplan layer inventory — run it from a
  network-enabled machine and paste the output; then the providers get
  pinned URLs.

  Other round-1 live findings (Dizengoff + Petah Tikva runs):
  - Provider chains verified in production — PT got OSM buildings (306)
    + OSM trees (52), demographics resolved to LocalityCode 7900. ✔
  - Old plans' mmg zips carry only a plan boundary (0 land-use layers) —
    expected for pre-digital plans.
  - Two modern-plan mmg zips failed `unzipper` with FILE_ENDED in ~2 s
    (not a timeout). Fixes shipped: buffer-mode reparse fallback, EOCD
    integrity check before caching, truncated files auto-removed.
  - Xplan land-use polygons returned but with null designations (attr
    keywords missed) and the boundary layer matched nothing — fixes
    shipped: widened keywords (MAVAT_*), per-layer tries + attribute-key
    samples recorded in the analysis record's `layersFound`/`debug`.
  - Takanon Table 5 detected but unparsed — parser now merges split
    cells, handles two-row stacked headers, and records the table page's
    first rows in `debug.takanonRows` when it still fails.
- **N3b — city adapters (pending N0-style probes, ~½ day each):**
  Jerusalem, Haifa, Beer-Sheva municipal ArcGIS adapters slotted into the
  chains ahead of the OSM fallback.
- **N4 — tree-data source survey (pending, ½ day):** see decision 2.

### Decisions (2026-07-26)

1. **Insufficient height data must be visible to the user.** ✅ Shipped:
   the dashboard map shows dismissible coverage notices — "no building
   data for this location", "heights partial — N% estimated" (when ≥50%
   of footprints carry the default height), "no tree data". The same
   notices should carry the winning provider name once N2 lands.
2. **Trees: same visibility, plus widen the source search.** New task
   **N4 — tree-data source survey (½ day, network-enabled machine):**
   inventory municipal tree surveys (סקר עצים) exposed by the
   Jerusalem / Haifa / Beer-Sheva GIS portals, GovMap vegetation layers,
   and any data.gov.il tree datasets; record endpoints + schemas here,
   then wire the usable ones as providers.
3. **Basic city set: Tel Aviv, Jerusalem, Haifa, Beer-Sheva.** Today only
   Tel Aviv has an adapter — Jerusalem/Haifa/Beer-Sheva municipal ArcGIS
   adapters are part of N3 (~½ day each once the provider chain exists),
   with GovMap national + OSM as the everywhere-else fallback. Anything
   beyond these four cities is out of scope for launch.

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

- Non-TLV addresses: see the nationwide-coverage scope above (N0–N3) —
  buildings/trees/cadastre are TLV-only today and trees can fail the run.
- TABA analysis heuristics await live calibration (`TABA_ANALYSIS_SCOPE.md`
  status note): run one real analysis, check `/taba-analysis/<plan>` JSON
  (`layersFound`, `notes`).
- `test/launcherBoot.test.js` + picker now depend on unpkg for Leaflet —
  fine online; the CLI dashboard equally already did.

## TABA scope remnants (carried 2026-08-30 from `TABA_ANALYSIS_SCOPE.md`, now historic)

Four items from the TABA document-analysis spec were still open when that
doc was marked historic; they move here so they are not lost:

1. **P4 — scanned-plans OCR** (tesseract `heb` and/or env-gated LLM
   extraction, confidence-flagged) — deferred by default, never built.
2. **The promised UI disclaimer** (rights synthesis is out of scope, and
   "the UI carries a disclaimer saying so") — not found in code.
3. **The "Planning rights" sidebar section** (governing plans at the site)
   — not found in code.
4. **Open decision 3 — LLM-assisted extraction**: strictly no-key, or
   optional env-gated? Never answered; blocks any P4 work.
