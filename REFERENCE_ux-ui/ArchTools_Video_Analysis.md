# ArchTools — Video Analysis & Claude Code Process Document

> **Companion to:** `ArchTools_Screenshot_Analysis.docx`  
> **Source:** 10-second interval parse of the ArchTools demo video (16:54 total runtime)  
> **Purpose:** Documents the *generative process* behind ArchTools — how it was built, orchestrated, and demonstrated. The screenshot analysis documents *what the tool contains*; this document explains *how it came to exist* and what that means for a Claude Code remake.

---

## CORRECTIONS TO THE SOURCE ANALYSIS

Three factual errors in the original video parse, resolved by cross-referencing the screenshots:

| # | Original Claim | Correction | Evidence |
|---|---|---|---|
| 1 | "Opening the macOS Finder" (14:00) | The file manager is **Windows Explorer** (Windows 11, dark theme) | Screenshot file manager chrome, breadcrumb UI, Windows-style icon set — unambiguous |
| 2 | "The agent creatively found secondary APIs when primary ones failed" (12:50) | The WAQI station is **7,952km from the subject location** — the reference city shown is Shanghai (上海). This is a silent data failure, not a creative solution | Screenshot 15:31:04 shows `上海 (Shanghai)` and station distance explicitly |
| 3 | "A random point in the middle of the city" | The main app analyzes **Hirkon 54, Tel Aviv-Jaffa**; ArchTools Live runs on **Bar Giora 26** — two different demo addresses | Screenshots show both addresses in respective app headers |

---

## THE GENERATIVE FRAME (What Screenshots Cannot Show)

The most important insight the video adds: **ArchTools is not a product. It is a Claude Code artifact.**

The screenshots document a polished multi-module analysis platform. The video reveals it was generated from a single prompt session with Claude Code running in YOLO mode (filesystem permissions set to bypass all confirmation prompts). This reframes every evaluation:

- A data accuracy flaw in a production SaaS = serious bug requiring a fix
- The same flaw in an auto-generated artifact = a calibration note for the next prompt iteration

For the Claude Code remake, the *prompt string* and *permission configuration* are the actual source code. Everything else is output.

---

## VIDEO TIMELINE: 10-SECOND INTERVAL PARSE

Annotations in **[brackets]** are cross-references to the screenshot analysis or remake notes not present in the original parse.

### Phase 1: Setup & Orchestration (00:00 – 01:40)

| Interval | Action / Dialogue | System Insight | Remake Note |
|---|---|---|---|
| 00:00–00:10 | Intro: Claude Code for architects | Sets the premise: agentic coding vs. conversational AI | The product category is "AI-generated tooling," not "SaaS app" |
| 00:10–00:20 | Hook: "science fiction for newcomers" | Paradigm shift: prompt-to-software, not prompt-to-text | Frame the remake for this audience |
| 00:20–00:30 | Reiterates unprecedented scope | Establishes automation scale | |
| 00:30–00:40 | UI switches from chat to the **Code execution tab** | Critical transition: conversational AI → filesystem-aware agent | The Code tab is the entry point; this is not a chat workflow |
| 00:40–00:50 | Selects local folder; sets **YOLO mode** (no permission prompts) | Autonomous ETL requires unrestricted read/write; YOLO mode prevents the pipeline from stalling on confirmations | **[REMAKE: Set `--dangerously-skip-permissions` or equivalent. Without this, every file write will pause execution]** |
| 00:50–01:00 | Tel Aviv chosen as target city | Selected for dense, accessible open-source municipal data — not arbitrary | **[REMAKE: Data availability is a prerequisite. Verify GovMap WFS, CBS GDB, and Overpass coverage before targeting a new city]** |
| 01:00–01:10 | Explains logic of picking a central urban point | Justifies the heavy data load required | |
| 01:10–01:20 | Selects a point mid-city to prove flexibility | The input is not hardcoded; any address triggers the same cascade | |
| 01:20–01:30 | Types exact address: **Bar Giora 26** | Single string input triggers the entire pipeline | **[NOTE: Main app in screenshots uses Hirkon 54 — this is the Live demo address]** |
| 01:30–01:40 | Submits prompt; CLI begins background processes | The CLI takes over; terminal logs become the primary feedback channel | |
| 01:40–01:50 | Warning: execution takes **20–40 minutes** | Heavy network I/O and sequential API queries | **[REMAKE: The bottleneck is TABA document downloading from guarded government portals — see Phase 6]** |

### Phase 2: Pipeline Scope Definition (01:50 – 03:40)

| Interval | Action / Dialogue | System Insight | Remake Note |
|---|---|---|---|
| 01:50–02:00 | Describes massive data-scraping scope | Agent acts as automated web-crawler and API consumer simultaneously | |
| 02:00–02:10 | Explains replacement of manual architectural prep | Direct pain point: site-analysis grunt work | |
| 02:10–02:20 | First agent step: **WGS84 coordinate resolution via Google Maps** | Text address → actionable geospatial coordinates | **[REMAKE: Geocoding is Stage 1 of Init. Use Google Geocoding API or Nominatim as fallback]** |
| 02:20–02:30 | Notes background process is mostly invisible terminal logs | "Black box" agentic execution | |
| 02:30–02:40 | Reveals prompt included instruction to **build a live progress UI** | Agent builds its own loading screen — maintains user trust during long runs | **[REMAKE: This is the ArchTools Live dark dashboard seen in screenshots. It is itself a Claude Code output, not a pre-built tool]** |
| 02:40–02:50 | Tracker shows stages, findings, and downloads in real time | Transparency layer for filesystem operations | **[REMAKE: The pipeline tracker must be generated early — before Stage 2 — so users see activity immediately]** |
| 02:50–03:00 | Cuts to pre-baked output to skip wait | Standard demo pacing | |
| 03:00–03:10 | No manual programming required to update code | Shift from imperative → declarative: describe what you want, not how | |
| 03:10–03:20 | "Do Z instead of XY" natural language updates | Codebase is fluid; updated via conversational commands | **[REMAKE: Iterate the prompt, not the code. Claude Code maintains context and updates logic permanently]** |
| 03:20–03:30 | Agent understands context and makes permanent logic updates | AI manages state and logic in background | |
| 03:30–03:40 | Reveals final result: a **4–5MB HTML file** | "Fat HTML" monolith architecture | **[See: FAT HTML ARCHITECTURE section below]** |

### Phase 3: Output Portability (03:40 – 04:20)

| Interval | Action / Dialogue | System Insight | Remake Note |
|---|---|---|---|
| 03:40–03:50 | Highlights portability: WhatsApp, offline mobile | Zero-backend deployment; infinitely shareable | **[REMAKE: HTML must be fully self-contained — no relative path references, no external CDN calls. All JS/CSS/data inline]** |
| 03:50–04:00 | Shows massive volume of injected functions in source | All JSON data is hardcoded into `<script>` tags | **[REMAKE: The data injection step is the final pipeline stage. JSON → HTML happens at Dashboard assembly]** |
| 04:00–04:10 | Addresses data credibility | UI must surface data origins for professional trust | |
| 04:10–04:20 | Shows hyperlinks embedded for every data point | Direct links to GovMap / Lamas validate each data claim | **[REMAKE: Every data table row needs a `verify` link. This is not cosmetic — it prevents the tool from being dismissed as AI hallucination]** |

### Phase 4: Dashboard & Map Tour (04:20 – 06:10)

| Interval | Action / Dialogue | System Insight | Remake Note |
|---|---|---|---|
| 04:20–04:30 | Dashboard tour: map with categorized functions | Master-detail layout; left-hand navigation pane | **[SCREENSHOT REF: Screenshots 15:27:23, 15:27:31 — two-panel dashboard with radar chart and bar chart]** |
| 04:30–04:40 | Socio-economic data from Lamas/CBS | Demographic arrays alongside spatial arrays | |
| 04:40–04:50 | Transitions to Interactive Map | Powered by **Leaflet.js** rendering local GeoJSON | **[CONFIRMED: "Leaflet | © CARTO" attribution visible in multiple screenshots]** |
| 04:50–05:00 | Lists GIS layers: borders, buildings, transport | Agent parsed raw shapefiles into web-ready GeoJSON vectors | **[SCREENSHOT REF: 908 buildings, 820 nature, 132 transport elements — see GIS Report summary]** |
| 05:00–05:10 | Toggles layers on/off | Accordion-style layer control widget | |
| 05:10–05:20 | Filters out registration blocks to isolate building footprints | Data isolation for modeling | |
| 05:20–05:30 | Zooms into detailed building geometry | High-fidelity vector rendering | |
| 05:30–05:40 | Live progress UI shows recursive map downloads | Agent uses **headless browser** to screenshot and stitch base maps at multiple zoom levels | **[REMAKE: This is NOT a standard tile API pull. The agent drives a headless browser to capture map tiles. Requires Playwright or Puppeteer dependency]** |
| 05:40–05:50 | Watches agent download maps at progressively tighter scales | Automated zoom-and-capture logic | **[SCREENSHOT REF: 6 tile variants downloaded — ESRI aerial + OSM at 3 zoom levels each]** |
| 05:50–06:00 | Progress UI pinpoints Bar Giora 26 | Visual confirmation geocoding succeeded | |
| 06:00–06:10 | Returns to fully baked HTML dashboard | Resumes feature tour | |

### Phase 5: The SVG Export Pipeline — Most Critical Technical Bridge (06:10 – 07:40)

> **This section is the most important for design technologists.** The video parse correctly identifies 06:10–07:10 as the critical technical bridge. The screenshot analysis missed the implication.

| Interval | Action / Dialogue | System Insight | Remake Note |
|---|---|---|---|
| 06:10–06:20 | Export feature: convert map state to PNG or SVG | Bridge between web data and computational design software | **[REMAKE: PNG for presentation; SVG for geometry. Both must be available. They serve entirely different downstream workflows]** |
| 06:20–06:30 | Clicks SVG export | Uses HTML5 Canvas / DOM-to-Image libraries | **[Leaflet confirmed → likely `leaflet-image` or `dom-to-image` for raster; custom SVG serialization for vectors]** |
| 06:30–06:40 | Opens raw SVG in presentation software | Proves the exported file's viability | |
| 06:40–06:50 | Scales and formats the SVG | Vectors maintain absolute crispness at any scale | |
| 06:50–07:00 | Aligns geometry on slide | Preparing for manipulation | |
| 07:00–07:10 | **Ungroups the vector array** | **Each building footprint becomes a distinct, selectable curve** | **[REMAKE: The SVG must be exported with each GeoJSON feature as a separate `<path>` element with its feature ID as an attribute. A flat/merged SVG is useless for computational design. This requirement should be explicit in the prompt]** |
| 07:10–07:20 | Manipulates individual buildings graphically | Confirms geometry is modular post-export | **[Downstream: direct Rhino/Grasshopper ingestion via SVG import → no manual CAD tracing required]** |
| 07:20–07:30 | Changes colors and line weights | Full aesthetic control | |
| 07:30–07:40 | Confirms roads, rails, pedestrian paths are all extractable | All spatial layers are SVG-exportable | **[REMAKE: Every GIS layer needs its own SVG export toggle, not just buildings]** |

### Phase 6: Advanced Features (07:40 – 09:30)

| Interval | Action / Dialogue | System Insight | Remake Note |
|---|---|---|---|
| 07:40–07:50 | Introduces **custom View Templates** | UI feature for saving specific layer combinations | **[SCREENSHOT REF: "Saved" filter chip visible in layer panels of multiple screenshots]** |
| 07:50–08:00 | Creates "Tree Canopies & Parks" template | Filters noise to focus on green infrastructure | |
| 08:00–08:10 | Types template name and saves | **Local state management within the HTML file** | **[REMAKE: State must persist in localStorage or be serialized into the HTML's own script data. No external DB]** |
| 08:10–08:20 | Template appears in sidebar for rapid toggling | Clean UX for managing complex layered data | |
| 08:20–08:30 | Opens Functions (Commerce/Services) tab | Shifts from polygon to Point of Interest (POI) view | **[SCREENSHOT REF: 13 POI categories, 143 food, 84 sports, 78 tourism — see Functions Report screenshots]** |
| 08:30–08:40 | Identifies specific local businesses | Data from OpenStreetMap Overpass API | **[CONFIRMED: Overpass API is primary; Google Places is secondary for named businesses]** |
| 08:40–08:50 | Parses residential vs. public building tags | Agent categorized OSM metadata tags | |
| 08:50–09:00 | Locates religious institutions; notes PDF export | Demonstrates categorical filtering depth | |
| 09:00–09:10 | Changes basemap background style | Enhances layer visibility per context | **[SCREENSHOT REF: CartoDB light/dark/color variants used in different map views]** |
| 09:10–09:20 | Reiterates: entire app is a 5MB local file | Technical achievement of the payload | |
| 09:20–09:30 | Emphasizes limitless offline manipulation | Data ownership is entirely local | |

### Phase 7: Statistics & Environment (09:30 – 12:30)

| Interval | Action / Dialogue | System Insight | Remake Note |
|---|---|---|---|
| 09:30–09:40 | Opens Lamas (CBS) Statistics Dashboard | Canvas-based chart rendering | **[REMAKE: Use Chart.js or Recharts — confirmed by screenshot chart toolbars]** |
| 09:40–09:50 | Compares neighborhood density to city average | Dual-axis data for instant contextual benchmarking | **[SCREENSHOT REF: 7,211–23,781 people/km² range across 184 statistical areas]** |
| 09:50–10:00 | Analyzes zero-car ownership metric | Derives narrative (youth/hotel area) from stats | **[SCREENSHOT REF: 84% renters, 40–46% car-free in coastal zone — confirmed in statistics screenshots]** |
| 10:00–10:10 | Briefly shows a sparse Real Estate tab | Acknowledges limitations with locked public data APIs | **[NOTE: Screenshots show a FULL Taba module — the "sparse" state is from an earlier/different run. The complete pipeline produces 41 plans, 91 documents]** |
| 10:10–10:20 | Opens Environment tab | Displays localized non-visual data grids | **[SCREENSHOT REF: 20 parks, 801 tree areas, 4 water bodies, AQI 61]** |
| 10:20–10:30 | Highlights extreme transportation noise metrics | Integrates abstract urban constraints into site profile | |
| 10:30–10:40 | Views raw GIS data grids (Excel-style) | Alphanumeric data behind the visuals | |
| 10:40–10:50 | Points to GovMap and OpenStreetMap links | The "Trust Layer" UX | |
| 10:50–11:00 | Every row maps to a verifiable source | Prevents AI hallucination perception by hard-linking to municipal servers | **[REMAKE: This is a non-negotiable UX requirement for professional credibility]** |
| 11:00–11:10 | Functions Report: hotel exactly 180m away | Agent ran geospatial distance formulas internally | **[REMAKE: Distance calc = Haversine formula, not Euclidean — the tool is working in lat/lon space]** |
| 11:10–11:20 | Checks proximity to public spaces | Proximity analysis per category | |
| 11:20–11:30 | Deep dive into Lamas 2022 Statistical Report | Most recent, heavy census blocks | |
| 11:30–11:40 | Bar chart: local vs. city-wide metrics | Clean visual hierarchy for complex data | |
| 11:40–11:50 | Spotlights renter vs. owner disparity | Critical context for residential planning | **[SCREENSHOT REF: 84% rental — dramatically above city average]** |
| 11:50–12:00 | Compares median incomes and academic degrees | Socio-economic footprint profiling | |
| 12:00–12:10 | Shows decile distributions | Complete demographic breakdown | |
| 12:10–12:20 | Links tabular data back to map visual | UX ties numbers to physical space | |
| 12:20–12:30 | Acknowledges need to refine prompts for Real Estate data | Iterative prompt engineering required for messy datasets | **[REMAKE: TABA scraping is the hardest module. Expect to iterate the scraping prompt 3–5 times]** |

### Phase 8: Environment Module & WAQI Data Issue (12:30 – 13:10)

| Interval | Action / Dialogue | System Insight | Remake Note |
|---|---|---|---|
| 12:30–12:40 | Environmental analysis: canopy cover | Green space as quantifiable metric | |
| 12:40–12:50 | Checks local air quality and pollutants | Micro-climate data integration | **[⚠️ DATA ACCURACY FLAG — see below]** |
| 12:50–13:00 | "Agent creatively found secondary APIs when primary ones failed" | Original parse frames this positively | **[⚠️ CORRECTION: The WAQI station used is 7,952km away — defaulting to Shanghai (上海). AQI 61 shown is NOT Tel Aviv air quality. This is a silent data failure, not a creative solution. REMAKE: Verify WAQI station proximity before trusting the reading. Require a maximum station distance threshold in the prompt — e.g., "only use WAQI data if nearest station is within 50km; otherwise mark as unavailable"]** |
| 13:00–13:10 | Confirms external environmental data source | Validates agent's search strategy | |

### Phase 9: TABA Module — The Hardest Scrape (13:10 – 14:50)

| Interval | Action / Dialogue | System Insight | Remake Note |
|---|---|---|---|
| 13:10–13:20 | Introduces statutory zoning (TABA) | Hardest data: legacy Israeli government portals | **[SCREENSHOT REF: 41 plans, 91 documents, 500 parcels, 10,611 dunams — plan format 507-XXXXXXX]** |
| 13:20–13:30 | Reveals 41 total plans, 24 with documents | Massive bureaucratic data synthesized instantly | |
| 13:30–13:40 | Shows sheer number of PDFs downloaded | Agent used MCP tool to navigate, click, and save files | **[REMAKE: This requires a browser-use MCP tool (Playwright-based). The MAVAT government portal does not have a clean API — it requires UI navigation]** |
| 13:40–13:50 | Live terminal shows a **missing GIS layer error** | System continues despite the error | **[REMAKE: Error resilience must be in the system prompt. Pattern: "If a data source fails, log the error, mark the section as unavailable, and continue to the next stage without crashing"]** |
| 13:50–14:00 | Pipeline continues despite the error | Robust error handling in the agent's system prompt | |
| 14:00–14:10 | Opens file manager to prove files exist on local drive | **[⚠️ CORRECTION: This is Windows Explorer, NOT macOS Finder as stated in the original parse]** | **[REMAKE: The project folder structure is: `/GIS_data`, `/HTML_דחות`, `/נתוני_נדל"ן`, `/נתוני_סביבה`, `/נתוני_סטטיסטי`, `/תבעות`, `/תמונות_רקע` + 4 JSON manifests]** |
| 14:10–14:20 | Scrolls through organized TABA PDFs | Agent acted as a structured file clerk | **[SCREENSHOT REF: Each of 41 plans gets its own folder named by plan number (507-XXXXXXX) containing 3 files: main PDF, K-suffix drawings, M-suffix regulations text + ZIP]** |
| 14:20–14:30 | Points out "Horot" (text regulations) files | Legal text separated from visual maps | **[The M-suffix PDFs in screenshots correspond to this — M = מסמכים/תקנות]** |
| 14:30–14:40 | Points out "Tasrit" (approved map) files | Visual zoning boundaries | **[The K-suffix PDFs — K = קונסטרוקציה/מפות (drawings/maps)]** |
| 14:40–14:50 | Local files piped into the HTML UI | HTML references local relative paths — maintains offline capability | **[REMAKE: The HTML must reference local relative paths for TABA PDFs, not absolute paths. Portability requires the entire project folder to travel with the HTML file]** |

### Phase 10: TABA UI & Conclusion (14:50 – 16:55)

| Interval | Action / Dialogue | System Insight | Remake Note |
|---|---|---|---|
| 14:50–15:00 | TABA map with overlapping translucent polygons | Complex spatial rendering by front-end library | **[SCREENSHOT REF: Yellow polygons for plan boundaries over cadastral grid — Leaflet.js layer rendering]** |
| 15:00–15:10 | Clicking a TABA polygon opens attached data | Geometry directly linked to legal restrictions | **[SCREENSHOT REF: Popup shows plan number, status, area (dunams), purpose code, parcel list, document links, MAVAT external link]** |
| 15:10–15:20 | Views specific zoning envelopes | Instant building rights context | |
| 15:20–15:30 | Creator reacts to the capability | Validates the "sci-fi" intro claim | |
| 15:30–15:40 | "Entirely replaces manual PDF hunting" | Core value proposition summary | |
| 15:40–15:50 | "Superior to standard slide presentations" | Live interrogatable database vs. static images | |
| 15:50–16:00 | Final thoughts on Claude Code | Transitioning to conclusion | |
| 16:00–16:10 | Live run is only 7 minutes in | Terminal process still running in background | **[SCREENSHOT REF: Screenshot at 15:32:21 shows ArchTools Live at 07:12 elapsed, 21% complete, in Functions stage]** |
| 16:10–16:20 | TABA document downloading is the major bottleneck | Scraping guarded government portals takes time | **[REMAKE: Consider async downloading for TABA — while PDFs download in background, continue to Statistics and Environment stages]** |
| 16:20–16:30 | Extreme runs can take 40+ minutes | Heavy data loads | |
| 16:30–16:55 | Conclusion, call to action, sign off | | |

---

## ARCHITECTURAL TAKEAWAYS FOR THE REMAKE

### 1. The Prompt IS the Source Code

The entire ArchTools codebase was generated from a single Claude Code session. For the remake:
- Version-control the **prompt**, not just the HTML output
- Updates are made by re-prompting, not by editing functions
- The system prompt must encode all business logic, error handling, and output format specifications

### 2. Dual-State Architecture

```
State 1 (Live)     →    State 2 (Artifact)
─────────────────       ──────────────────
ArchTools Live          ArchTools HTML
Real-time tracker       Compiled snapshot
Python/Node process     Fat HTML monolith
Network I/O active      Zero backend
Updates continuously    Intentionally "dead"
```

The sacrifice of live DB sync for absolute portability is a deliberate product decision, not a technical limitation. **Do not try to add a backend** — the offline-first architecture is the product's distribution moat.

### 3. The SVG Export as Computational Bridge

The most architecturally significant feature for a design technologist is the SVG pipeline. Requirements for the remake:

```
GeoJSON feature collection
        ↓
Leaflet.js renders to DOM
        ↓
SVG serializer (per-feature <path> elements)
        ↓
Each feature has: id, layer-type, category as SVG attributes
        ↓
Ungrouped SVG → direct Rhino/Grasshopper import
```

**If SVG features are merged into a single path, the export has zero value for parametric modeling.** This must be explicit in the generation prompt.

### 4. Required External Dependencies

| Dependency | Purpose | Stage |
|---|---|---|
| Google Geocoding API / Nominatim | Address → WGS84 coordinates | Stage 1 (Init) |
| Playwright / Puppeteer | Headless browser for tile capture + MAVAT navigation | Stage 2 (Maps) + Stage 9 (TABA) |
| Overpass API | All OSM feature queries (13 POI categories) | Stage 5 (Functions) |
| GovMap WFS | Israeli government spatial layers | Multiple stages |
| CBS GDB (local) | Census 2022 — 3,857 stat areas, 69 attributes, ITM EPSG:2039 | Stage 7 (Statistics) |
| Google Places API | Named business data (primary POI source for Israel) | Stage 5 (Functions) |
| WAQI API | Air quality — **requires proximity validation (≤50km)** | Stage 11 (Environment) |
| MAVAT portal | TABA urban plans — requires browser-use MCP, not API | Stage 9 (Real Estate) |
| Leaflet.js | Map rendering in final HTML | All map stages |

### 5. Error Handling Protocol (Must Be in System Prompt)

Based on the observed GIS layer failure at 13:40 that did not crash the pipeline:

```
For every data source:
  → Try primary source
  → On failure: log error with timestamp and source name
  → Mark the UI section as "Data unavailable — [source]"
  → Continue to next pipeline stage
  → Do NOT crash or halt execution
  → Surface all errors in a final "Data Quality" section of the dashboard
```

### 6. Performance Bottlenecks & Optimization Opportunities

The current sequential pipeline takes 20–40 minutes. Stages that could be parallelized:

```
Sequential (current):        Parallelizable (remake):
────────────────────         ────────────────────────
Maps → GIS → Functions  →    Maps ─┬─ GIS
  → Statistics → ...                ├─ Functions (POI)
                                     └─ Statistics
                             All three feed → their Reports simultaneously
                             TABA downloads run async in background throughout
```

### 7. The WAQI Fix

```
Current behavior:  Query WAQI → use nearest station regardless of distance
Required behavior: Query WAQI → check station distance
                   IF distance > 50km → mark AQI as "No local station data"
                   NEVER display a distant city's AQI as the subject site's reading
```

### 8. File System Schema (For Prompt Specification)

```
/[project-name]/
├── GIS_data/               ← Spatial layers (GeoJSON, shapefiles)
├── HTML_reports/           ← Generated HTML output files
├── real_estate_data/       ← Taba-related data
│   └── documents/
│       └── [507-XXXXXXX]/  ← One folder per plan
│           ├── [ID].pdf    ← Main plan document
│           ├── [ID]_K.pdf  ← Drawings/maps
│           ├── [ID]_M.pdf  ← Regulatory text
│           └── [ID].zip    ← All bundled
├── environment_data/       ← Environmental layers
├── statistics_data/        ← CBS census data
├── background_tiles/       ← Downloaded base maps (6 variants)
├── data_index.json         ← Master data manifest (~47KB)
├── index.json              ← Project index
├── progress_status.json    ← Pipeline status tracker
└── project_details.json    ← Address, coordinates, settings
```

---

## CROSS-REFERENCE INDEX

For each topic, which document has the deeper analysis:

| Topic | Screenshot Analysis | This Document |
|---|---|---|
| Data source details (CBS attributes, GovMap WFS specifics) | ✅ Primary | Reference only |
| Pipeline stage durations and counters | ✅ Primary | Reference only |
| UI component behavior (tooltips, layers, charts) | ✅ Primary | Reference only |
| Generative process (how Claude Code built this) | ❌ Not visible | ✅ Primary |
| YOLO mode / permission configuration | ❌ Not visible | ✅ Primary |
| SVG → CAD computational bridge | Partial | ✅ Primary |
| Error resilience mechanism | Observed only | ✅ Explained |
| Headless browser tile capture | Guessed | ✅ Confirmed |
| WAQI data accuracy issue | ✅ Flagged (screenshot evidence) | ✅ Fix specified |
| OS identification (Windows, not macOS) | ✅ Confirmed | Corrected from video |
| Dual-address discrepancy (Hirkon 54 vs Bar Giora 26) | ✅ Noted | Corrected from video |
| File naming conventions (K/M suffix, gush/chelka) | ✅ Primary | Reference only |
| Parallelization opportunity | ✅ Flagged | ✅ Specified |
| Remake prompt requirements | ❌ | ✅ Primary |
