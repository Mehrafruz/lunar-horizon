# CLAUDE.md — Lunar Horizon (NASA Space Apps 2026, "Lunar Landing Site Navigator")

## Goal (read first)

A **public web page** (GitHub Pages, no login, no install) that lets mission planners, teachers and
the public answer: **"If we land at site X at time T — when do we have sunlight (power) and Earth in
view (direct link)? And if the launch slips, which site and day are best now?"**

Judges only see the project page, a ≤30 s video and the public link. The link must open in any browser.

Team: Mehr (developer, works with Claude Code) and her husband (video, project page).
Deadline: **Sun 15 Nov 2026, 23:59 Dushanbe time (UTC+5)**. Our own hard stop: **Sun 20:00**.

## Rules that affect the repo

- Code is written during the hackathon (from 14 Nov). Everything in the repo is in **English**.
- AI use must be visible: header comment in every file written with AI
  (`// Written with assistance from Claude Code (Anthropic).`, Python `#`), a "Use of AI" section in README,
  and a `source` field in every JSON data file.
- README → "References": every dataset, library, paper and site link.
- No NASA logos, flags or mission insignia. No photos/voices of children.

## Priorities — in this order. Do not start a step before the previous one is done.

| # | Step | Done when | Target (Dushanbe) |
|---|------|-----------|-------------------|
| 1 | **Port the prototype** to plain HTML/CSS/JS in `/docs`, smooth Moon only, deploy to GitHub Pages | The public URL works on a phone and a laptop | Sat 14:00 |
| 2 | **Horizons check** script + saved outputs | 12 checks pass (table below) | Sat 17:00 |
| 3 | **LOLA horizon masks** for all polar sites + tests | All mask tests pass | Sat 23:00 |
| 4 | **Terrain in the page**: toggle "Smooth Moon / LOLA terrain", default LOLA where a mask exists | Calendar and sky view use masks; README explains limits | Sun 12:00 |
| 5 | Polish, README, About/Data section | Feature freeze | Sun 14:00 |
| — | Husband: video (≤30 s), project page text | Submitted | Sun 20:00 |

**Stop rules.** If a step blocks for more than 60 min, stop and tell Mehr. If step 3 is not done by
Sun 10:00, ship smooth Moon only and say so honestly on the page (it already does).
Never invent data or tune code to match expected numbers. Never add a placeholder terrain.

## Repository layout

```
/docs/                 GitHub Pages root (Settings → Pages → branch main, folder /docs)
  index.html  app.js  sky-core.js  style.css
  data/ephemeris.json  data/sites.json
/pipeline/             Python 3 (numpy, requests, jplephem, de421)
  ephemeris_de421.py   (given) DE421 table, cross-check and fallback
  horizons_check.py    query JPL Horizons, compare with sky-core results
  lola_masks.py        horizon masks from LOLA DEM
  tests/
/reference/            given: prototype-v2.dc.html (design reference), eph_2026_2030.json
README.md  LICENSE (MIT)  CLAUDE.md
```

## Given files (already written, during the hackathon, with AI help)

- `web/sky-core.js` → move to `docs/sky-core.js`. **The single source of truth for all geometry.**
  Do not rewrite the maths elsewhere. Functions: `frame, vec, azel, discFrac, dip, maskAt,
  computeSite, scoreTable, landingScore, hoursToCrossing, longestRun`.
- `pipeline/ephemeris_de421.py` → makes `docs/data/ephemeris.json`
  (`{source, start, stepH, sLat[], sLon[], eLat[], eLon[], eKm[]}`, 15 Nov 2026 – 31 Dec 2030, 3 h step, ~410 KB).
  Run it: `pip install numpy jplephem de421 && python pipeline/ephemeris_de421.py docs/data/ephemeris.json`.
  The result must equal `reference/eph_2026_2030.json` except the `source` string.
- `reference/prototype-v2.dc.html` — the agreed design. It is a "Design Component" file
  (template with `{{holes}}`, `<sc-for>`, `<sc-if>`, logic in `renderVals()`). Port the **layout, text and
  behaviour** to plain HTML + JS; do not try to run this file.

## Conventions

UTC only. Latitude south negative, longitude east positive (−180…180). Moon sphere R = 1737.4 km.
Azimuth from local north, clockwise. Elevation above the local horizontal plane.
Sun "up" = disc centre above the horizon (= half the disc visible). Earth "usable" = centre ≥ threshold
(0/2/5°, default 2°) above the horizon. Observer (panel/antenna) 2 m above the ground.
Time base comes from the JSON (`start`, `stepH`); never hard-code it.

## Step 1 — the page (port of the prototype)

Sections, top to bottom (see the prototype):
1. Header + amber notice "Smooth-Moon preview … terrain not yet included" (change text in step 4).
2. Scenario bar: site, landing date ‹ ›, touchdown time (00–21 UTC, 3 h), mission length (1–30 d), Earth threshold 0/2/5°.
3. Sky view (SVG): centred on the mean Earth azimuth for |lat| > 60°, else on S/N; auto vertical scale with
   the factor printed, "True scale" button; Sun/Earth at real angular size, dashed outline when below the
   horizon; dashed paths for the mission; break paths at the ±180° seam. Play/pause + slider (`input` event).
   Two lanes (Sun, Earth) for the mission. Readout cards: Sun elevation (big), azimuth, % of disc, countdown;
   Earth elevation, azimuth, countdown; mission summary (at touchdown, unbroken Sun+Earth from touchdown,
   total, longest darkness, longest time without Earth).
4. Delay calendar: rows = sites, 90-day window with ‹ › by 30 days, week overview strip to Dec 2030.
   Cell colour = `landingScore` (5-step ramp; "down at touchdown" = dark cell with outline). Hover/focus shows a
   readout line; click selects; one tab stop with arrow keys. **Draw cells on a `<canvas>`** (DOM buttons are slow).
5. "Check against JPL Horizons" table (computed live) + links: JPL Horizons, LROC Quickmap, NASA Moon Trek,
   CSA Moon exploration. "Use of AI" line.
6. Add your own point (lat/lon), "Why" cards.

Performance: cache `computeSite` per site and `scoreTable` per (site, threshold); never rebuild the
calendar on a play tick. Show an error if a data file fails to load.

Sites (`docs/data/sites.json`, each with a source):

| id | name | lat | lon E | tag / source |
|----|------|-----|-------|--------------|
| im2 | IM-2 Athena | −84.7906 | 29.1957 | Landed 2025 · NASA CLPS — lroc.im-ldi.com/images/1408 |
| im1 | IM-1 Odysseus | −80.13 | 1.44 | Landed 2024 · NASA CLPS — lroc.im-ldi.com/images/1360 |
| malapert | Malapert Massif | −86.0 | 0.3 | Artemis region, our point (LROC NAC ROI mosaic centre) |
| haworth | Haworth | −86.75 | −23.67 | Artemis region, our point |
| nobile2 | Nobile Rim 2 | −83.9 | 58.7 | Artemis region, our point |
| degerlache | de Gerlache Rim 2 | −88.5 | −66.7 | Artemis region, our point (low confidence) |
| bussey | Most-illuminated point | −88.74 | 124.5 | Bussey et al. 2010, Icarus 208:558 (~86% sunlit) |
| ch3 | Chandrayaan-3 | −69.3741 | 32.32 | Landed 2023 · ISRO — lroc.im-ldi.com/images/1314 |
| a11 | Apollo 11 | 0.67416 | 23.47314 | Landed 1969 — lroc.im-ldi.com/images/938 |

Mehr may adjust Artemis points in Quickmap. NASA published no region centres; say "our point".
Artemis III is now an Earth-orbit test (2027); first landing planned for Artemis IV (2028). Don't call these "Artemis III sites".

## Step 2 — Horizons check (`pipeline/horizons_check.py`)

Query `https://ssd.jpl.nasa.gov/api/horizons.api` with `COMMAND='10'` (Sun) and `'399'` (Earth),
`CENTER='coord@301'`, `COORD_TYPE='GEODETIC'`, `SITE_COORD='<lon>,<lat>,0'`, `EPHEM_TYPE='OBSERVER'`,
`QUANTITIES='4'`, `APPARENT='AIRLESS'`, `ANG_FORMAT='DEG'`, `TLIST` = the dates below.
Compare with `computeSite` (h0 = 0, observer 0 m) on the same data. Save raw responses to `pipeline/horizons_out/`.

- Sites: (−84.8, 29.2) and (−88.74, 124.5). Dates: 2026-12-21 00:00, 2027-03-10 06:00, 2027-06-01 12:00,
  2028-02-15 18:00, 2029-09-30 03:00, 2030-12-01 00:00 (all on the 3 h grid).
- Pass: |Δaz|, |Δel| ≤ 0.02° for every pair. Known: 2026-12-21 at (−84.8, 29.2) → Horizons Sun 7.448/6.419,
  Earth 324.155/10.555; ours 7.454/6.419 and 324.155/10.555.
- Put the results table in README and on the page.

## Step 3 — LOLA horizon masks (`pipeline/lola_masks.py`)

DEM: `https://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG/LDEM_75S_240M.IMG` (29,062,688 bytes = 3812²×2;
label `.LBL` next to it). Little-endian int16, height m = DN × 0.5 above the 1737.4 km sphere.
Polar stereographic centred on −90°, 240 m/px, lon 0 points up. lat/lon → pixel (0-based):
`r = 2·R·tan((90 − |lat|)/2)` (R in m), `x = r·sin(lon)`, `y = r·cos(lon)`,
`col = x/240 + N/2 − 0.5`, `row = −y/240 + N/2 − 0.5`, N = 3812.
(The forward formula in the PDS catalog DSMAP_POLAR.CAT mirrors longitude; use these.)

Mask per site: observer at DEM height + 2 m (bilinear). Azimuth step **0.25°** (1440 values).
March along each ray from 1 px to the map edge in 0.5 px steps, **bilinear** heights, exact 3-D geometry on
the sphere, keep the max elevation angle. Ray direction in map coords: north = (sin lon, cos lon),
east = (cos lon, −sin lon); rows grow downward. Sites north of −75° get no mask (smooth Moon, say so).

Tests (`pipeline/tests/`, all must pass before step 4):
1. Flat DEM (all zeros) → every value ≈ −0.0869° (2 m dip).
2. Round trip lat/lon → pixel → lat/lon within 1 m.
3. Shackleton centre (−89.67, 129.78) is ≥ 3.5 km below the mean of a 10 km ring around it; from it the mask is ~15–25° all round.
4. Direction: from (−89.682, −163.37) the IM-2 site lies at azimuth 191.85°, 167.4 km. A synthetic 1 km bump
   placed there must show up in that site's mask at 191.85° ± 0.5° (with mirrored longitude it would be ~136.6°).
5. Hillshade of the DEM compared by eye with Quickmap (save `pipeline/out/hillshade.png`).

Output: `sites.json` gains `h0_m` and `mask_deg` (1440 floats, 2 decimals) + `mask_source`.
Optional, only if time: compare Sun % at 2–3 sites with NASA PGDA product 69 (average illumination,
https://pgda.gsfc.nasa.gov/products/69) and state the different time spans.

## Step 4 — terrain in the page

Pass `mask_deg` to `computeSite`. Toggle "LOLA terrain (240 m) / Smooth Moon". Draw the terrain silhouette in the
sky view. Update the notice: "Terrain from LOLA 240 m: near-field ridges under ~500 m are not resolved;
times can be off by several hours." Do not claim agreement with papers unless step 3's optional check was done.

## Working with Mehr

- Small steps; run the page locally (`python -m http.server -d docs`) after each change.
- Show numbers before moving on (step 2 table, step 3 test output).
- Ask before adding any dependency. No frameworks, no build step.
- Do not commit or push unless Mehr asks.
- Keep README current: what it does, live URL, how to run the pipeline, data sources, limits, Use of AI, References.
