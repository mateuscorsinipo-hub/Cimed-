import type { XY } from '../types';
import { fillGaps, movingAverage } from '../telemetry-metrics/signal';

export const EARTH_RADIUS = 6371008.8;

export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Projeção equiretangular local em metros, centrada na média das coordenadas.
 * Para a extensão de um kartódromo (< 2 km) o erro é desprezível frente ao ruído do GPS.
 */
export function projectLatLon(lat: number[], lon: number[]): { x: number[]; y: number[]; lat0: number; lon0: number } {
  let sLat = 0;
  let sLon = 0;
  let c = 0;
  for (let i = 0; i < lat.length; i++) {
    if (Number.isFinite(lat[i]) && Number.isFinite(lon[i])) {
      sLat += lat[i];
      sLon += lon[i];
      c++;
    }
  }
  const lat0 = c ? sLat / c : 0;
  const lon0 = c ? sLon / c : 0;
  const r = Math.PI / 180;
  const kx = Math.cos(lat0 * r) * EARTH_RADIUS * r;
  const ky = EARTH_RADIUS * r;
  const x = lon.map((v, i) => (Number.isFinite(v) && Number.isFinite(lat[i]) ? (v - lon0) * kx : NaN));
  const y = lat.map((v, i) => (Number.isFinite(v) && Number.isFinite(lon[i]) ? (v - lat0) * ky : NaN));
  return { x, y, lat0, lon0 };
}

export interface GpsCleanResult {
  x: number[];
  y: number[];
  rejected: number;
}

/**
 * Remove saltos fisicamente impossíveis (velocidade implícita > maxSpeed),
 * interpola lacunas e suaviza a trajetória com janela proporcional à taxa de amostragem.
 * O resultado continua sendo uma estimativa sujeita à precisão do receptor.
 */
export function cleanGps(x: number[], y: number[], t: number[], sampleRate: number, maxSpeed = 55): GpsCleanResult {
  const cx = x.slice();
  const cy = y.slice();
  let rejected = 0;
  let last = -1;
  for (let i = 0; i < cx.length; i++) {
    if (!Number.isFinite(cx[i]) || !Number.isFinite(cy[i])) continue;
    if (last >= 0) {
      const dt = t[i] - t[last];
      const d = Math.hypot(cx[i] - cx[last], cy[i] - cy[last]);
      if (dt > 0 && d / dt > maxSpeed && d > 3) {
        cx[i] = NaN;
        cy[i] = NaN;
        rejected++;
        continue;
      }
    }
    last = i;
  }
  const w = Math.max(1, Math.round(sampleRate * 0.25));
  return { x: movingAverage(fillGaps(cx), w), y: movingAverage(fillGaps(cy), w), rejected };
}

export function cumulativeDistance(x: number[], y: number[]): number[] {
  const d = new Array<number>(x.length);
  d[0] = 0;
  for (let i = 1; i < x.length; i++) {
    const s = Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1]);
    d[i] = d[i - 1] + (Number.isFinite(s) ? s : 0);
  }
  return d;
}

export function polylineLength(p: XY[]): number {
  let L = 0;
  for (let i = 1; i < p.length; i++) L += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
  return L;
}

export function cumulativeLengths(p: XY[]): number[] {
  const out = [0];
  for (let i = 1; i < p.length; i++) out.push(out[i - 1] + Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y));
  return out;
}

/** Ponto a uma fração (0..1) do comprimento da polilinha. */
export function pointAtFraction(p: XY[], cum: number[], f: number): XY & { angle: number } {
  if (p.length < 2) return { x: p[0]?.x ?? 0, y: p[0]?.y ?? 0, angle: 0 };
  const L = cum[cum.length - 1];
  const target = Math.min(Math.max(f, 0), 1) * L;
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= target) lo = mid;
    else hi = mid;
  }
  const seg = cum[hi] - cum[lo] || 1;
  const k = (target - cum[lo]) / seg;
  return {
    x: p[lo].x + (p[hi].x - p[lo].x) * k,
    y: p[lo].y + (p[hi].y - p[lo].y) * k,
    angle: Math.atan2(p[hi].y - p[lo].y, p[hi].x - p[lo].x),
  };
}

/** Reamostra a polilinha em passos de comprimento constante. */
export function resamplePolyline(p: XY[], step: number): XY[] {
  const cum = cumulativeLengths(p);
  const L = cum[cum.length - 1];
  if (!(L > 0)) return p.slice();
  const n = Math.max(2, Math.round(L / step) + 1);
  const out: XY[] = [];
  for (let i = 0; i < n; i++) {
    const q = pointAtFraction(p, cum, i / (n - 1));
    out.push({ x: q.x, y: q.y });
  }
  return out;
}

export interface NearestResult {
  /** Distância ao longo da polilinha (m). */
  along: number;
  /** Desvio lateral com sinal: positivo à esquerda do sentido de percurso. */
  lateral: number;
  index: number;
}

/** Projeção de um ponto na polilinha (busca local opcional a partir de um índice de dica). */
export function nearestOnPolyline(q: XY, p: XY[], cum: number[], hint = -1, window = 80): NearestResult {
  let best = Infinity;
  let res: NearestResult = { along: 0, lateral: 0, index: 0 };
  const n = p.length;
  const from = hint >= 0 ? Math.max(0, hint - window) : 0;
  const to = hint >= 0 ? Math.min(n - 1, hint + window) : n - 1;
  for (let i = from; i < to; i++) {
    const a = p[i];
    const b = p[i + 1];
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const len2 = vx * vx + vy * vy || 1e-9;
    let k = ((q.x - a.x) * vx + (q.y - a.y) * vy) / len2;
    k = Math.max(0, Math.min(1, k));
    const px = a.x + vx * k;
    const py = a.y + vy * k;
    const d = Math.hypot(q.x - px, q.y - py);
    if (d < best) {
      best = d;
      const cross = vx * (q.y - a.y) - vy * (q.x - a.x);
      res = { along: cum[i] + Math.sqrt(len2) * k, lateral: Math.sign(cross) * d, index: i };
    }
  }
  return res;
}

/**
 * Curvatura com sinal (1/m) de uma polilinha uniformemente reamostrada,
 * estimada pela variação de direção numa janela de ±span pontos.
 */
export function curvature(p: XY[], span: number): number[] {
  const n = p.length;
  const out = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const a = p[Math.max(0, i - span)];
    const b = p[i];
    const c = p[Math.min(n - 1, i + span)];
    const h1 = Math.atan2(b.y - a.y, b.x - a.x);
    const h2 = Math.atan2(c.y - b.y, c.x - b.x);
    let dh = h2 - h1;
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    const s = (Math.hypot(b.x - a.x, b.y - a.y) + Math.hypot(c.x - b.x, c.y - b.y)) / 2;
    out[i] = s > 0 ? dh / s : 0;
  }
  return out;
}

export function bounds(points: XY[]): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, maxX, minY, maxY };
}

/** Spline Catmull-Rom fechada, usada para suavizar traçados desenhados à mão. */
export function catmullRomClosed(ctrl: XY[], samplesPerSeg = 16): XY[] {
  const n = ctrl.length;
  if (n < 3) return ctrl.slice();
  const out: XY[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n];
    const p1 = ctrl[i];
    const p2 = ctrl[(i + 1) % n];
    const p3 = ctrl[(i + 2) % n];
    for (let s = 0; s < samplesPerSeg; s++) {
      const t = s / samplesPerSeg;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  out.push({ ...out[0] });
  return out;
}
