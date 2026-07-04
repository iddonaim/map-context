# Tel Aviv Atlas — explorable 3D city

An interactive 3D model of central Tel Aviv you can fly through in the
browser — real buildings, streets, the coastline and the Mediterranean,
with 25 curated landmarks, day/night modes, search, a guided tour and a
minimap. Inspired by the "SF Tech Atlas" style of explorable city pages.

## Two flavors

1. **City atlas** — `/atlas` with no parameters: central Tel Aviv,
   2.2 km radius, all curated landmarks.
2. **Site atlas** — `/atlas?lat=..&lon=..&r=..&label=..`: centered on an
   analyzed address. This is what the dashboard's **3D View** button
   shows: the searched site sits at the center with a red marker and a
   red ring at the analysis radius, plus any curated landmarks that
   happen to fall inside the area. The 3D world extends to about twice
   the analysis radius so it doesn't end at the site boundary.

Each site's atlas is cached separately (first build downloads its OSM
data once; subsequent opens are instant until the server restarts or
the weekly cache expires).

## How to open it

- **On the deployed app (Railway):** open `/atlas` (there is also a link
  at the bottom of the address-picker page). The **first** visit downloads
  the city data from OpenStreetMap and takes ~30–90 seconds; after that
  the page is cached and loads instantly.
- **Locally:** `npm start`, then open `http://localhost:3111/atlas`.
- **Without internet (test city):** `http://localhost:3111/atlas?mock=1`
  renders a procedural stand-in city so you can check the experience
  offline. It is clearly watermarked "MOCK DATA".
- **Force a fresh build** (e.g. after OSM edits or a config change):
  `/atlas?rebuild=1`. Downloaded OSM data is reused for a week
  (`cache/atlas-osm.json`); delete that file to force a re-download.

You can also generate the page from the command line:
`npm run atlas` (real data) or `npm run atlas:mock` (test city).
The result is written to `output/tel-aviv-atlas.html`.

## Controls

| Input | Action |
|---|---|
| Drag / scroll | Rotate / zoom (Orbit mode) |
| Right-drag or Shift-drag | Pan |
| **Orbit / Fly / Walk** buttons (or 1 / 2 / 3) | Camera modes |
| WASD | Move (Fly and Walk modes; Space/C = up/down in Fly) |
| Double-click | Fly to that spot |
| **N** | Day / night (night turns on windows + street lights) |
| **T** or ▶ | Guided landmark tour |
| **R** or ⌂ | Reset view |
| Search bar | Landmarks, neighborhoods, streets (English or Hebrew) |
| Minimap click | Jump there |

## What's in the model

- **Buildings** come from OpenStreetMap for a 2.2 km radius around the
  city center (roughly Rothschild ↔ Dizengoff). Heights use OSM data
  where tagged; buildings with no height data get a plausible 2–5 floor
  default, so the fine-grained fabric is indicative, not surveyed.
- **Landmarks** (Azrieli towers, Habima, Shalom Meir Tower, Dizengoff
  Square, Carmel Market, Neve Tzedek, etc.) are a curated list in
  `atlas.js`. Their coordinates are approximate and are snapped to the
  nearest OSM building at build time — worth a visual sanity check; if
  one sits on the wrong building, nudge its lat/lon in `LANDMARKS`.
- **Streets, parks, beach and coastline** are real OSM geometry; the sea
  is generated west of the coastline.

## Tuning

Edit the `CONFIG` block at the top of `atlas.js`:

- `center` / `radius_meters` — move or grow the covered area (bigger
  radius = more data to download and render; 2200 m is a good balance).
- `LANDMARKS` / `NEIGHBORHOODS` — the curated lists live right below it.

The page itself (colors, UI, camera behavior) is `atlas-template.js`.

## Technical notes

- Three.js is served locally from `node_modules` at
  `/vendor/three.module.js`, with a CDN fallback if the file is opened
  directly from disk.
- All buildings are merged into a single mesh (one draw call), so the
  page stays smooth on ordinary hardware even with tens of thousands of
  buildings. Night windows and street lights are point clouds.
- Everything is baked into one self-contained HTML file
  (`output/tel-aviv-atlas.html`) — it can be shared or hosted as-is.
