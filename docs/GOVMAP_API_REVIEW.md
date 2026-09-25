# GovMap API — what it changes for this project (2026-08-07)

Review of GovMap's published API documentation (<https://api.govmap.gov.il/docs/intro>)
against what **map-context** does today, with concrete options ordered
low → high on risk, effort and scope.

Companion to `LAUNCH_SCOPE.md` (this review closes out task **N0**) and
`AUDIT_2026-07-12.md`.

> **Sourcing caveat — read this first.** The review session could not open
> `api.govmap.gov.il` directly: every `govmap.gov.il` host is blocked by
> the sandbox's egress policy (HTTP 403 at the proxy on `api.`, `www.`,
> `ags.` and `open.` subdomains). The account below is reconstructed from
> search-engine summaries of the doc pages plus a third-party working
> integration (`yovavsanders/govmap` on GitHub) that calls the SDK for
> real. Everything marked **[verify]** should be confirmed by reading the
> docs from a normal network before any code is written against it. The
> one thing that is *not* second-hand is the failure on our side: the
> 404 from `ags.govmap.gov.il/arcgis/rest/services` was observed live on
> 2026-07-26 and is recorded in `LAUNCH_SCOPE.md`.

---

## 1. The headline: GovMap has no open ArcGIS REST tier, and N0 is chasing one

`index.js` treats GovMap as an anonymous Esri catalog:

```js
const GOVMAP_BASE = "https://ags.govmap.gov.il/arcgis/rest/services";
```

…then walks `?f=json` service and layer listings to find buildings and
cadastre. That URL is a hard 404, and `scripts/probe-sources.js` exists to
hunt for the "real" one across four host/casing variants.

The documentation says that hunt has no answer. GovMap publishes **three**
integration paths, and none of them is a public Esri REST catalog:

| # | Path | Auth | Runs where |
|---|---|---|---|
| 1 | **URL parameters** — deep-link the GovMap portal pre-configured with a center, zoom and visible layers | none | anywhere (a link) |
| 2 | **HTML embed** — the same URL-configured map inside a host page | none **[verify]** | browser |
| 3 | **`govmap.api.js` JavaScript SDK** — `createMap`, `geocode`, `searchAndLocate`, `searchInLayer`, `getLayerData`, `displayGeometries`, `getMapUrl`, `saveLayerEntities` | **token, bound to a domain** | browser |

The token constraint is the load-bearing detail: it is issued per domain
and, per the docs, *is not valid for use on another domain*. There is no
documented anonymous server-to-server tier at all.

**Consequences for us:**

- **The `govmap` slots in the provider chains are dead code**, not
  misconfigured code. `buildings: [govmap, telaviv-gis, osm]` and
  `registration/parcel-at-point: [telaviv-gis, govmap]` can never be won
  by GovMap at any URL, because the data is not exposed the way we ask
  for it. The cost per run is small (a 404 returns fast) but real, and it
  is silently misleading: the chain reports a fallback provider as if
  GovMap had merely come back empty.
- **N0 as scoped is a dead end.** "Run the probe from a network-enabled
  machine and pin the exact URLs" cannot succeed for the GovMap
  candidates. It remains worth running for the *other* candidates in
  `CANDIDATES` — `mapi.gov.il` (Survey of Israel), the municipal portals,
  and the Xplan inventory — which are ordinary open ArcGIS.
- **Anything we take from GovMap has to run in the browser**, with a
  token tied to the deployed domain. That is a genuine architecture
  decision, not a config change.

## 2. What the API actually offers that we don't have

Setting aside how to get it, four documented capabilities map directly
onto weak spots in the current pipeline:

- **`geocode` (`geocodeType.FullResult`)** — Israeli address geocoding,
  Hebrew-native, returning ITM (EPSG:2039) X/Y. We use Nominatim, which
  is the *only fatal dependency left in the run* ("Only geocoding remains
  fatal — nothing to show without a point", `LAUNCH_SCOPE.md`) and is
  weakest exactly where we need it: Hebrew street names, Israeli address
  conventions, new neighborhoods. Note `config.json` holds a full
  Nominatim result string — a symptom of how brittle that round-trip is.
- **`searchAndLocate`** — address → גוש/חלקה and גוש/חלקה → address.
  This is *precisely* our `fetchParcelAtPoint` step (TABA-A), which
  outside Tel Aviv finds nothing, so `gush` stays null, so TabaSearch is
  skipped, so the whole statutory-plan feature degrades. One documented
  call replaces a two-provider cadastre discovery chain.
- **`getLayerData(layerName, point{x,y}, radius)`** — entities within a
  radius of a point, with distance-to-point included, against national
  layers referenced by code (`PARCEL_ALL`, `PARCEL_HOKS`, `bus_stops`,
  `GASSTATIONS`, `NEIGHBORHOODS_AREA`, `KSHTANN_ASSETS`, … **[verify the
  full catalog]**). Point + radius is the exact shape of every query this
  tool makes.
- **`displayGeometries` / `getMapUrl`** — push our analysis geometry onto
  a GovMap map, and get a shareable URL back out.

`saveLayerEntities` (user-layer CRUD) also exists; nothing in this
project wants it.

## 3. Options, low → high

### Tier 0 — free wins: no token, no dependency, no new failure mode

**0a. "Open in GovMap" deep links.** The portal takes ITM coordinates
directly:

```
https://www.govmap.gov.il/?c=<ITM_x>,<ITM_y>&z=<level>&lay=<LAYER_CODE>
```

(confirmed shape, e.g. `?c=218053.84,751367.93&z=8&lay=CELL_ACTIVE`.)

We already carry `proj4` and the EPSG:2039 definition in
`lib/tabaAnalysis.js:36` — hoist that into a shared helper and the link is
a few lines. Put it in the dashboard header, on the גוש/חלקה line, and
next to each plan. Value is disproportionate to the effort: every Israeli
planner and architect cross-checks against GovMap anyway, and a
one-click jump to the same spot with the official cadastre layer on is
the fastest credibility signal this dashboard can carry.

*Risk:* none — an outbound hyperlink. *Effort:* ~1 hour. *Scope:* one
helper + three call sites.

**0b. Show ITM coordinates in the dashboard.** The GIS panel
(`index.js:2111`) already advertises "קואורדינטות ITM" as coming soon.
The same `proj4` helper from 0a delivers it. Israeli practice works in
ITM, not lat/lon.

*Risk:* none. *Effort:* ~30 min on top of 0a.

**0c. Retire or relabel the dead GovMap provider slots.** Either drop
`govmap` from the buildings and cadastre chains, or leave it with a
comment recording *why* it can't win (this document). Right now the code
reads as if a URL fix would light it up.

*Risk:* none — it never returns data today. *Effort:* ~20 min.
*Scope:* `index.js` chains + a `LAUNCH_SCOPE.md` correction to N0.

**0d. Re-scope N0 in `LAUNCH_SCOPE.md`.** Keep the probe for
mapi.gov.il / municipal / Xplan candidates; record the GovMap rows as
closed-not-found with the reason.

### Tier 1 — low risk, small effort, still no token

**1a. Embed GovMap as an inspector view.** Documented path #2: an iframe
of a URL-configured map, as a tab beside the Leaflet dashboard, centered
on the analyzed site with the cadastre layer on. Gives users official
parcel lines, zoning and infrastructure layers we will never replicate.

*Risk:* low, but not zero — a third-party iframe in our page; check
GovMap's terms of use and whether they set `X-Frame-Options`
**[verify]**. It also cannot be styled or read from without a token, so
it's a viewer, not a data source. *Effort:* ~half a day. *Scope:* one
dashboard tab.

**1b. Speak GovMap's vocabulary in the UI.** Where we show cadastre or
transit data, name the corresponding GovMap layer code. Makes our numbers
checkable against the official source, which is the whole trust argument
for this tool.

*Risk:* none. *Effort:* ~1 hour, once the layer catalog is confirmed.

### Tier 2 — medium: register a token, move some lookups into the browser

This is the tier with real payoff and real architectural consequence.

**2a. Get a domain-bound token** for the deployed domain (Railway today).
Local development on `localhost:3111` will need either a second token or
a documented fallback path **[verify whether localhost tokens are
issuable]** — assume they are not, and keep Nominatim as the dev path.

**2b. GovMap `geocode` as the first geocoding provider**, Nominatim as
fallback. The launcher's address picker is already the right place: it
runs in the browser, and `/analyze` already accepts a client-supplied
center precisely so a picked suggestion isn't re-geocoded
(`launcher.js:139`). So the SDK call slots in where the current
`/search` proxy result is consumed, and the existing "client provides
the point" contract carries it into the pipeline unchanged. This is the
single highest-value item in the review: it upgrades the one dependency
whose failure kills a run.

*Risk:* medium — token lifecycle, domain binding, an external SDK script
in the picker page, and a fallback path that must be tested by actually
breaking the primary. *Effort:* 1–2 days including the fallback.
*Scope:* picker page + `/search` semantics; the pipeline is untouched.

**2c. `searchAndLocate` for גוש/חלקה**, feeding the TABA chain. Same
browser-side pattern: resolve the parcel at pick time, post it with the
analysis request, let `fetchParcelAtPoint` accept a client-supplied
parcel and skip its discovery chain when one is present. This is what
makes statutory plans work nationally instead of Tel-Aviv-only.

*Risk:* medium — needs a new field on the `/analyze` contract and a
server-side path that still works when the client sends nothing.
*Effort:* 1–2 days. *Scope:* picker + `/analyze` + TABA-A.

### Tier 3 — high effort or high scope; recommend deferring

**3a. Move buildings/cadastre layer acquisition to GovMap via
`getLayerData`.** Nationally correct data, but it inverts the
architecture: layer fetching moves from Node (cached, paginated,
testable) into the browser (token-bound, per-session, rate-limited by
whatever the SDK enforces). It also fragments caching, which
`LAUNCH_SCOPE.md §4` is trying to consolidate. Only worth it if a
server-side arrangement with GovMap turns out to be possible — which the
public docs do not offer. Before spending here, price the alternative:
Survey of Israel (`mapi.gov.il`) national layers over the *existing*
ArcGIS code path, which needs no token and no re-architecture.

*Risk:* high. *Effort:* several days. *Scope:* the data layer.

**3b. `displayGeometries` + `getMapUrl` as a sharing feature** — push the
site boundary and analysis radius onto a GovMap map and hand back an
official shareable link. Genuinely nice; only sensible once 2a/2b have
already paid for the token and the SDK is loaded.

*Risk:* low once Tier 2 exists. *Effort:* ~1 day. *Scope:* new feature,
not a fix.

**3c. `saveLayerEntities` / GovMap user layers.** Publishing analyses as
GovMap layers. Not recommended — data-ownership questions, no user asked
for it.

## 4. Recommendation

1. **Do Tier 0 now** (0a–0d, half a day total). Deep links plus ITM
   coordinates are the best effort-to-value ratio in this document, and
   0c/0d stop the codebase and the plan from pointing at a door that
   doesn't open.
2. **Read the docs properly** from a normal network and settle every
   **[verify]** above — particularly the layer-code catalog, iframe
   embedding terms, and whether a localhost token is issuable.
3. **Then decide Tier 2 on the geocoder alone.** GovMap `geocode` +
   `searchAndLocate` fix the two things that most limit this tool outside
   Tel Aviv. If a token is obtainable for the deployed domain, that's the
   next real piece of work.
4. **Park Tier 3.** For national buildings and cadastre, price
   `mapi.gov.il` over the existing ArcGIS path first — same data lineage,
   no token, no re-architecture.

## Sources

- [Govmap API — הקדמה (intro)](https://api.govmap.gov.il/docs/intro)
- [פונקציות JavaScript](https://api.govmap.gov.il/docs/intro/javascript-functions)
- [יצירת מפה — createMap](https://api.govmap.gov.il/docs/javascript-functions/create-map)
- [geocode](https://api.govmap.gov.il/docs/javascript-functions/geocode)
- [חיפוש גוש/חלקה לכתובת — searchAndLocate](https://api.govmap.gov.il/docs/javascript-functions/search-and-locate)
- [קבלת מידע על בסיס מיקום — getLayerData](https://api.govmap.gov.il/docs/javascript-functions/get-layer-data)
- [חיפוש ישויות בשכבה — searchInLayer](https://api.govmap.gov.il/docs/javascript-functions/search-in-layer)
- [הוספת גאומטריות למפה — displayGeometries](https://api.govmap.gov.il/docs/javascript-functions/display-geometries)
- [קבלת URL של המפה — getMapUrl](https://api.govmap.gov.il/docs/javascript-functions/get-map-url)
- [פעולות על ישויות של שכבת משתמש — saveLayerEntities](https://api.govmap.gov.il/docs/javascript-functions/save-layer-entities)
- [GovMap portal (URL-parameter example)](https://www.govmap.gov.il/?c=218053.84,751367.93&z=8&lay=CELL_ACTIVE)
- [Working third-party SDK integration — yovavsanders/govmap](https://github.com/yovavsanders/govmap/blob/main/geocode.html)
