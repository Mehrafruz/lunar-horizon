# Written with assistance from Claude (Anthropic) during NASA Space Apps 2026 (14 Nov 2026).
"""Sub-solar and sub-Earth points on the Moon (MOON_ME frame) and Earth-Moon distance,
from the JPL DE421 ephemeris (planets + lunar libration angles).

Used as an independent cross-check of the JPL Horizons table, and as a fallback
if Horizons is unreachable.

    pip install numpy jplephem de421
    python ephemeris_de421.py out.json [stepH]

Check: site -84.8, 29.2, h=0, 2026-12-21 00 UT -> Sun az 7.454 el 6.419, Earth az 324.155 el 10.555
(JPL Horizons: 7.448 / 6.419 and 324.155 / 10.555).
"""
import sys, json
import numpy as np
import de421
from jplephem.ephem import Ephemeris

E = Ephemeris(de421)
TT_MINUS_UTC_S = 69.184  # 2026-2030 (TAI-UTC = 37 s, no new leap second announced)


def jd_from_ymd(y, m, d, h=0.0):
    if m <= 2:
        y -= 1; m += 12
    A = y // 100; B = 2 - A + A // 4
    return int(365.25 * (y + 4716)) + int(30.6001 * (m + 1)) + d + B - 1524.5 + h / 24.0


def _rz(a):
    c, s = np.cos(a), np.sin(a); z = np.zeros_like(a); o = np.ones_like(a)
    return np.array([[c, s, z], [-s, c, z], [z, z, o]])


def _rx(a):
    c, s = np.cos(a), np.sin(a); z = np.zeros_like(a); o = np.ones_like(a)
    return np.array([[o, z, z], [z, c, s], [z, -s, c]])


def _ry(a):
    c, s = np.cos(a), np.sin(a); z = np.zeros_like(a); o = np.ones_like(a)
    return np.array([[c, z, -s], [z, o, z], [s, z, c]])


AS = np.pi / 180 / 3600
# Principal-axis -> Mean-Earth frame for DE421 (NAIF moon_080317.tf: 67.92", 78.56", 0.30" about axes 3,2,1).
M_PA2ME = np.array(_rx(np.array(0.30 * AS)) @ _ry(np.array(78.56 * AS)) @ _rz(np.array(67.92 * AS)), dtype=float).reshape(3, 3).T


def moon_me_vectors(jd_utc):
    """Sun and Earth position vectors (km) from the Moon's centre, in the MOON_ME frame (geometric)."""
    tdb = jd_utc + TT_MINUS_UTC_S / 86400.0
    emb = E.position('earthmoon', tdb)
    moon_geo = E.position('moon', tdb)
    sun = E.position('sun', tdb)
    earth = emb - moon_geo / (1 + E.EMRAT)
    moon = earth + moon_geo
    s, e = sun - moon, earth - moon
    phi, th, psi = E.position('librations', tdb)
    M = np.einsum('ij...,jk...->ik...', _rz(psi), np.einsum('ij...,jk...->ik...', _rx(th), _rz(phi)))
    s_pa = np.einsum('ij...,j...->i...', M, s)
    e_pa = np.einsum('ij...,j...->i...', M, e)
    return M_PA2ME @ s_pa, M_PA2ME @ e_pa


def sub_point(v):
    v = v / np.linalg.norm(v, axis=0)
    return np.degrees(np.arcsin(v[2])), np.degrees(np.arctan2(v[1], v[0]))  # lat, east lon (-180..180)


def main():
    out_path = sys.argv[1]
    step_h = float(sys.argv[2]) if len(sys.argv) > 2 else 3.0
    jd0, jd1 = jd_from_ymd(2026, 11, 15), jd_from_ymd(2031, 1, 1)
    jd = jd0 + np.arange(0, (jd1 - jd0) * 24, step_h) / 24.0
    s, e = moon_me_vectors(jd)
    slat, slon = sub_point(s)
    elat, elon = sub_point(e)
    out = {
        'source': 'JPL DE421 + lunar libration, MOON_ME frame; script written with Claude (Anthropic) during NASA Space Apps 2026',
        'start': '2026-11-15T00:00:00Z', 'stepH': step_h,
        'sLat': [round(x, 3) for x in slat], 'sLon': [round(x, 3) for x in slon],
        'eLat': [round(x, 3) for x in elat], 'eLon': [round(x, 3) for x in elon],
        'eKm': [int(x) for x in np.linalg.norm(e, axis=0)],
    }
    with open(out_path, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print(f'{len(jd)} samples -> {out_path}')


if __name__ == '__main__':
    main()
