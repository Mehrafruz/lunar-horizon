# Lunar Horizon

A web page for the NASA Space Apps Challenge 2026, challenge **Lunar Landing Site Navigator**.

**Live page: https://mehrafruz.github.io/lunar-horizon/**

Pick a landing site and a landing time on the Moon. The page shows when you have sunlight (power) and
Earth in view (direct link), and which site and day are best if the launch slips.

## What it does

- **Sky view** — Sun and Earth over the local horizon, with the terrain skyline, for every 3 hours of the mission.
  Earth is drawn with its phase as seen from the site.
- **Terrain in 3D** — 38 × 38 km of LOLA terrain around each polar site, lit from the Sun's direction at the
  chosen time, with arrows to the Sun and Earth. Drag to turn, scroll to zoom.
- **Readouts** — Sun and Earth elevation and azimuth, share of the solar disc visible, time to the next rise or set.
- **Delay calendar** — sites × landing dates. Colour = how long Sun and Earth stay up together, unbroken, from touchdown.
- **Your own point** — any latitude and longitude (smooth Moon).
- **Horizon switch** — "LOLA terrain (240 m)" or "Smooth Moon".

No install, no login, no build step: plain HTML, CSS and JavaScript in `/docs`. The 3-D view loads three.js
from jsDelivr when you scroll to it; everything else works without it.

## Run it locally

```bash
python3 -m http.server 8000 -d docs
```

Then open http://localhost:8000.

## Data pipeline

Python 3 with `numpy`, `jplephem`, `de421`.

```bash
python3 -m venv .venv && .venv/bin/pip install numpy jplephem de421

# 1. Sun and Earth positions, 15 Nov 2026 – 31 Dec 2030, every 3 h
.venv/bin/python pipeline/ephemeris_de421.py docs/data/ephemeris.json

# 2. Check against JPL Horizons (standard library only)
python3 pipeline/horizons_check.py

# 3. Terrain: download the LOLA elevation model (29 MB, not in the repository), then compute horizon masks
.venv/bin/python pipeline/lola_masks.py --download
.venv/bin/python pipeline/lola_masks.py
.venv/bin/python pipeline/lola_masks.py --patches     # terrain around each site for the 3-D view
.venv/bin/python -m unittest discover -s pipeline/tests -v
```

| File | What it is |
|---|---|
| `docs/sky-core.js` | All geometry: azimuth, elevation, horizon, landing score |
| `docs/app.js` | Page state and drawing |
| `docs/terrain3d.js` | 3-D terrain view (three.js) |
| `docs/data/ephemeris.json` | Sub-solar and sub-Earth points and Earth distance (DE421) |
| `docs/data/sites.json` | Sites, with ground height and a 1440-value horizon mask for sites south of 75°S |
| `docs/data/terrain/<id>.json` | Heights around each polar site (161 × 161, 240 m apart) for the 3-D view |
| `docs/data/horizons_check.json` | Result of the Horizons check |
| `pipeline/horizons_out/` | Raw Horizons answers |
| `pipeline/out/hillshade.png` | Shaded relief of the elevation model, to compare by eye with Quickmap |

## Conventions

UTC only. Latitude south negative, longitude east positive. Moon sphere radius 1737.4 km.
Azimuth from local north, clockwise. Elevation above the local horizontal plane.
The Sun is "up" when the centre of its disc is above the horizon. Earth is "usable" when its centre is at
least 0°, 2° or 5° (you choose; default 2°) above the horizon. The observer is 2 m above the ground.

## Check against JPL Horizons

Two points, six dates, observer on the surface (0 m), smooth Moon. Pass = every azimuth and elevation
within 0.02° of Horizons. All 12 checks pass; the largest difference is 0.006°.

| Site | UTC | Sun az H / ours | Sun el H / ours | Earth az H / ours | Earth el H / ours | max \|Δ\| |
|---|---|---|---|---|---|---|
| A | 2026-12-21 00:00 | 7.448 / 7.454 | 6.419 / 6.419 | 324.155 / 324.155 | 10.555 / 10.555 | 0.0057 |
| A | 2027-03-10 06:00 | 123.317 / 123.322 | -3.607 / -3.608 | 324.887 / 324.887 | 9.261 / 9.262 | 0.0052 |
| A | 2027-06-01 12:00 | 188.140 / 188.145 | -6.532 / -6.532 | 323.549 / 323.550 | 10.255 / 10.255 | 0.0051 |
| A | 2028-02-15 18:00 | 267.994 / 268.000 | -0.876 / -0.875 | 338.290 / 338.290 | -2.187 / -2.186 | 0.0056 |
| A | 2029-09-30 03:00 | 243.248 / 243.254 | -0.805 / -0.805 | 324.507 / 324.508 | 4.093 / 4.093 | 0.0059 |
| A | 2030-12-01 00:00 | 79.930 / 79.936 | 0.866 / 0.865 | 337.777 / 337.777 | 11.284 / 11.284 | 0.0053 |
| B | 2026-12-21 00:00 | 272.075 / 272.081 | 1.309 / 1.308 | 229.215 / 229.216 | 5.501 / 5.501 | 0.0057 |
| B | 2027-03-10 06:00 | 28.180 / 28.185 | 0.367 / 0.367 | 229.891 / 229.891 | 4.183 / 4.183 | 0.0053 |
| B | 2027-06-01 12:00 | 92.758 / 92.763 | -1.445 / -1.445 | 228.607 / 228.607 | 5.224 / 5.224 | 0.0051 |
| B | 2028-02-15 18:00 | 172.620 / 172.625 | -1.940 / -1.940 | 242.982 / 242.982 | -7.587 / -7.587 | 0.0056 |
| B | 2029-09-30 03:00 | 147.990 / 147.996 | 0.467 / 0.467 | 229.329 / 229.330 | -0.967 / -0.967 | 0.0059 |
| B | 2030-12-01 00:00 | 344.590 / 344.596 | 1.169 / 1.169 | 242.665 / 242.665 | 5.883 / 5.883 | 0.0053 |

A = 84.8°S 29.2°E, B = 88.74°S 124.5°E. Our Sun azimuth is larger than Horizons by about 0.0055° at every
point. Horizons gives apparent positions, our ephemeris is geometric: adding light-time and aberration of light
(about 0.0057°) to our Sun direction removes the offset (checked once with a script outside the repository).

This check covers the directions to the Sun and Earth on a smooth Moon only, not the terrain horizon.
`pipeline/horizons_check.py` compares Horizons with values copied from `sky-core.js` into the script; the
table on the page recomputes our side live in the browser.

## Terrain

For each site south of 75°S, `pipeline/lola_masks.py` walks along the great circle of each of 1440 azimuths
in 120 m steps to the edge of the map, reads the height bilinearly and keeps the highest elevation angle.

For the 3-D view, `--patches` resamples the same model on a 161 × 161 grid around each site (240 m apart),
as heights above the site's horizontal plane, so the Moon's curvature is included. Seen from the site, the
horizon of that patch never rises above the full mask, and a patch mirrored east–west would (checked once
for IM-2: 541 of 1440 directions).

Tests (`pipeline/tests/`): a flat map gives the 2 m dip (−0.0869°) in every direction, and a flat patch
follows the sphere; latitude/longitude →
pixel → latitude/longitude returns to the same point; the centre of Shackleton crater is 3.9 km below a
10 km ring around it and sees a 20–24° horizon all round; a synthetic hill at the IM-2 site appears at the
right azimuth (191.85°) and height from a point near the pole 167 km away. That hill is a 20 km block: a 1 km
hill at that distance is hidden below the horizon by the Moon's curvature (the test checks this too).
The Shackleton and hillshade tests need the downloaded elevation model and are skipped without it.

## Limits

- **240 m elevation model.** Near-field ridges under ~500 m are not resolved; rise and set times can be
  off by several hours.
- **Terrain north of 75°S is not included.** Chandrayaan-3, Apollo 11 and points you add use a smooth Moon.
  The calendar marks those rows.
- **3-hour time step.** Rise and set times between samples are interpolated.
- **"Most-illuminated point".** Bussey et al. (2010) report about 86% sunlit for a point near this site. At the
  coordinates we use (88.74°S 124.5°E) our LOLA masks give the Sun's centre above the horizon for 60% of
  Nov 2026 – Dec 2030, and the label on the page says so. The highest pixel of the 240 m model within 3 km
  (88.807°S 123.637°E, 2.1 km away) gives 86%. We did not move the point. The paper used Kaguya topography,
  not LOLA, so we do not claim agreement with it.
- **Each site is one point, not a region.** Near ridges, a point a few hundred metres away can see a quite
  different horizon, so a row in the calendar describes that point only. The Bussey point above shows how large
  the difference can be.
- **3-D view.** Only terrain inside the 38 km square casts shadows there; the Sun and Earth figures elsewhere on
  the page use the whole horizon to the edge of the map. Arrows and Sun/Earth markers are not to scale.
- **Line of sight only.** Ground-station schedules, relay satellites, slopes, shadows on the lander itself
  and thermal limits are not modelled.
- **Artemis points are ours.** We did not find published centre points for the candidate regions.

## Use of AI

This project was built during the hackathon with Claude and Claude Code (Anthropic). AI wrote the page
(`docs/`, including the 3-D view), the calculation core, the ephemeris script, the Horizons check and the terrain script and tests,
and drafted this README. Site coordinates were researched with AI help and checked against LROC
landing-site images. Every file written with AI says so in its first lines, and every JSON data file has a
`source` field. The team chose the question, the sites and the design, and reviewed the results.

## References

Challenge resources:

- LROC Quickmap — https://quickmap.lroc.asu.edu/
- NASA Moon Trek — https://trek.nasa.gov/moon/
- JPL Horizons System — https://ssd.jpl.nasa.gov/horizons/ (API: https://ssd.jpl.nasa.gov/api/horizons.api)
- Canadian Space Agency, Moon exploration — https://www.asc-csa.gc.ca/eng/astronomy/moon-exploration/

Data:

- JPL DE421 planetary and lunar ephemeris, via the `de421` Python package.
- NASA LRO LOLA gridded data record `LDEM_75S_240M` (data set LRO-L-LOLA-4-GDR-V1.0, product V2.0) —
  https://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG/
- NAIF lunar frames kernel `moon_080317.tf` (principal-axis to Mean-Earth rotation for DE421).
- LROC landing-site images: IM-2 https://lroc.im-ldi.com/images/1408, IM-1 https://lroc.im-ldi.com/images/1360,
  Chandrayaan-3 https://lroc.im-ldi.com/images/1314, Apollo 11 https://lroc.im-ldi.com/images/938

Papers:

- Bussey, D. B. J., et al. (2010). Illumination conditions of the south pole of the Moon derived using Kaguya
  topography. *Icarus* 208, 558.

Libraries: `numpy`, `jplephem`, `de421` (pipeline only). Fonts: Inter and Space Grotesk (Google Fonts).
The page uses one JavaScript library, three.js (MIT licence, https://threejs.org/, version 0.160.0 from
https://cdn.jsdelivr.net/npm/three@0.160.0/), for the 3-D terrain view only.
