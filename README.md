# Context Mapper

An urban site-analysis tool for architectural projects, focused on Israel
(and especially Tel Aviv). Give it a street address and it produces a
self-contained HTML dashboard about the surrounding area — streets,
buildings and their heights, trees, public transit, institutions,
demographics, elevation, land-registry blocks and statutory plans — plus
an explorable **3D city atlas** you can fly through in the browser.

Everything runs locally with Node.js. All data comes from free, public
sources (OpenStreetMap, data.gov.il, GovMap, Tel Aviv municipal GIS,
open elevation services) — **no API keys or accounts are needed**.

## Quick start

Requires Node.js 18 or newer.

```bash
npm install
npm start
```

`npm start` launches a small local web app at `http://localhost:3111`
(it opens your browser automatically). Type an address, pick it from the
suggestions, and the analysis runs with a progress bar; the finished
dashboard appears in the page. The dashboard's **3D View** button opens
the atlas centered on the analyzed site.

## Other ways to run it

| Command | What it does |
|---|---|
| `npm start` | Address picker + dashboard web app on port 3111 (recommended) |
| `npm run run` | One-shot analysis from the command line; writes `output/site_analysis.html` |
| `npm run atlas` | Build the city-wide Tel Aviv 3D atlas to `output/tel-aviv-atlas.html` |
| `npm run atlas:mock` | Same, but with an offline procedural test city (no internet needed) |

For the command-line analysis (`npm run run`), the address comes from
`config.json` — edit the `"address"` value there. If `config.json` is
missing, the default address at the top of `index.js` is used.

The 3D atlas is documented in detail in **[ATLAS.md](ATLAS.md)**
(controls, what's in the model, how to tune it).

## What's in the repo

| File / folder | Role |
|---|---|
| `launcher.js` | The web app: address picker, analysis endpoints, atlas serving |
| `index.js` | The analysis pipeline: fetches all data layers and builds the dashboard HTML |
| `atlas.js` | Builds the 3D atlas (downloads OSM data, generates the page); curated landmark list lives here |
| `atlas-template.js` | The atlas page itself: visuals, camera, UI |
| `config.json` | Address used by the command-line analysis |
| `ATLAS.md` | User guide for the 3D atlas |
| `docs/` | Reviews and reference material (not needed to run the tool) |
| `cache/`, `output/` | Created at runtime; ignored by git |

## Good to know

- **First runs are slower.** Downloaded map data is cached on disk
  (`cache/`), so repeat runs of the same area are much faster. The first
  atlas build can take 30–90 seconds.
- **Data is indicative, not surveyed.** Building heights use official
  data where available; buildings without height data get a plausible
  default. Treat the output as context, not as a measured survey.
- **The data sources are public services with fair-use limits.** If a
  layer occasionally fails or comes back empty, it is usually a
  temporary hiccup on the source's side — try again later.
- **Deployment:** the launcher respects the `PORT` environment variable,
  so it can run on hosts like Railway as-is.
