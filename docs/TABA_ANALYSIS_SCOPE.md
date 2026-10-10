> HISTORIC (2026-08-30): completed spec, kept as process record. P0–P3 shipped in `lib/tabaAnalysis.js` / `lib/takanonRights.js` (its own header says so). Its four still-open remnants were copied into `docs/LAUNCH_SCOPE.md` on 2026-08-30 so they are not lost. Do not cite as current.

# TABA Document Analysis — Scope (2026-07-26)

> Status: **P0–P3 implemented 2026-07-26** (`lib/tabaAnalysis.js`,
> `lib/takanonRights.js`, `GET /taba-analysis/:plan`, TABA-tab UI).
> P0 was adapted: government endpoints were unreachable from the dev
> sandbox, so instead of a live-plan fixture corpus, the shapefile path is
> tested against generated spec-correct binaries
> (`test/fixtures/buildMmgZip.js`) and the heuristics carry a **live
> calibration list**: (1) real mmg.zip layer names/attribute schemas per
> plan era, (2) Xplan layer ids + plan-number field names, (3) takanon
> Table-5 header vocabulary across producers. Run one analysis on a real
> address, then check `layersFound`/`notes` in
> `cache/taba-analysis/*.json` to calibrate.
> Companion to `AUDIT_2026-07-12.md`.
> Context: since PR #19 the pipeline fetches the plan list, real plan
> boundaries (via Meirim), and downloads plan documents (תקנון / תשריט /
> ממ"ג) to `cache/taba-docs/` — but **nothing ever opens them**. The
> documents are links in the UI, full stop. This scope defines the phase
> that reads them and turns plans into structured, mappable data.

## Goal

Make the app answer three questions it currently can't:

1. **What land-use designations (ייעודי קרקע) apply at and around the site?**
   As colored polygons on the TABA map, not as a PDF the user must open.
2. **What building rights does each plan grant?** FAR (אחוזי בנייה),
   coverage (תכסית), floors above/below, height, dwelling units — per
   designation, with a citation to the exact document and page.
3. **Which plans actually govern the site point?** Today the list shows
   every plan touching the gush; nothing marks the ones whose boundary
   contains the analyzed parcel.

The structured output is part of this app's data payload; anything a
consumer does with it downstream is outside this repo's scope.

## Source inventory, ranked by structure (use cheapest signal first)

| # | Source | What it gives | Coverage / caveats |
|---|---|---|---|
| 1 | **`mmg.zip` — already downloaded, never opened** | Per the מבא"ת standard these zips hold the plan's GIS entities as shapefiles: plan boundary (גבול תכנית), land-use polygons (ייעודי קרקע) with standard designation codes, lots (מגרשים). Structured + georeferenced (ITM, EPSG:2039). No OCR, no guessing. | Mavat-era plans (~2010s+). Older scanned plans have no mmg. Content varies by era — P0 inventories it. |
| 2 | **iplan Xplan ArcGIS REST** (`ags.iplan.gov.il/arcgisiplan/rest/services/PlanningPublic/Xplan/MapServer`) | Nationwide plan boundaries and land-use layers, queryable by bbox — the *compiled* current picture, independent of any single plan's zip. | Same ArcGIS query/discovery helpers as `index.js` already has. Fills the gap where a plan lacks mmg. Endpoint stability to be confirmed in P0. |
| 3 | **`takanon.pdf` text layer** | Modern takanons are born-digital with a canonical structure; **Table 5 (טבלת זכויות והוראות בנייה)** carries the quantitative rights per designation. Extract via `pdfjs-dist` text items with coordinates. | Hebrew RTL extraction returns visual-order text — reconstruct tables by x/y clustering, not string order. This is the gnarliest engineering in the scope. |
| 4 | **OCR / LLM fallback** for scanned pre-digital plans | tesseract (`heb` traineddata) or an env-gated Claude API extraction pass. | Expensive, lower confidence, and the LLM path breaks the repo's "no API keys" promise unless strictly optional. Deferred by default. |

## Architecture

- New module `lib/tabaAnalysis.js`. Per-plan results cached at
  `cache/taba-analysis/<plan>.json` — plan facts are
  **address-independent**, so the cache is shared across sites like
  `taba-docs/`, and versioned like `taba_index.json` (v2 pattern).
- **Stay out of the critical path.** The 4-minute load was just fixed;
  document parsing must not re-inflate it. Analysis runs lazily:
  - Launcher endpoint `GET /taba-analysis/:planNumber` — parses on first
    request, serves cache afterward.
  - The TABA tab requests it when a plan is selected (spinner in the
    detail panel), or the server warms the cache in the background
    *after* the `/run` response is sent.
- Site-level aggregation: mark plans whose boundary contains the site
  point (`governsSitePoint`), ordered by status/date. Present **facts
  per plan** — do *not* compute a merged "effective rights" number.
  Legally that requires reading amendment chains and repealed clauses;
  out of scope, and the UI carries a disclaimer saying so.

### Output schema (per plan)

```json
{
  "planNumber": "507-0123456",
  "version": 1,
  "analyzedAt": "2026-07-26T00:00:00Z",
  "confidence": "high | medium | low",
  "sources": ["mmg", "xplan", "takanon-text"],
  "boundary": { "type": "Polygon", "coordinates": [] },
  "landUse": [
    { "designation": "מגורים ד'", "code": "...",
      "geometry": { "type": "Polygon", "coordinates": [] },
      "areaDunams": 1.2 }
  ],
  "rights": [
    { "designation": "מגורים ד'", "farPercent": 180,
      "coveragePercent": 40, "floorsAbove": 9, "floorsBelow": 2,
      "heightM": 32, "units": 24,
      "source": { "doc": "takanon", "page": 17 } }
  ],
  "governsSitePoint": true
}
```

## Surfacing

- **TABA tab:** land-use overlay in standard mavat designation colors
  (toggleable); rights table in the detail panel with per-value document
  citations; a "חלה על המגרש" badge on governing plans; a confidence
  indicator when values came from OCR/heuristics.
- **Sidebar:** a "Planning rights" section — governing plans at the site
  point with their headline numbers.
- **Data payload:** per-plan analysis is served by `GET
  /taba-analysis/:plan`; the run payload itself stays unchanged.

## Phases & estimates

| Phase | Work | Estimate |
|---|---|---|
| **P0 — probe & fixtures** | From a network-enabled machine: pull 10–15 real plans across eras, inventory actual `mmg.zip` contents, confirm Xplan endpoints/layer ids, commit anonymized fixtures to `test/fixtures/`. Everything below is calibrated by this. | ½ day |
| **P1 — mmg.zip → geometry & designations** | Unzip (`unzipper`), read shapefiles (`shapefile`), reproject 2039→4326 (`proj4`), map designation codes, per-plan cache, `/taba-analysis` endpoint, land-use overlay + governing-plan badge in the tab. | 1½–2 days |
| **P2 — Xplan gap-fill** | Bbox query for boundaries/land-use where a plan has no mmg; reuses the existing ArcGIS helpers in `index.js`. | 1 day |
| **P3 — takanon Table-5 extraction** | `pdfjs-dist` text + RTL-aware table reconstruction; rights table in UI with page citations; fixture-driven tests per plan era. | 2–3 days |
| **P4 — scanned plans (optional)** | tesseract `heb` OCR and/or env-gated LLM extraction, confidence-flagged. | 2+ days, defer |

**P0–P3 total: ~5–6½ dev-days.** P1 alone already delivers the visible
win (real zoning colors on the map + "governs this parcel").

## Risks & mitigations

- **Hebrew/RTL PDF table extraction** — visual-order text, mixed
  digits/Hebrew. Mitigate with coordinate-based reconstruction and a
  fixture corpus per plan era; treat P3 numbers as suspect until the
  fixtures pass.
- **Old Tel Aviv plans are largely scans** — P1/P2 still yield
  designations from GIS even when the takanon is unreadable. Rights
  coverage will be partial; show "N/A — scanned takanon, open PDF"
  honestly rather than guessing.
- **New dependencies** (`unzipper`, `shapefile`, `proj4`, `pdfjs-dist`)
  are all pure-JS — the "no API keys, runs locally" promise survives
  through P3.
- **Legal accuracy** — per-plan facts with citations only, never a
  synthesized "you may build X m²". Disclaimer string in the UI.
- **Zip/PDF variance across eras** — the single biggest unknown; P0
  exists precisely to convert it from risk to data.

## Open decisions

1. Greenlight P0–P3? Include P4 now or defer?
2. Lazy per-plan endpoint (recommended) vs. inline in `runAnalysis`?
3. LLM-assisted extraction: strictly no-key, or optional env-gated
   (`ANTHROPIC_API_KEY` present → better extraction of messy docs)?
