// Written with assistance from Claude (Anthropic) during NASA Space Apps 2026 (14 Nov 2026).
// Lunar Horizon — calculation core. Plain ES module, no dependencies.
// Conventions: UTC; latitude south negative; longitude east positive; Moon sphere R = 1737.4 km;
// azimuth from local north, clockwise (as JPL Horizons); elevation above the local horizontal plane.

export const R_MOON = 1737.4;          // km
export const AU = 1.496e8;             // km (Sun distance; parallax is negligible)
export const SUN_R = 0.2666;           // deg, apparent solar radius at 1 AU
export const EARTH_R_KM = 6371;
const D2R = Math.PI / 180;

export function frame(lat, lon) {
  const la = lat * D2R, lo = lon * D2R;
  const up = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  let east = [-Math.sin(lo), Math.cos(lo), 0];
  if (Math.abs(lat) > 89.9999) east = [0, 1, 0]; // pole: any east will do
  const north = [up[1] * east[2] - up[2] * east[1], up[2] * east[0] - up[0] * east[2], up[0] * east[1] - up[1] * east[0]];
  return { up, east, north };
}

export function vec(lat, lon, d) {
  const la = lat * D2R, lo = lon * D2R;
  return [d * Math.cos(la) * Math.cos(lo), d * Math.cos(la) * Math.sin(lo), d * Math.sin(la)];
}

// Azimuth/elevation (deg) and distance (km) of target T seen from P with local frame F.
export function azel(F, P, T) {
  let v = [T[0] - P[0], T[1] - P[1], T[2] - P[2]];
  const n = Math.hypot(v[0], v[1], v[2]);
  v = [v[0] / n, v[1] / n, v[2] / n];
  const u = v[0] * F.up[0] + v[1] * F.up[1] + v[2] * F.up[2];
  const e = v[0] * F.east[0] + v[1] * F.east[1] + v[2] * F.east[2];
  const no = v[0] * F.north[0] + v[1] * F.north[1] + v[2] * F.north[2];
  return [((Math.atan2(e, no) / D2R) + 360) % 360, Math.asin(Math.max(-1, Math.min(1, u))) / D2R, n];
}

// Share of a disc of angular radius r above a straight horizon at clearance c (both deg).
export function discFrac(c, r) {
  if (c >= r) return 1;
  if (c <= -r) return 0;
  const x = -c / r;
  return (Math.acos(x) - x * Math.sqrt(1 - x * x)) / Math.PI;
}

// Horizon dip of a smooth sphere for an observer h km above it (deg, negative).
export function dip(hKm) { return -Math.acos(R_MOON / (R_MOON + hKm)) / D2R; }

// Linear interpolation in a horizon mask sampled every (360 / mask.length) degrees.
export function maskAt(mask, az) {
  const n = mask.length, f = ((((az % 360) + 360) % 360) / 360) * n;
  const i = Math.floor(f) % n, j = (i + 1) % n, w = f - Math.floor(f);
  return mask[i] * (1 - w) + mask[j] * w;
}

// Full time series for one site. E = ephemeris JSON {stepH, sLat, sLon, eLat, eLon, eKm}.
// site = {lat, lon, h0_m?, mask_deg?}. Without a mask, the smooth-Moon horizon is used.
export function computeSite(E, site, hObsM = 2) {
  const N = E.sLat.length, hKm = ((site.h0_m || 0) + hObsM) / 1000;
  const F = frame(site.lat, site.lon), P = vec(site.lat, site.lon, R_MOON + hKm);
  const d0 = dip(hObsM / 1000);
  // The mask is the horizon as it is: on a summit it lies below the smooth-Moon dip, so it must not be clamped to d0.
  const horizon = site.mask_deg ? (az) => maskAt(site.mask_deg, az) : () => d0;
  const S = {
    sAz: new Float32Array(N), sEl: new Float32Array(N), sClr: new Float32Array(N),
    eAz: new Float32Array(N), eEl: new Float32Array(N), eClr: new Float32Array(N), eR: new Float32Array(N),
    earthCentre: 0,
  };
  let cx = 0, cy = 0;
  for (let i = 0; i < N; i++) {
    const s = azel(F, P, vec(E.sLat[i], E.sLon[i], AU));
    const e = azel(F, P, vec(E.eLat[i], E.eLon[i], E.eKm[i]));
    S.sAz[i] = s[0]; S.sEl[i] = s[1]; S.sClr[i] = s[1] - horizon(s[0]);
    S.eAz[i] = e[0]; S.eEl[i] = e[1]; S.eClr[i] = e[1] - horizon(e[0]);
    S.eR[i] = Math.asin(EARTH_R_KM / e[2]) / D2R;
    cx += Math.cos(e[0] * D2R); cy += Math.sin(e[0] * D2R);
  }
  S.earthCentre = ((Math.atan2(cy, cx) / D2R) + 360) % 360;
  return S;
}

// Sun up = centre above the horizon (half the disc). Earth usable = centre >= thr deg above the horizon.
// run[i] = number of consecutive samples from i with both up; pre = prefix sums of "both up".
export function scoreTable(S, thr) {
  const N = S.sAz.length, both = new Uint8Array(N), run = new Int32Array(N + 1), pre = new Int32Array(N + 1);
  for (let i = 0; i < N; i++) { both[i] = (S.sClr[i] >= 0 && S.eClr[i] >= thr) ? 1 : 0; pre[i + 1] = pre[i] + both[i]; }
  for (let j = N - 1; j >= 0; j--) run[j] = both[j] ? run[j + 1] + 1 : 0;
  return { both, run, pre };
}

// Landing score for touchdown sample L and a mission of `steps` samples:
// -1 = runs past the data, -2 = Sun or Earth down at touchdown, else 0..1 = unbroken Sun+Earth share from touchdown.
export function landingScore(T, L, steps, N) {
  if (L + steps > N) return -1;
  if (!T.both[L]) return -2;
  return Math.min(T.run[L], steps) / steps;
}

// Hours from sample i until series arr crosses level lvl (interpolated), or null if never within the data.
export function hoursToCrossing(arr, lvl, i, stepH) {
  const up = arr[i] >= lvl;
  for (let j = i + 1; j < arr.length; j++) {
    if ((arr[j] >= lvl) !== up) {
      const a = arr[j - 1] - lvl, b = arr[j] - lvl, f = a === b ? 0 : a / (a - b);
      return (j - 1 + f - i) * stepH;
    }
  }
  return null;
}

export function longestRun(pred, a, b) {
  let best = 0, cur = 0;
  for (let i = a; i < b; i++) { if (pred(i)) { cur++; if (cur > best) best = cur; } else cur = 0; }
  return best;
}
