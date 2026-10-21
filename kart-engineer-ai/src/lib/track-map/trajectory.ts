import type { Segment, XY } from '../types';
import type { LapTrace } from '../telemetry-metrics';
import { cumulativeLengths, nearestOnPolyline } from './geometry';

export function tracePoints(trace: LapTrace): XY[] | null {
  if (!trace.x || !trace.y) return null;
  return trace.x.map((x, i) => ({ x, y: trace.y![i] }));
}

/**
 * Desvio lateral (m) de cada ponto da volta comparada em relação à trajetória
 * de referência. Positivo = à esquerda do sentido de percurso da referência.
 * Precisão limitada pelo GPS (tipicamente 1–3 m em receptores de 10–25 Hz).
 */
export function lateralDeviation(ref: XY[], cmp: XY[]): number[] {
  const cum = cumulativeLengths(ref);
  const n = cmp.length;
  const out = new Array<number>(n);
  const ratio = (ref.length - 1) / Math.max(1, n - 1);
  for (let i = 0; i < n; i++) {
    const hint = Math.round(i * ratio);
    out[i] = nearestOnPolyline(cmp[i], ref, cum, hint, 60).lateral;
  }
  return out;
}

export interface SegmentDeviation {
  segmentId: string;
  mean: number;
  maxAbs: number;
  atApex: number;
}

export function segmentDeviation(dev: number[], seg: Segment): SegmentDeviation {
  const n = dev.length;
  const a = Math.round(seg.start * (n - 1));
  const b = Math.round(seg.end * (n - 1));
  let s = 0;
  let c = 0;
  let maxAbs = 0;
  for (let i = a; i <= b; i++) {
    if (!Number.isFinite(dev[i])) continue;
    s += dev[i];
    c++;
    if (Math.abs(dev[i]) > Math.abs(maxAbs)) maxAbs = dev[i];
  }
  const apexIdx = seg.apex !== undefined ? Math.round(seg.apex * (n - 1)) : Math.round((a + b) / 2);
  return { segmentId: seg.id, mean: c ? s / c : NaN, maxAbs, atApex: dev[apexIdx] };
}

/** Fração (0..1) do ponto da trajetória mais próximo de um clique no mapa. */
export function fractionAtPoint(points: XY[], q: XY): number {
  const cum = cumulativeLengths(points);
  const r = nearestOnPolyline(q, points, cum);
  return cum[cum.length - 1] > 0 ? r.along / cum[cum.length - 1] : 0;
}

/** Limiar abaixo do qual um desvio lateral é indistinguível do ruído do GPS. */
export function gpsNoiseFloor(sampleRate: number): number {
  return sampleRate >= 18 ? 1.0 : sampleRate >= 9 ? 1.5 : 2.5;
}
