// Written with assistance from Claude Code (Anthropic).
// Lunar Horizon — page logic, ported from reference/prototype-v2.dc.html.
// All geometry comes from sky-core.js; this file only does state, caching and drawing.
import { SUN_R, discFrac, dip, maskAt, computeSite, scoreTable, landingScore, hoursToCrossing, longestRun } from './sky-core.js';

const H_OBS_M = 2;                     // panel/antenna height above the ground
const DIP = dip(H_OBS_M / 1000);       // smooth-Moon horizon for that observer
const WIN = 90;                        // calendar window, days
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const RAMP = ['#1F3A5A', '#245E86', '#2E86A6', '#6BC3B8', '#F2E7A1'];
const NOLAND = '#151A23', BEYOND = '#0B0E14';
const ROW_H = 36, ROW_GAP = 4;         // calendar row height and gap (px), must match .site-btn

const $ = (id) => document.getElementById(id);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const pad2 = (n) => String(n).padStart(2, '0');

let E, N, STEP_H, SPD, START;
let SITES = [];
const custom = [];
const st = { siteId: 'im2', day: 30, ws: null, hourIdx: 0, dur: 14, thr: 2, trueScale: false, terrain: true, t: 0, hover: null };
let timer = null;

// ---------- caches ----------
const seriesCache = new Map(), tableCache = new Map();
// A site uses its LOLA horizon mask when the terrain toggle is on and sites.json has one (south of 75°S).
const useMask = (s) => st.terrain && !!s.mask_deg;
const siteKey = (s) => s.lat.toFixed(4) + ',' + s.lon.toFixed(4) + (useMask(s) ? '|lola' : '');
function series(s) {
  const k = siteKey(s);
  if (!seriesCache.has(k)) seriesCache.set(k, computeSite(E, useMask(s) ? s : { lat: s.lat, lon: s.lon }, H_OBS_M));
  return seriesCache.get(k);
}
const rangeCache = new Map();
function maskRange(s) {
  if (!rangeCache.has(s.id)) rangeCache.set(s.id, s.mask_deg.reduce((r, v) => [Math.min(r[0], v), Math.max(r[1], v)], [Infinity, -Infinity]));
  return rangeCache.get(s.id);
}
function table(s, thr) {
  const k = siteKey(s) + '|' + thr;
  if (!tableCache.has(k)) tableCache.set(k, scoreTable(series(s), thr));
  return tableCache.get(k);
}

// ---------- time labels ----------
const dateAt = (i) => new Date(START + i * STEP_H * 3600000);
const dLabel = (i) => { const x = dateAt(i); return x.getUTCDate() + ' ' + MON[x.getUTCMonth()] + ' ' + x.getUTCFullYear(); };
const dtLabel = (i) => dLabel(i) + ', ' + pad2(dateAt(i).getUTCHours()) + ':00 UTC';
function fmtH(h) { h = Math.max(0, Math.round(h)); const d = Math.floor(h / 24), r = h % 24; return d > 0 ? d + ' d ' + r + ' h' : r + ' h'; }
const fmtDeg = (x) => (x >= 0 ? '' : '−') + Math.abs(x).toFixed(1) + '°';

// ---------- derived state ----------
const allSites = () => SITES.concat(custom);
const curSite = () => allSites().find((s) => s.id === st.siteId) || allSites()[0];
const steps = () => st.dur * SPD;
const lastDay = () => Math.floor((N - steps() - st.hourIdx - 1) / SPD);
const Lidx = (d) => d * SPD + st.hourIdx;

function norm() {
  const ld = lastDay();
  st.day = clamp(st.day, 0, ld);
  if (st.ws == null) st.ws = st.day - 15;
  st.ws = clamp(st.ws, 0, ld - WIN + 1);
  st.t = clamp(st.t, 0, steps() - 1);
}

// Landing score for site s on day d at the chosen hour (see sky-core landingScore).
function cellValue(s, d) {
  if (d > lastDay()) return -1;
  return landingScore(table(s, st.thr), Lidx(d), steps(), N);
}
const colorOf = (v) => v === -1 ? BEYOND : (v === -2 ? NOLAND : RAMP[clamp(Math.floor(v * 5 - 1e-9), 0, 4)]);

function describe(s, d) {
  if (d > lastDay()) return s.name + ': this landing date runs past the end of the data (Dec 2030).';
  const S = series(s), T = table(s, st.thr), L = Lidx(d), n = steps();
  const sunOk = S.sClr[L] >= 0, eOk = S.eClr[L] >= st.thr;
  const runH = Math.min(T.run[L], n) * STEP_H, tot = (T.pre[L + n] - T.pre[L]) / n;
  const dark = longestRun((i) => S.sClr[i] < 0, L, L + n) * STEP_H;
  return s.name + ' · land ' + dtLabel(L) + ' — at touchdown: Sun ' + (sunOk ? 'up' : 'DOWN') + ', Earth ' + (eOk ? 'usable' : 'NOT usable') +
    ' · unbroken Sun + Earth from touchdown: ' + fmtH(runH) + ' of ' + st.dur + ' d · Sun + Earth in total ' + Math.round(tot * 100) + '% · longest darkness ' + fmtH(dark) + '.';
}

// ---------- state changes ----------
function set(patch) { Object.assign(st, patch); norm(); renderAll(); }
function setDay(d, extra) {
  const o = Object.assign({ day: clamp(d, 0, lastDay()), t: 0 }, extra || {});
  if (o.ws == null && (o.day < st.ws || o.day >= st.ws + WIN)) o.ws = o.day - 15;
  set(o);
}

// ---------- canvas helper ----------
function fit(cv, cssH) {
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth;
  cv.style.height = cssH + 'px';
  cv.width = Math.max(1, Math.round(w * dpr)); cv.height = Math.max(1, Math.round(cssH * dpr));
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h: cssH };
}
function ring(ctx, x, y, w, h, inset, color) {
  ctx.strokeStyle = color; ctx.lineWidth = inset;
  ctx.strokeRect(x + inset / 2, y + inset / 2, w - inset, h - inset);
}

// ---------- scenario bar ----------
function renderControls() {
  const s = curSite(), L0 = Lidx(st.day);
  $('siteName').textContent = s.name;
  $('siteCoords').textContent = Math.abs(s.lat).toFixed(2) + '°' + (s.lat < 0 ? 'S' : 'N') + ' · ' + Math.abs(s.lon).toFixed(2) + '°' + (s.lon >= 0 ? 'E' : 'W') + ' · ' + s.tag + (useMask(s) ? ' · ground ' + Math.round(s.h0_m) + ' m' : '');
  for (const b of $('hzOpts').children) b.setAttribute('aria-pressed', String((b.dataset.v === 'lola') === st.terrain));
  $('badge').textContent = useMask(s) ? 'LOLA TERRAIN · 240 m' : (st.terrain ? 'SMOOTH MOON · NO TERRAIN DATA HERE' : 'SMOOTH MOON');
  $('landingDate').textContent = dLabel(L0);
  $('dayPrev').disabled = st.day <= 0; $('dayNext').disabled = st.day >= lastDay();
  $('hourSel').value = String(st.hourIdx);
  $('durLabel').textContent = $('durLabel2').textContent = st.dur + '-day';
  $('durDec').disabled = st.dur <= 1; $('durInc').disabled = st.dur >= 30;
  for (const b of $('thrOpts').children) b.setAttribute('aria-pressed', String(Number(b.dataset.v) === st.thr));
  $('scaleBtn').textContent = st.trueScale ? 'Stretch height' : 'True scale';
  $('scaleBtn').setAttribute('aria-pressed', String(st.trueScale));
  $('skyTitle').textContent = $('ovSite').textContent = s.name;
  $('hourLabel').textContent = pad2(dateAt(st.hourIdx).getUTCHours()) + ':00';
}

// ---------- calendar ----------
let calKey = '', ovKey = '';
function renderCalendar(force) {
  const sites = allSites(), s = curSite();
  const key = [st.ws, st.day, s.id, st.thr, st.hourIdx, st.dur, sites.length, st.terrain].join('|');
  if (!force && key === calKey) return;
  calKey = key;

  $('windowLabel').textContent = dLabel(st.ws * SPD) + ' – ' + dLabel((st.ws + WIN - 1) * SPD);
  $('wsPrev').disabled = st.ws <= 0; $('wsNext').disabled = st.ws >= lastDay() - WIN + 1;

  // Site labels
  const col = $('siteCol');
  col.replaceChildren(...sites.map((x) => {
    const b = document.createElement('button');
    b.type = 'button'; b.tabIndex = -1; b.className = 'site-btn' + (x.id === s.id ? ' sel' : '');
    b.innerHTML = '<span class="n"></span><span class="t"></span>';
    b.firstChild.textContent = x.name; b.lastChild.textContent = x.tag + (st.terrain && !x.mask_deg ? ' · smooth Moon' : '');
    b.addEventListener('click', () => set({ siteId: x.id, t: 0 }));
    return b;
  }));

  // Month ticks
  const ticks = [];
  let d = st.ws;
  while (d < st.ws + WIN) {
    const x0 = dateAt(d * SPD); let n = 0;
    while (d + n < st.ws + WIN && dateAt((d + n) * SPD).getUTCMonth() === x0.getUTCMonth()) n++;
    const label = n >= 4 ? (x0.getUTCDate() === 1 ? '' : x0.getUTCDate() + ' ') + MON[x0.getUTCMonth()] + ' ' + x0.getUTCFullYear() : '';
    ticks.push('<span style="left:' + ((d - st.ws) / WIN * 100) + '%;width:' + (n / WIN * 100) + '%">' + label + '</span>');
    d += n;
  }
  $('dayTicks').innerHTML = ticks.join('');

  drawCalendar();
  renderOverview(force);
}

function drawCalendar() {
  const sites = allSites(), s = curSite();
  const { ctx, w } = fit($('calCv'), sites.length * (ROW_H + ROW_GAP) - ROW_GAP);
  const cw = w / WIN;
  sites.forEach((x, si) => {
    const y = si * (ROW_H + ROW_GAP);
    for (let k = 0; k < WIN; k++) {
      const d = st.ws + k, v = cellValue(x, d), cx = k * cw, ww = Math.max(1, cw - 1);
      ctx.fillStyle = colorOf(v); ctx.fillRect(cx, y, ww, ROW_H);
      if (v === -2) ring(ctx, cx, y, ww, ROW_H, 1, '#2A3343');
      if (x.id === s.id && d === st.day) { ring(ctx, cx - 1, y - 1, ww + 2, ROW_H + 2, 1, '#070A10'); ring(ctx, cx, y, ww, ROW_H, 2, '#FFFFFF'); }
    }
  });
}

// Week overview for the selected site (best touchdown in each week), cached per site/scenario.
let ovVals = [];
function renderOverview(force) {
  const s = curSite(), key = [s.id, st.thr, st.hourIdx, st.dur, st.terrain].join('|');
  if (force || key !== ovKey) {
    ovKey = key;
    const weeks = Math.floor((lastDay() + 1) / 7);
    ovVals = [];
    for (let w = 0; w < weeks; w++) { let best = -2; for (let k = 0; k < 7; k++) best = Math.max(best, cellValue(s, w * 7 + k)); ovVals.push(best); }
    const yt = []; let w = 0;
    while (w < weeks) {
      const y0 = dateAt(w * 7 * SPD).getUTCFullYear(); let m = 0;
      while (w + m < weeks && dateAt((w + m) * 7 * SPD).getUTCFullYear() === y0) m++;
      yt.push('<span style="left:' + (w / weeks * 100) + '%;width:' + (m / weeks * 100) + '%">' + (m >= 10 ? y0 : '') + '</span>');
      w += m;
    }
    $('yearTicks').innerHTML = yt.join('');
  }
  drawOverview();
}
function drawOverview() {
  const { ctx, w, h } = fit($('ovCv'), 18), n = ovVals.length, cw = w / n, gap = cw >= 3 ? 1 : 0;
  const selW = Math.floor(st.day / 7);
  ovVals.forEach((v, k) => { ctx.fillStyle = colorOf(v); ctx.fillRect(k * cw, 0, Math.max(1, cw - gap), h); });
  if (selW < n) ring(ctx, selW * cw, 0, Math.max(4, cw - gap), h, 2, '#FFFFFF');
}

function renderReadout() {
  const sites = allSites(), hs = st.hover && sites.find((x) => x.id === st.hover.s);
  $('readout').textContent = hs ? describe(hs, st.hover.d) : describe(curSite(), st.day);
}

// ---------- slip helper: best day at this site, best site on this day ----------
const SLIP = 14;   // days searched on each side of the chosen landing day
// Rank of a landing: unbroken Sun + Earth share from touchdown, then the total Sun + Earth share.
function rank(s, d) {
  const v = cellValue(s, d);
  if (v < 0) return [-1, 0];
  const T = table(s, st.thr), L = Lidx(d), n = steps();
  return [v, (T.pre[L + n] - T.pre[L]) / n];
}
const better = (a, b) => a[0] > b[0] + 1e-9 || (Math.abs(a[0] - b[0]) <= 1e-9 && a[1] > b[1] + 1e-9);

function renderSuggest() {
  const s = curSite(), n = steps(), cur = rank(s, st.day), date = dLabel(Lidx(st.day));
  const what = (r) => fmtH(r[0] * n * STEP_H) + ' unbroken Sun + Earth from touchdown, ' + Math.round(r[1] * 100) + '% in total';
  const line = (lead, label, onPick, tail) => {
    const div = document.createElement('div'), a = document.createElement('span');
    a.className = 'lead'; a.textContent = lead; div.append(a);
    if (label) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn'; b.textContent = label; b.addEventListener('click', onPick);
      div.append(b, document.createTextNode(tail));
    }
    return div;
  };
  // Nearest days first (later before earlier), so equal ranks keep the smallest slip.
  let bd = st.day, br = cur;
  for (let k = 1; k <= SLIP; k++) for (const d of [st.day + k, st.day - k]) {
    if (d < 0 || d > lastDay()) continue;
    const r = rank(s, d);
    if (better(r, br)) { br = r; bd = d; }
  }
  let bs = s, bsr = cur;
  // Compare like with like: only sites on the same horizon model (LOLA terrain or smooth Moon) as the chosen one.
  const peers = allSites().filter((x) => useMask(x) === useMask(s));
  const kind = !st.terrain ? 'site' : (useMask(s) ? 'site with LOLA terrain' : 'smooth-Moon site');
  for (const x of peers) { const r = rank(x, st.day); if (better(r, bsr)) { bsr = r; bs = x; } }

  const slip = bd - st.day;
  const dayLine = br[0] < 0 ? line('No day within ±' + SLIP + ' days at ' + s.name + ' has Sun and Earth up at touchdown.')
    : bd === st.day ? line(date + ' is already the best day at ' + s.name + ' within ±' + SLIP + ' days.')
    : line('Best day at ' + s.name + ' within ±' + SLIP + ' days:', dLabel(Lidx(bd)) + ' (' + (slip > 0 ? '+' : '−') + Math.abs(slip) + ' d)', () => setDay(bd), '— ' + what(br));
  const siteLine = bsr[0] < 0 ? line('No ' + kind + ' has Sun and Earth up at touchdown on ' + date + '.')
    : bs === s ? line(s.name + ' is already the best ' + kind + ' on ' + date + '.')
    : line('Best ' + kind + ' on ' + date + ':', bs.name, () => set({ siteId: bs.id, t: 0 }), '— ' + what(bsr));
  $('suggest').replaceChildren(dayLine, siteLine);
}

// ---------- mission summary (fixed for a scenario) ----------
function renderMission() {
  const s = curSite(), S = series(s), T = table(s, st.thr), L0 = Lidx(st.day), n = steps();
  const both = T.pre[L0 + n] - T.pre[L0];
  $('mTouch').textContent = (S.sClr[L0] >= 0 ? 'Sun up' : 'Sun DOWN') + ' · ' + (S.eClr[L0] >= st.thr ? 'Earth usable' : 'Earth NOT usable');
  $('mRun').textContent = fmtH(Math.min(T.run[L0], n) * STEP_H);
  $('mBoth').textContent = Math.round(both / n * 100) + '% (' + fmtH(both * STEP_H) + ')';
  $('mDark').textContent = fmtH(longestRun((i) => S.sClr[i] < 0, L0, L0 + n) * STEP_H);
  $('mNoEarth').textContent = fmtH(longestRun((i) => S.eClr[i] < st.thr, L0, L0 + n) * STEP_H);
  $('tSlider').max = String(n - 1);
}

// ---------- sky view, readouts, lanes (redrawn on every play tick) ----------
const wrapRel = (az, centre) => ((az - centre + 540) % 360) - 180;

function renderNow() {
  const s = curSite(), S = series(s), n = steps(), L0 = Lidx(st.day), tt = st.t, iNow = L0 + tt, thr = st.thr;
  const polar = Math.abs(s.lat) > 60;
  const centre = polar ? S.earthCentre : (s.lat < 0 ? 180 : 0);
  const X0 = 44, PW = 956, pxDeg = PW / 360;
  let lo = -1, hi = 2;
  for (let q = L0; q < L0 + n; q++) {
    if (S.sEl[q] > -2) hi = Math.max(hi, S.sEl[q] + 0.6);
    if (S.eEl[q] > -2) hi = Math.max(hi, S.eEl[q] + S.eR[q] + 0.4);
  }
  const mask = useMask(s) ? s.mask_deg : null;
  if (mask) { const [mMin, mMax] = maskRange(s); lo = Math.min(lo, mMin - 0.5); hi = Math.max(hi, mMax + 0.5); }
  let vy, ex;
  if (st.trueScale) { vy = pxDeg; ex = 1; lo = Math.min(lo, -2); } else { vy = Math.min(14 * pxDeg, 205 / (hi - lo)); ex = vy / pxDeg; }
  const Y = (el) => 225 - (el - lo) * vy;
  const Xa = (az) => X0 + (wrapRel(az, centre) + 180) * pxDeg;
  // Mission paths, broken where they cross the ±180° seam of the panorama.
  const segs = (A, B) => {
    const out = []; let cur = [], lastX = null;
    for (let i = L0; i < L0 + n; i++) {
      const x = Xa(A[i]), y = Y(B[i]);
      if (lastX !== null && Math.abs(x - lastX) > PW / 2) { if (cur.length > 1) out.push(cur.join(' ')); cur = []; }
      if (y > -20 && y < 270) cur.push(x.toFixed(1) + ',' + y.toFixed(1));
      lastX = x;
    }
    if (cur.length > 1) out.push(cur.join(' '));
    return out;
  };
  const stepDeg = st.trueScale ? (hi > 40 ? 30 : 10) : (hi - lo > 20 ? 10 : (hi - lo > 8 ? 2 : 1));
  const svg = [];
  for (let g = Math.ceil(lo / stepDeg) * stepDeg; g <= (st.trueScale ? 80 : hi); g += stepDeg) {
    const gy = Y(g);
    if (gy > 8 && gy < 228) svg.push('<line x1="44" x2="1000" y1="' + gy.toFixed(1) + '" y2="' + gy.toFixed(1) + '" stroke="#1C2432"/><text x="6" y="' + (gy + 4).toFixed(1) + '" fill="#A7B2C2" font-size="13" font-family="Inter">' + g + '°</text>');
  }
  for (const p of segs(S.sAz, S.sEl)) svg.push('<polyline points="' + p + '" fill="none" stroke="#FFC24B" stroke-opacity="0.6" stroke-width="2" stroke-dasharray="3 4"/>');
  for (const p of segs(S.eAz, S.eEl)) svg.push('<polyline points="' + p + '" fill="none" stroke="#6CB6FF" stroke-opacity="0.7" stroke-width="2" stroke-dasharray="3 4"/>');

  const sClr = S.sClr[iNow], eClr = S.eClr[iNow];
  const sunUp = sClr > -SUN_R, earthUp = eClr > -S.eR[iNow];
  const rx = (r) => Math.max(3, r * pxDeg).toFixed(1), ry = (r) => Math.max(3, r * vy).toFixed(1);
  const sun = 'cx="' + Xa(S.sAz[iNow]).toFixed(1) + '" cy="' + Y(S.sEl[iNow]).toFixed(1) + '" rx="' + rx(SUN_R) + '" ry="' + ry(SUN_R) + '"';
  const earth = 'cx="' + Xa(S.eAz[iNow]).toFixed(1) + '" cy="' + Math.max(4, Y(S.eEl[iNow])).toFixed(1) + '" rx="' + rx(S.eR[iNow]) + '" ry="' + ry(S.eR[iNow]) + '"';
  if (earthUp) svg.push('<ellipse ' + earth + ' fill="#6CB6FF" stroke="#D4EAFF" stroke-width="1.5"/>');
  if (sunUp) svg.push('<ellipse ' + sun + ' fill="#FFC24B" stroke="#FFE7B0" stroke-width="1.5"/>');
  if (mask) {
    // Terrain skyline from the LOLA mask, every 0.5° across the panorama.
    const pts = [];
    for (let k = 0; k <= 720; k++) pts.push((X0 + k * 0.5 * pxDeg).toFixed(1) + ',' + Math.min(249, Y(maskAt(mask, centre - 180 + k * 0.5))).toFixed(1));
    svg.push('<polygon points="44,250 ' + pts.join(' ') + ' 1000,250" fill="#262E3C"/>');
    svg.push('<polyline points="' + pts.join(' ') + '" fill="none" stroke="#7A879C" stroke-width="1.5" stroke-linejoin="round"/>');
  } else {
    const groundY = Math.min(240, Y(DIP));
    svg.push('<rect x="44" y="' + groundY.toFixed(1) + '" width="956" height="' + (250 - groundY).toFixed(1) + '" fill="#262E3C"/>');
    svg.push('<line x1="44" x2="1000" y1="' + groundY.toFixed(1) + '" y2="' + groundY.toFixed(1) + '" stroke="#7A879C" stroke-width="1.5"/>');
  }
  if (!earthUp) svg.push('<ellipse ' + earth + ' fill="none" stroke="#6CB6FF" stroke-width="1.5" stroke-dasharray="3 3"/>');
  if (!sunUp) svg.push('<ellipse ' + sun + ' fill="none" stroke="#FFC24B" stroke-width="1.5" stroke-dasharray="3 3"/>');
  const compass = [[0, s.lat > 0 && polar ? 'N · pole' : 'N'], [90, 'E'], [180, s.lat < 0 ? 'S · pole' : 'S'], [270, 'W']]
    .map(([az, l]) => [Xa(az), l, '#A7B2C2'])
    .filter(([x]) => !polar || Math.abs(x - (X0 + PW / 2)) > 60);
  if (polar) compass.push([X0 + PW / 2, '▼ toward Earth', '#7CC0FF']);
  for (const [x, l, fill] of compass) svg.push('<text x="' + x.toFixed(1) + '" y="244" fill="' + fill + '" font-size="13" font-weight="600" font-family="Inter" text-anchor="middle">' + l + '</text>');
  $('sky').innerHTML = svg.join('');

  const ref = mask ? 'horizontal' : 'horizon';
  const hzThere = (el, clr) => mask ? ' · terrain horizon there ' + fmtDeg(el - clr) : '';
  const when = (h) => h === null ? 'no change before Dec 2030 (end of data)' : 'in ≈ ' + fmtH(h);
  const sCross = hoursToCrossing(S.sClr, 0, iNow, STEP_H), eCross = hoursToCrossing(S.eClr, thr, iNow, STEP_H);
  const sunState = sClr >= 0 ? 'Up — sets ' + when(sCross) : 'Down — rises ' + when(sCross);
  const earthState = eClr >= thr ? 'Usable — drops below ' + thr + '° ' + when(eCross)
    : (eClr > 0 ? 'Too low (under ' + thr + '°) — usable ' + when(eCross) : 'Below the horizon — usable ' + when(eCross));
  $('sky').setAttribute('aria-label', 'Sky at ' + s.name + ' on ' + dtLabel(iNow) + '. Sun ' + S.sEl[iNow].toFixed(1) + ' degrees above the ' + ref + ', ' + sunState + '. Earth ' + S.eEl[iNow].toFixed(1) + ' degrees, ' + earthState + '.');
  $('panoNote').textContent = (polar ? 'Centred on the direction to Earth. ' : 'Centred on ' + (s.lat < 0 ? 'south' : 'north') + '. ') +
    (st.trueScale ? 'True scale: 1° up is as tall as 1° across.' : (ex > 1.05 ? 'Height stretched ×' + ex.toFixed(1) + ' so low angles are visible.' : 'Height shown at about true scale.')) +
    ' Sun and Earth are drawn at their real size. Dashed: their paths during the mission; a dashed outline means below the horizon.' +
    (mask ? ' Grey: the terrain skyline from LOLA.' : '');
  $('nowLabel').textContent = dtLabel(iNow) + ' · mission day ' + (Math.floor(tt / SPD) + 1) + ' of ' + st.dur;
  $('tSlider').value = String(tt);

  $('sunEl').textContent = fmtDeg(S.sEl[iNow]);
  $('sunSub').textContent = 'above the ' + ref + ' · azimuth ' + Math.round(S.sAz[iNow]) + '° (for panel pointing)' + hzThere(S.sEl[iNow], sClr);
  $('sunDisc').textContent = Math.round(discFrac(sClr, SUN_R) * 100) + '%';
  $('sunState').textContent = sunState;
  $('earthEl').textContent = fmtDeg(S.eEl[iNow]);
  $('earthSub').textContent = 'above the ' + ref + ' · azimuth ' + Math.round(S.eAz[iNow]) + '°' + hzThere(S.eEl[iNow], eClr);
  $('earthState').textContent = earthState;

  drawLane($('laneSun'), (j) => S.sClr[j] >= 0, '#FFC24B');
  drawLane($('laneEarth'), (j) => S.eClr[j] >= thr, '#6CB6FF');
}

function drawLane(cv, up, color) {
  const { ctx, w, h } = fit(cv, 12), n = steps(), L0 = Lidx(st.day), cw = w / n;
  ctx.fillStyle = color;
  for (let k = 0; k < n; k++) if (up(L0 + k)) ctx.fillRect(k * cw, 0, cw + 0.5, h);
  ring(ctx, st.t * cw, 0, Math.max(3, cw), h, 2, '#FFFFFF');
}

// ---------- verification against JPL Horizons ----------
// Horizons values come from data/horizons_check.json (written by pipeline/horizons_check.py);
// "this page" is computed here with computeSite (observer 0 m, as in the query), so the table stays live.
async function renderVerification() {
  let hz;
  try { hz = await getJSON('data/horizons_check.json'); }
  catch (err) { $('vtable').textContent = 'Could not load ' + err.message + '.'; return; }
  const wrap = (x) => ((x + 180) % 360 + 360) % 360 - 180;
  const cache = new Map(), tol = hz.tolerance_deg;
  let worst = 0, sunAzSum = 0, allOk = true;
  const body = hz.rows.map((r) => {
    const k = r.lat + ',' + r.lon;
    if (!cache.has(k)) cache.set(k, computeSite(E, { lat: r.lat, lon: r.lon }, 0));
    const S = cache.get(k), i = Math.round((Date.parse(r.utc.replace(' ', 'T') + ':00Z') - START) / (STEP_H * 3600000));
    const o = [S.sAz[i], S.sEl[i], S.eAz[i], S.eEl[i]], h = r.horizons;
    const hv = [h.sunAz, h.sunEl, h.earthAz, h.earthEl];
    const d = o.map((x, j) => (j % 2 === 0 ? wrap(x - hv[j]) : x - hv[j]));
    const m = Math.max(...d.map(Math.abs)), ok = m <= tol;
    worst = Math.max(worst, m); sunAzSum += d[0]; allOk = allOk && ok;
    return '<tr><td>' + r.site + '</td><td>' + r.utc + '</td>' + o.map((x, j) => '<td>' + hv[j].toFixed(3) + ' / ' + x.toFixed(3) + '</td>').join('') +
      '<td>' + m.toFixed(4) + '</td><td class="' + (ok ? 'ok' : 'bad') + '">' + (ok ? 'pass' : 'FAIL') + '</td></tr>';
  });
  $('vtable').innerHTML = '<table class="vt"><thead><tr><th>Site</th><th>UTC</th><th>Sun az</th><th>Sun el</th><th>Earth az</th><th>Earth el</th><th>max |Δ|</th><th></th></tr></thead><tbody>' + body.join('') + '</tbody></table>';
  const sites = [...new Set(hz.rows.map((r) => r.site + ' = ' + Math.abs(r.lat) + '°' + (r.lat < 0 ? 'S ' : 'N ') + Math.abs(r.lon) + '°' + (r.lon >= 0 ? 'E' : 'W') + ' (' + r.label + ')'))];
  const meanSun = sunAzSum / hz.rows.length;
  $('vnote').textContent = (allOk ? 'All ' + hz.rows.length + ' checks within ' + tol + '°' : 'Some checks are outside ' + tol + '°') + '; largest difference ' + worst.toFixed(4) + '°. ' +
    'Mean Sun-azimuth difference (this page − Horizons): ' + (meanSun >= 0 ? '+' : '−') + Math.abs(meanSun).toFixed(4) + '°, same sign at every point; cause not investigated. ' +
    sites.join('; ') + '. Horizons answers fetched ' + hz.checked + ' by pipeline/horizons_check.py (raw files are in the repository).';
}

function renderAll() {
  renderControls();
  renderCalendar(false);
  renderReadout();
  renderSuggest();
  renderMission();
  renderNow();
}

// ---------- events ----------
function bind() {
  $('dayPrev').addEventListener('click', () => setDay(st.day - 1));
  $('dayNext').addEventListener('click', () => setDay(st.day + 1));
  $('durDec').addEventListener('click', () => set({ dur: Math.max(1, st.dur - 1), t: 0 }));
  $('durInc').addEventListener('click', () => set({ dur: Math.min(30, st.dur + 1), t: 0 }));
  $('hourSel').addEventListener('change', (e) => set({ hourIdx: Number(e.target.value), t: 0 }));
  $('scaleBtn').addEventListener('click', () => set({ trueScale: !st.trueScale }));
  for (const b of $('hzOpts').children) b.addEventListener('click', () => set({ terrain: b.dataset.v === 'lola' }));
  $('wsPrev').addEventListener('click', () => set({ ws: st.ws - 30 }));
  $('wsNext').addEventListener('click', () => set({ ws: st.ws + 30 }));
  $('tSlider').addEventListener('input', (e) => { st.t = Number(e.target.value); renderNow(); });

  $('playBtn').addEventListener('click', () => {
    const b = $('playBtn');
    if (timer) { clearInterval(timer); timer = null; b.textContent = '▶'; b.setAttribute('aria-label', 'Play the mission'); return; }
    timer = setInterval(() => { st.t = (st.t + 1) % steps(); renderNow(); }, 140);
    b.textContent = '❚❚'; b.setAttribute('aria-label', 'Pause');
  });

  // Calendar: hover reads, click selects, arrow keys move (one tab stop).
  const cell = (e) => {
    const r = $('calCv').getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const si = Math.floor(y / (ROW_H + ROW_GAP)), k = Math.floor(x / (r.width / WIN));
    const sites = allSites();
    if (si < 0 || si >= sites.length || y - si * (ROW_H + ROW_GAP) > ROW_H || k < 0 || k >= WIN) return null;
    return { s: sites[si].id, d: st.ws + k };
  };
  $('calCv').addEventListener('pointermove', (e) => {
    const c = cell(e), h = st.hover;
    if ((c && (!h || h.s !== c.s || h.d !== c.d)) || (!c && h)) { st.hover = c; renderReadout(); }
  });
  $('grid').addEventListener('pointerleave', () => { if (st.hover) { st.hover = null; renderReadout(); } });
  $('calCv').addEventListener('click', (e) => { const c = cell(e); if (c) { st.hover = null; setDay(c.d, { siteId: c.s }); } });
  $('grid').addEventListener('keydown', (e) => {
    const sites = allSites(), i = sites.indexOf(curSite());
    if (e.key === 'ArrowRight') setDay(st.day + 1);
    else if (e.key === 'ArrowLeft') setDay(st.day - 1);
    else if (e.key === 'ArrowDown') set({ siteId: sites[Math.min(sites.length - 1, i + 1)].id, t: 0 });
    else if (e.key === 'ArrowUp') set({ siteId: sites[Math.max(0, i - 1)].id, t: 0 });
    else return;
    e.preventDefault();
    st.hover = null; renderReadout();
  });
  $('ovCv').addEventListener('click', (e) => {
    const r = $('ovCv').getBoundingClientRect(), wk = Math.floor((e.clientX - r.left) / (r.width / ovVals.length));
    if (wk >= 0 && wk < ovVals.length) setDay(wk * 7, { ws: wk * 7 });
  });

  $('customForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const msg = $('cMsg');
    const la = parseFloat($('cLat').value.replace(',', '.')), lo0 = parseFloat($('cLon').value.replace(',', '.'));
    if (!(la >= -90 && la <= 90) || !(lo0 >= -180 && lo0 <= 360)) {
      msg.textContent = 'Enter latitude −90…90 (south negative) and longitude −180…360 (east positive).'; msg.classList.add('err'); return;
    }
    const lo = lo0 > 180 ? lo0 - 360 : lo0;
    const id = 'c' + custom.length + '_' + la.toFixed(4) + '_' + lo.toFixed(4);
    custom.push({ id, name: ($('cName').value.trim() || 'My point').slice(0, 24), tag: 'Your point', lat: la, lon: lo });
    $('cName').value = $('cLat').value = $('cLon').value = '';
    msg.textContent = 'Added to the calendar and the sky view.'; msg.classList.remove('err');
    set({ siteId: id, t: 0 });
  });

  new ResizeObserver(() => { drawCalendar(); drawOverview(); renderNow(); }).observe($('calCv').parentElement);
}

// ---------- start ----------
function getJSON(url) {
  return fetch(url).then((r) => { if (!r.ok) throw new Error(url + ' (HTTP ' + r.status + ')'); return r.json(); })
    .catch((err) => { throw new Error(err.message.startsWith(url) ? err.message : url + ' (' + err.message + ')'); });
}

Promise.all([getJSON('data/ephemeris.json'), getJSON('data/sites.json')]).then(([eph, sites]) => {
  E = eph; N = E.sLat.length; STEP_H = E.stepH; SPD = Math.round(24 / STEP_H); START = Date.parse(E.start);
  SITES = sites.sites;
  $('hourSel').innerHTML = Array.from({ length: SPD }, (_, k) => '<option value="' + k + '">' + pad2(dateAt(k).getUTCHours()) + ':00 UTC</option>').join('');
  $('thrOpts').innerHTML = [0, 2, 5].map((v) => '<button type="button" class="btn opt" data-v="' + v + '" aria-pressed="false">' + v + '°</button>').join('');
  for (const b of $('thrOpts').children) b.addEventListener('click', () => set({ thr: Number(b.dataset.v) }));
  bind();
  norm();
  renderVerification();
  renderAll();
}).catch((err) => {
  const el = $('error');
  el.textContent = 'Could not load ' + err.message + '. Reload the page to try again.';
  el.hidden = false;
  $('readout').textContent = 'No data.';
  $('windowLabel').textContent = '—';
});
