#!/usr/bin/env python3
# Written with assistance from Claude (Anthropic) during NASA Space Apps 2026 (14 Nov 2026).
"""
Step 2 — check our Sun/Earth positions against NASA JPL Horizons.

Asks the official Horizons API for the apparent (airless) azimuth/elevation of the Sun (10) and
Earth (399) seen from 2 points on the Moon at 6 dates, and compares them with what our page
computes (sky-core.js computeSite, DE421 table, observer at 0 m).

Run from the repository root (Python 3 standard library only, no pip install):
    python3 pipeline/horizons_check.py

Writes:
    pipeline/horizons_out/<site>_<body>_<date>.txt   raw Horizons answers (kept as evidence)
    docs/data/horizons_check.json                    table shown on the page
Prints a Markdown table. Pass = |d_az| and |d_el| <= 0.02 deg for all 48 values (12 checks x 4 angles).
"""
import json, os, sys, time, urllib.parse, urllib.request

API = "https://ssd.jpl.nasa.gov/api/horizons.api"
TOL = 0.02
OUT_DIR = os.path.join("pipeline", "horizons_out")
OUT_JSON = os.path.join("docs", "data", "horizons_check.json")

SITES = {"A": (-84.8, 29.2, "near IM-2 Athena"), "B": (-88.74, 124.5, "most-illuminated point (Bussey 2010)")}
DATES = ["2026-12-21 00:00", "2027-03-10 06:00", "2027-06-01 12:00",
         "2028-02-15 18:00", "2029-09-30 03:00", "2030-12-01 00:00"]

# Our values, copied here by hand (not recomputed by this script): node, sky-core.js computeSite(E, {lat, lon}, 0) on docs/data/ephemeris.json (DE421).
# (site, date) -> (sun az, sun el, earth az, earth el), degrees.
OURS = {
    ("A", "2026-12-21 00:00"): (7.4542, 6.4187, 324.1549, 10.5548),
    ("A", "2027-03-10 06:00"): (123.3220, -3.6079, 324.8871, 9.2616),
    ("A", "2027-06-01 12:00"): (188.1448, -6.5316, 323.5501, 10.2551),
    ("A", "2028-02-15 18:00"): (268.0000, -0.8755, 338.2904, -2.1864),
    ("A", "2029-09-30 03:00"): (243.2543, -0.8049, 324.5078, 4.0925),
    ("A", "2030-12-01 00:00"): (79.9357, 0.8653, 337.7767, 11.2836),
    ("B", "2026-12-21 00:00"): (272.0807, 1.3084, 229.2156, 5.5008),
    ("B", "2027-03-10 06:00"): (28.1851, 0.3669, 229.8913, 4.1831),
    ("B", "2027-06-01 12:00"): (92.7629, -1.4447, 228.6072, 5.2236),
    ("B", "2028-02-15 18:00"): (172.6253, -1.9402, 242.9825, -7.5872),
    ("B", "2029-09-30 03:00"): (147.9957, 0.4669, 229.3301, -0.9671),
    ("B", "2030-12-01 00:00"): (344.5957, 1.1691, 242.6647, 5.8829),
}


def q(v):
    return "'" + v + "'"


def horizons(body, lat, lon, date):
    """One row: apparent az/el (deg) of `body` from (lat, lon) on the Moon at `date` UT."""
    stop = date[:-2] + "01"  # one minute later; we use the first row only
    params = {
        "format": "text", "COMMAND": q(body), "OBJ_DATA": q("NO"), "MAKE_EPHEM": q("YES"),
        "EPHEM_TYPE": q("OBSERVER"), "CENTER": q("coord@301"), "COORD_TYPE": q("GEODETIC"),
        "SITE_COORD": q(f"{lon},{lat},0"), "START_TIME": q(date), "STOP_TIME": q(stop),
        "STEP_SIZE": q("1 m"), "QUANTITIES": q("4"), "APPARENT": q("AIRLESS"),
        "ANG_FORMAT": q("DEG"), "CSV_FORMAT": q("YES"), "TIME_TYPE": q("UT"),
    }
    url = API + "?" + urllib.parse.urlencode(params)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                text = r.read().decode("utf-8", "replace")
            break
        except Exception as e:
            if attempt == 2:
                raise
            time.sleep(3)
    if "$$SOE" not in text:
        raise RuntimeError("Horizons gave no table:\n" + text[:2000])
    row = text.split("$$SOE")[1].split("$$EOE")[0].strip().splitlines()[0]
    nums = []
    for f in row.split(",")[1:]:
        try:
            nums.append(float(f))
        except ValueError:
            pass
    if len(nums) < 2:
        raise RuntimeError("Cannot read az/el from row: " + row)
    return nums[-2], nums[-1], text


def daz(a, b):
    return (a - b + 180.0) % 360.0 - 180.0


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    rows, ok_all = [], True
    for sid, (lat, lon, label) in SITES.items():
        for date in DATES:
            o = OURS[(sid, date)]
            hz = {}
            for body, name in (("10", "sun"), ("399", "earth")):
                az, el, raw = horizons(body, lat, lon, date)
                fn = f"{sid}_{name}_{date[:10]}_{date[11:13]}h.txt"
                with open(os.path.join(OUT_DIR, fn), "w") as f:
                    f.write(raw)
                hz[name] = (az, el)
                time.sleep(0.5)
            d = [daz(o[0], hz["sun"][0]), o[1] - hz["sun"][1], daz(o[2], hz["earth"][0]), o[3] - hz["earth"][1]]
            ok = all(abs(x) <= TOL for x in d)
            ok_all &= ok
            rows.append({
                "site": sid, "lat": lat, "lon": lon, "label": label, "utc": date,
                "horizons": {"sunAz": hz["sun"][0], "sunEl": hz["sun"][1], "earthAz": hz["earth"][0], "earthEl": hz["earth"][1]},
                "ours": {"sunAz": o[0], "sunEl": o[1], "earthAz": o[2], "earthEl": o[3]},
                "maxAbsDiff": round(max(abs(x) for x in d), 4), "pass": ok,
            })
            print(f"  {sid} {date}  max |diff| {max(abs(x) for x in d):.4f}  {'PASS' if ok else 'FAIL'}", file=sys.stderr)

    with open(OUT_JSON, "w") as f:
        json.dump({"source": "JPL Horizons API (ssd.jpl.nasa.gov), apparent airless az/el, observer 0 m",
                   "checked": time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime()),
                   "tolerance_deg": TOL, "allPass": ok_all, "rows": rows}, f, indent=1)

    print("| Site | UTC | Sun az H / ours | Sun el H / ours | Earth az H / ours | Earth el H / ours | max |Δ| | |")
    print("|---|---|---|---|---|---|---|---|")
    for r in rows:
        h, o = r["horizons"], r["ours"]
        print(f"| {r['site']} | {r['utc']} | {h['sunAz']:.3f} / {o['sunAz']:.3f} | {h['sunEl']:.3f} / {o['sunEl']:.3f} "
              f"| {h['earthAz']:.3f} / {o['earthAz']:.3f} | {h['earthEl']:.3f} / {o['earthEl']:.3f} "
              f"| {r['maxAbsDiff']:.4f} | {'✅' if r['pass'] else '❌'} |")
    print(f"\nAll pass (≤ {TOL}°): {ok_all}")
    sys.exit(0 if ok_all else 1)


if __name__ == "__main__":
    main()
