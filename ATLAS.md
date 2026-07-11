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
| **N** | Day / night (smooth transition; windows light up, street lamps glow) |
| **S** or ☀ | Sun & shadow study — pick a month and time of day, the sun and all shadows move to where the sun really is |
| **T** or ▶ | Guided landmark tour |
| **R** or ⌂ | Reset view |
| ✦ | Graphics quality (turns real-time shadows on/off; also drops automatically on slow devices) |
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

## Graphics

Everything is generated procedurally in the browser — no downloaded
textures or models:

- **Sun & shadows** — real-time soft shadows with filmic tone mapping;
  the shadow area follows the camera so shadows stay crisp up close.
- **Sun & shadow study (☀ / S)** — a panel with month and time-of-day
  sliders. The sun is placed by real solar geometry for the atlas'
  actual coordinates (Israel clock time, sunrise/sunset shown), so you
  can check e.g. what shades a site on a winter morning. Golden-hour
  light near sunrise/sunset, and the scene fades to night when the sun
  sets. Presets for the solstices and equinox.
- **Sky** — a shader sky dome: blue gradient with a sun by day; stars,
  a moon and a warm city glow on the horizon at night. Pressing **N**
  fades smoothly between them.
- **Building facades** — every building gets a procedural window grid
  (glass insets by day; at night a random half of the windows glow).
- **Sea** — animated ripples with a sun/moon glitter path.
- **Parks** get low-poly trees; major streets get glowing lamps at
  night; in Walk/Fly mode a small light travels with you after dark.

If the frame rate stays low for a few seconds, shadows and resolution
are reduced automatically (a toast appears; ✦ turns them back on).
You can also pin the quality with `/atlas?graphics=high` or
`?graphics=low`.

## Technical notes

- Three.js is served locally from `node_modules` at
  `/vendor/three.module.js`, with a CDN fallback if the file is opened
  directly from disk.
- All buildings are merged into a single mesh (one draw call), so the
  page stays smooth on ordinary hardware even with tens of thousands of
  buildings. The window grids are drawn inside the building material's
  shader, so they add no geometry; street lights are a point cloud.
- Everything is baked into one self-contained HTML file
  (`output/tel-aviv-atlas.html`) — it can be shared or hosted as-is.
