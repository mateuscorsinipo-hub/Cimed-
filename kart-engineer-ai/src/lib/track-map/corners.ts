import type { Segment, XY } from '../types';
import type { LapTrace } from '../telemetry-metrics';
import { movingAverage } from '../telemetry-metrics/signal';
import { curvature } from './geometry';

interface Zone {
  start: number;
  end: number;
  apex: number;
  direction?: 'L' | 'R';
}

const KAPPA_THRESHOLD = 1 / 70; // raio < 70 m é tratado como curva
const SPEED_PROMINENCE = 1.7; // m/s (~6 km/h)

/** Transforma zonas de curva (índices da grade) numa partição completa da volta. */
export function zonesToSegments(zones: Zone[], n: number, source: Segment['source']): Segment[] {
  const sorted = [...zones].sort((a, b) => a.start - b.start);
  // Remove sobreposições.
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start <= sorted[i - 1].end) {
      const mid = Math.round((sorted[i - 1].apex + sorted[i].apex) / 2);
      sorted[i - 1].end = mid;
      sorted[i].start = mid + 1;
    }
  }
  const minStraight = Math.max(3, Math.round(n * 0.01));
  const segs: Segment[] = [];
  const f = (i: number) => Math.min(1, Math.max(0, i / (n - 1)));
  let cursor = 0;
  sorted.forEach((z, k) => {
    const cornerNo = k + 1;
    if (z.start - cursor >= minStraight) {
      segs.push({
        id: `s${segs.length}`,
        name: k === 0 ? 'Largada → C1' : `C${k} → C${cornerNo}`,
        kind: 'straight',
        start: f(cursor),
        end: f(z.start),
        source,
      });
    } else if (segs.length) {
      segs[segs.length - 1].end = f(z.start);
    } else {
      z.start = cursor;
    }
    segs.push({
      id: `c${cornerNo}`,
      name: `Curva ${cornerNo}`,
      kind: 'corner',
      start: segs.length ? segs[segs.length - 1].end : f(z.start),
      end: f(z.end),
      apex: f(z.apex),
      direction: z.direction,
      source,
    });
    cursor = z.end;
  });
  if (n - 1 - cursor >= minStraight) {
    segs.push({ id: `s${segs.length}`, name: sorted.length ? `C${sorted.length} → Chegada` : 'Volta', kind: 'straight', start: f(cursor), end: 1, source });
  } else if (segs.length) segs[segs.length - 1].end = 1;
  if (segs.length) segs[0].start = 0;
  return segs;
}

/** Curvas a partir da geometria GPS (curvatura da trajetória da volta de referência). */
export function detectCornersFromGeometry(trace: LapTrace): Segment[] {
  if (!trace.x || !trace.y) return [];
  const n = trace.frac.length;
  const step = trace.distance / (n - 1);
  const pts: XY[] = trace.x.map((x, i) => ({ x, y: trace.y![i] }));
  const span = Math.max(2, Math.round(5 / step));
  const k = movingAverage(curvature(pts, span), Math.max(3, Math.round(9 / step)));
  const minLen = Math.round(6 / step);
  const mergeGap = Math.round(8 / step);
  const runs: Zone[] = [];
  let i = 0;
  while (i < n) {
    if (Math.abs(k[i]) < KAPPA_THRESHOLD) {
      i++;
      continue;
    }
    const sign = Math.sign(k[i]);
    let j = i;
    while (j + 1 < n && Math.abs(k[j + 1]) >= KAPPA_THRESHOLD && Math.sign(k[j + 1]) === sign) j++;
    const prev = runs[runs.length - 1];
    const dir: 'L' | 'R' = sign > 0 ? 'L' : 'R';
    if (prev && prev.direction === dir && i - prev.end <= mergeGap) prev.end = j;
    else runs.push({ start: i, end: j, apex: i, direction: dir });
    i = j + 1;
  }
  const minAt = (a: number, b: number) => {
    let m = a;
    for (let q = a; q <= b; q++) if (trace.speed[q] < trace.speed[m]) m = q;
    return m;
  };
  const hasSpeed = trace.speed.some(Number.isFinite);
  // Uma curva = um mínimo de velocidade. Zonas vizinhas no mesmo sentido sem
  // retomada significativa de velocidade entre elas são a mesma curva.
  const merged: Zone[] = [];
  for (const r of runs.filter((z) => z.end - z.start >= minLen)) {
    const prev = merged[merged.length - 1];
    if (prev && hasSpeed && prev.direction === r.direction && r.start - prev.end <= Math.round(40 / step)) {
      const a = minAt(prev.start, prev.end);
      const b = minAt(r.start, r.end);
      let peak = -Infinity;
      for (let q = a; q <= b; q++) if (trace.speed[q] > peak) peak = trace.speed[q];
      if (peak - Math.max(trace.speed[a], trace.speed[b]) < 1.5) {
        prev.end = r.end;
        continue;
      }
    }
    merged.push({ ...r });
  }
  const zones = merged
    .map((r) => {
      // Ápice estimado: menor velocidade na zona; sem velocidade, maior curvatura.
      let apex = r.start;
      let best = Infinity;
      for (let q = r.start; q <= r.end; q++) {
        const score = Number.isFinite(trace.speed[q]) ? trace.speed[q] : -Math.abs(k[q]);
        if (score < best) {
          best = score;
          apex = q;
        }
      }
      // Inclui a zona de frenagem antes da curva e parte da retomada após.
      return {
        start: Math.max(0, r.start - Math.round(15 / step)),
        end: Math.min(n - 1, r.end + Math.round(8 / step)),
        apex,
        direction: r.direction,
      };
    });
  return zones.length ? zonesToSegments(zones, n, 'gps-curvature') : [];
}

/** Curvas a partir de mínimos locais de velocidade (sem GPS). */
export function detectCornersFromSpeed(trace: LapTrace): Segment[] {
  const n = trace.frac.length;
  if (!trace.speed.some(Number.isFinite)) return [];
  const step = trace.distance / (n - 1);
  const v = movingAverage(trace.speed, Math.max(3, Math.round(15 / step)));
  const zones: Zone[] = [];
  const win = Math.max(3, Math.round(20 / step));
  for (let i = win; i < n - win; i++) {
    let isMin = true;
    for (let q = i - win; q <= i + win; q++) if (v[q] < v[i]) {
      isMin = false;
      break;
    }
    if (!isMin) continue;
    let a = i;
    let peakL = v[i];
    while (a > 0 && v[a - 1] >= v[a] - 1e-6) {
      a--;
      peakL = Math.max(peakL, v[a]);
    }
    let b = i;
    let peakR = v[i];
    while (b < n - 1 && v[b + 1] >= v[b] - 1e-6) {
      b++;
      peakR = Math.max(peakR, v[b]);
    }
    if (Math.min(peakL, peakR) - v[i] < SPEED_PROMINENCE) continue;
    const thL = v[i] + 0.5 * (peakL - v[i]);
    const thR = v[i] + 0.5 * (peakR - v[i]);
    let s = i;
    while (s > a && v[s] < thL) s--;
    let e = i;
    while (e < b && v[e] < thR) e++;
    if (zones.length && i - zones[zones.length - 1].apex < win) continue;
    zones.push({ start: s, end: e, apex: i });
  }
  return zones.length ? zonesToSegments(zones, n, 'speed-profile') : [];
}

/** Setores iguais como último recurso quando nenhuma curva é identificável. */
export function equalSectors(count = 3): Segment[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `sec${i + 1}`,
    name: `Setor ${i + 1}`,
    kind: 'straight' as const,
    start: i / count,
    end: (i + 1) / count,
    source: 'sectors' as const,
  }));
}

export function detectSegments(trace: LapTrace): Segment[] {
  const geo = detectCornersFromGeometry(trace);
  if (geo.length >= 3) return geo;
  const sp = detectCornersFromSpeed(trace);
  if (sp.length >= 2) return sp;
  return equalSectors(3);
}

export const SEGMENT_SOURCE_LABEL: Record<Segment['source'], string> = {
  'gps-curvature': 'Curvatura da trajetória GPS',
  'speed-profile': 'Mínimos de velocidade',
  manual: 'Definido manualmente',
  sectors: 'Setores iguais (sem curvas identificáveis)',
};
