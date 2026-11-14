#!/usr/bin/env python3
# Written with assistance from Claude Code (Anthropic).
"""
Step 3 — horizon masks for the polar sites from the LOLA 240 m south-pole DEM.

For every site south of 75°S: the elevation angle of the terrain skyline in 1440 directions
(every 0.25° of azimuth, from local north, clockwise), seen by an observer 2 m above the ground.

    python3 pipeline/lola_masks.py --download     # fetch the DEM once (29 MB, not committed)
    python3 pipeline/lola_masks.py                # masks -> docs/data/sites.json, hillshade -> pipeline/out/
    python3 pipeline/lola_masks.py --patches      # 3-D terrain around each site -> docs/data/terrain/<id>.json

DEM: LDEM_75S_240M.IMG (LRO LOLA GDR, product V2.0). Little-endian int16, height m = DN * 0.5 above the
1737.4 km sphere. Polar stereographic centred on 90°S, 240 m/px (true at the pole), longitude 0 points up.

Method: from the site, walk along the great circle of each azimuth in 120 m steps (0.5 px) until the
edge of the map, read the height bilinearly, compute the elevation angle of that 3-D point above the
observer's local horizontal, keep the maximum. No flat-Moon approximation anywhere.

Limits: 240 m pixels (near-field ridges under ~500 m are not resolved); terrain north of 75°S is
outside the map and not included; sites north of 75°S get no mask.
"""
import json, math, os, struct, sys, time, urllib.request, zlib
import numpy as np

R = 1737400.0          # m, reference sphere of the DEM
PX = 240.0             # m per pixel at the pole
H_OBS = 2.0            # m, observer above the ground
N_AZ = 1440            # 0.25° azimuth step
STEP_PX = 0.5          # marching step, pixels
MASK_LAT_LIMIT = -75.0 # sites north of this get no mask

HERE = os.path.dirname(os.path.abspath(__file__))
DEM_URL = "https://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG/LDEM_75S_240M.IMG"
DEM_PATH = os.path.join(HERE, "dem", "LDEM_75S_240M.IMG")
DEM_BYTES = 29062688
SITES_JSON = os.path.join(HERE, "..", "docs", "data", "sites.json")
HILLSHADE_PNG = os.path.join(HERE, "out", "hillshade.png")
TERRAIN_DIR = os.path.join(HERE, "..", "docs", "data", "terrain")
PATCH_HALF = 80        # patch = (2 * 80 + 1) samples a side, 240 m apart: 38.4 km
PATCH_SOURCE = ("NASA LRO LOLA GDR LDEM_75S_240M (product V2.0, 240 m/px), resampled bilinearly by "
                "pipeline/lola_masks.py --patches; written with assistance from Claude Code (Anthropic)")
MASK_SOURCE = ("NASA LRO LOLA GDR LDEM_75S_240M (product V2.0, 240 m/px), horizon computed by "
               "pipeline/lola_masks.py: observer 2 m above the DEM, 0.25 deg azimuth step; "
               "terrain north of 75S not included")


def load_dem(path=DEM_PATH):
    """Heights in metres above the 1737.4 km sphere, shape (N, N), row 0 at the top."""
    a = np.fromfile(path, dtype="<i2")
    n = int(round(math.sqrt(a.size)))
    if n * n != a.size:
        raise ValueError(f"{path}: {a.size} samples is not a square grid")
    return a.reshape(n, n).astype(np.float32) * 0.5


def latlon_to_pixel(lat, lon, n):
    """(col, row), 0-based pixel centres. South-polar stereographic, lon 0 up, lon 90E to the right."""
    r = 2 * R * math.tan(math.radians(90 - abs(lat)) / 2)
    x, y = r * math.sin(math.radians(lon)), r * math.cos(math.radians(lon))
    return x / PX + n / 2 - 0.5, -y / PX + n / 2 - 0.5


def pixel_to_latlon(col, row, n):
    x, y = (col - n / 2 + 0.5) * PX, -(row - n / 2 + 0.5) * PX
    lat = -(90 - 2 * math.degrees(math.atan(math.hypot(x, y) / (2 * R))))
    return lat, math.degrees(math.atan2(x, y))


def frame(lat, lon):
    """Local up / east / north unit vectors (same convention as docs/sky-core.js)."""
    la, lo = math.radians(lat), math.radians(lon)
    up = np.array([math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)])
    east = np.array([-math.sin(lo), math.cos(lo), 0.0])
    return up, east, np.cross(up, east)


def bilinear(dem, col, row):
    """Bilinear height at fractional pixel positions; second result marks points inside the map."""
    n = dem.shape[0]
    ok = (col >= 0) & (col <= n - 1) & (row >= 0) & (row <= n - 1)
    c, r = np.clip(col, 0, n - 1), np.clip(row, 0, n - 1)
    c0, r0 = np.minimum(c.astype(np.int64), n - 2), np.minimum(r.astype(np.int64), n - 2)
    fc, fr = c - c0, r - r0
    h = (dem[r0, c0] * (1 - fc) * (1 - fr) + dem[r0, c0 + 1] * fc * (1 - fr)
         + dem[r0 + 1, c0] * (1 - fc) * fr + dem[r0 + 1, c0 + 1] * fc * fr)
    return h, ok


def ground_height(dem, lat, lon):
    col, row = latlon_to_pixel(lat, lon, dem.shape[0])
    h, ok = bilinear(dem, np.array([col]), np.array([row]))
    if not ok[0]:
        raise ValueError(f"({lat}, {lon}) is outside the DEM")
    return float(h[0])


def destination(lat, lon, az, dist_m):
    """Point reached from (lat, lon) after dist_m along the great circle that starts at azimuth az."""
    up, east, north = frame(lat, lon)
    a, t = math.radians(az), dist_m / R
    u = math.cos(t) * up + math.sin(t) * (math.cos(a) * north + math.sin(a) * east)
    return math.degrees(math.asin(u[2])), math.degrees(math.atan2(u[1], u[0]))


def azimuth_distance(lat1, lon1, lat2, lon2):
    """Azimuth (deg from north, clockwise) and ground distance (m) from point 1 to point 2."""
    up, east, north = frame(lat1, lon1)
    u2 = frame(lat2, lon2)[0]
    az = math.degrees(math.atan2(float(u2 @ east), float(u2 @ north))) % 360
    return az, R * math.acos(max(-1.0, min(1.0, float(u2 @ up))))


def terrain_patch(dem, lat, lon, h0, half=PATCH_HALF, step=PX):
    """Terrain around a site for the 3-D view, on a square grid of local east/north offsets (m).

    Row 0 is the north edge, column 0 the west edge. Each sample is the point reached by walking the
    great circle towards it; its value is the height (m) above the site's local horizontal plane through
    the ground at the site (height h0), so the Moon's curvature is included (about -110 m at 19 km).
    """
    k = np.arange(-half, half + 1) * step
    e, n = np.meshgrid(k, -k)
    up, east, north = frame(lat, lon)
    t, a = np.hypot(e, n) / R, np.arctan2(e, n)
    u = (np.cos(t)[..., None] * up
         + np.sin(t)[..., None] * (np.cos(a)[..., None] * north + np.sin(a)[..., None] * east))
    la, lo = np.degrees(np.arcsin(u[..., 2])), np.degrees(np.arctan2(u[..., 1], u[..., 0]))
    r = 2 * R * np.tan(np.radians(90 - np.abs(la)) / 2)
    nd = dem.shape[0]
    col, row = r * np.sin(np.radians(lo)) / PX + nd / 2 - 0.5, -r * np.cos(np.radians(lo)) / PX + nd / 2 - 0.5
    h, ok = bilinear(dem, col, row)
    if not ok.all():
        raise ValueError(f"terrain patch around ({lat}, {lon}) leaves the DEM")
    return (R + h) * np.cos(t) - (R + h0)


def compute_mask(dem, lat, lon, h_obs=H_OBS, n_az=N_AZ):
    """Skyline elevation angle (deg) for n_az azimuths, and the ground height at the site (m)."""
    n = dem.shape[0]
    up, east, north = frame(lat, lon)
    h0 = ground_height(dem, lat, lon)
    P = (R + h0 + h_obs) * up
    c0, r0 = latlon_to_pixel(lat, lon, n)
    # Farthest map corner bounds the walk; the map scale is >= 1, so ground distance <= map distance.
    d_max = max(math.hypot(c0 - c, r0 - r) for c in (0, n - 1) for r in (0, n - 1)) * PX
    d = np.arange(PX, d_max + PX, STEP_PX * PX)
    cos_t, sin_t = np.cos(d / R)[None, :, None], np.sin(d / R)[None, :, None]
    az = np.radians(np.arange(n_az) * 360.0 / n_az)
    mask = np.empty(n_az)
    for a in range(0, n_az, 90):
        b = az[a:a + 90]
        heading = np.cos(b)[:, None] * north + np.sin(b)[:, None] * east          # (k, 3)
        u = cos_t * up + sin_t * heading[:, None, :]                              # (k, nd, 3) unit vectors
        k = 2 * R / (1 - u[..., 2])                                               # stereographic from the north pole
        h, ok = bilinear(dem, k * u[..., 1] / PX + n / 2 - 0.5, -k * u[..., 0] / PX + n / 2 - 0.5)
        v = (R + h)[..., None] * u - P
        el = np.degrees(np.arcsin((v @ up) / np.linalg.norm(v, axis=-1)))
        el[~ok] = -90.0
        mask[a:a + 90] = el.max(axis=1)
    return mask, h0


def write_png_gray(path, img):
    """Minimal 8-bit greyscale PNG writer (standard library only)."""
    h, w = img.shape
    raw = b"".join(b"\x00" + img[y].tobytes() for y in range(h))
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))


def hillshade(dem, path=HILLSHADE_PNG, block=4, sun_az=315.0, sun_el=20.0):
    """Shaded relief of the whole DEM (down-sampled), light from the upper left, for a check by eye."""
    n = dem.shape[0] // block * block
    small = dem[:n, :n].reshape(n // block, block, n // block, block).mean(axis=(1, 3))
    dzdy, dzdx = np.gradient(small, PX * block)        # rows grow downward
    az, el = math.radians(sun_az), math.radians(sun_el)
    lx, ly, lz = math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)   # image x right, y down
    shade = (-dzdx * lx - dzdy * ly + lz) / np.sqrt(dzdx ** 2 + dzdy ** 2 + 1)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    write_png_gray(path, (np.clip(shade, 0, 1) * 255).astype(np.uint8))
    return path


def download():
    os.makedirs(os.path.dirname(DEM_PATH), exist_ok=True)
    for url in (DEM_URL, DEM_URL[:-4] + ".LBL"):
        dst = os.path.join(os.path.dirname(DEM_PATH), os.path.basename(url))
        print("downloading", url)
        urllib.request.urlretrieve(url, dst)
    size = os.path.getsize(DEM_PATH)
    if size != DEM_BYTES:
        raise SystemExit(f"DEM size {size} bytes, expected {DEM_BYTES}")
    print("ok,", size, "bytes")


def write_sites(path, doc):
    """sites.json with one site per line, so the diff stays readable."""
    lines = ['{', ' "source": ' + json.dumps(doc["source"], ensure_ascii=False) + ',', ' "sites": [']
    lines += ['  ' + json.dumps(s, ensure_ascii=False, separators=(", ", ": ")) + (',' if i < len(doc["sites"]) - 1 else '')
              for i, s in enumerate(doc["sites"])]
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines + [' ]', '}']) + "\n")


def write_patches(dem):
    """docs/data/terrain/<id>.json for every site with a mask (heights rounded to 1 m)."""
    with open(SITES_JSON, encoding="utf-8") as f:
        doc = json.load(f)
    os.makedirs(TERRAIN_DIR, exist_ok=True)
    for s in doc["sites"]:
        if "h0_m" not in s:
            continue
        z = terrain_patch(dem, s["lat"], s["lon"], s["h0_m"])
        out = {"source": PATCH_SOURCE, "id": s["id"], "lat": s["lat"], "lon": s["lon"], "h0_m": s["h0_m"],
               "step_m": PX, "n": int(z.shape[0]),
               "note": "rows north to south, columns west to east; metres above the site's local horizontal plane",
               "z_m": [int(round(float(v))) for v in z.ravel()]}
        path = os.path.join(TERRAIN_DIR, s["id"] + ".json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(out, f, separators=(",", ":"))
        print(f"{s['id']:<12} {z.min():8.0f} .. {z.max():6.0f} m  -> {os.path.relpath(path)} ({os.path.getsize(path) // 1024} KB)")


def main():
    if "--download" in sys.argv:
        download()
        return
    if not os.path.exists(DEM_PATH):
        raise SystemExit("DEM not found. Run: python3 pipeline/lola_masks.py --download")
    dem = load_dem()
    if "--patches" in sys.argv:
        write_patches(dem)
        return
    print(f"DEM {dem.shape[0]} x {dem.shape[1]}, heights {dem.min():.0f} .. {dem.max():.0f} m")
    print("hillshade ->", os.path.relpath(hillshade(dem)))
    with open(SITES_JSON, encoding="utf-8") as f:
        doc = json.load(f)
    print(f"{'site':<12}{'h0 m':>8}{'min':>8}{'median':>8}{'max':>8}{'az of max':>11}{'s':>6}")
    for s in doc["sites"]:
        for key in ("h0_m", "mask_deg", "mask_source"):
            s.pop(key, None)
        if s["lat"] > MASK_LAT_LIMIT:
            print(f"{s['id']:<12}  north of 75S: no mask (smooth Moon)")
            continue
        t0 = time.time()
        mask, h0 = compute_mask(dem, s["lat"], s["lon"])
        s["h0_m"] = round(h0, 1)
        s["mask_deg"] = [round(float(x), 2) for x in mask]
        s["mask_source"] = MASK_SOURCE
        print(f"{s['id']:<12}{h0:>8.0f}{mask.min():>8.2f}{np.median(mask):>8.2f}{mask.max():>8.2f}"
              f"{mask.argmax() * 360 / N_AZ:>11.2f}{time.time() - t0:>6.1f}")
    write_sites(SITES_JSON, doc)
    print("masks ->", os.path.relpath(SITES_JSON))


if __name__ == "__main__":
    main()
