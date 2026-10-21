import type { Lap, Segment } from '../types';
import {
  gridPointsFor,
  resampleLap,
  segmentTime,
  timeAtFraction,
  valueAtFraction,
  type LapTrace,
  type TelemetrySource,
} from '../telemetry-metrics';
import { mean, stdDev } from '../telemetry-metrics/signal';

export interface SegmentMetrics {
  time: number;
  entrySpeed: number;
  exitSpeed: number;
  minSpeed: number;
  minSpeedAt: number;
  maxSpeed: number;
  maxDecel: number;
  /** Início de frenagem (fração). Medido pelo canal de freio ou estimado pela desaceleração. */
  brakeStart: number | null;
  brakeOrigin: 'brake-channel' | 'accel-measured' | 'accel-derived' | null;
  /** Retomada do acelerador após o ápice (fração). Só existe com canal de acelerador. */
  throttlePickup: number | null;
}

export interface SegmentComparison {
  segment: Segment;
  ref: SegmentMetrics;
  cmp: SegmentMetrics;
  /** Positivo = volta comparada mais lenta no segmento. */
  timeDelta: number;
  entryDelta: number;
  minDelta: number;
  exitDelta: number;
  /** Metros; negativo = volta comparada freia antes da referência. */
  brakeDelta: number | null;
  throttleDelta: number | null;
}

export interface LapComparison {
  ref: LapTrace;
  cmp: LapTrace;
  /** Distância de referência (m) usada para escalar o eixo x. */
  scale: number;
  /** Diferença de tempo acumulado: cmp − ref (s) em cada ponto da grade. */
  delta: number[];
  speedDiff: number[];
  segments: SegmentComparison[];
  totalDelta: number;
}

const BRAKE_DECEL = -0.3; // g

/** Reamostra todas as voltas na mesma grade, dimensionada pela volta de referência. */
export function buildTraces(src: TelemetrySource, referenceLap: number | null): Map<number, LapTrace> {
  const ref = src.laps.find((l) => l.number === referenceLap) ?? src.laps[0];
  const out = new Map<number, LapTrace>();
  if (!ref) return out;
  const pts = gridPointsFor(Number.isFinite(ref.distance) ? ref.distance : 1000);
  for (const lap of src.laps) {
    const tr = resampleLap(src, lap, pts);
    if (tr) out.set(lap.number, tr);
  }
  return out;
}

function idxOf(trace: LapTrace, f: number): number {
  return Math.min(trace.frac.length - 1, Math.max(0, Math.round(f * (trace.frac.length - 1))));
}

export function segmentMetrics(trace: LapTrace, seg: Segment, brakeSearchStart: number): SegmentMetrics {
  const a = idxOf(trace, seg.start);
  const b = idxOf(trace, seg.end);
  let minSpeed = Infinity;
  let minIdx = a;
  let maxSpeed = -Infinity;
  let maxDecel = 0;
  for (let i = a; i <= b; i++) {
    const v = trace.speed[i];
    if (Number.isFinite(v)) {
      if (v < minSpeed) {
        minSpeed = v;
        minIdx = i;
      }
      if (v > maxSpeed) maxSpeed = v;
    }
    const ac = trace.accel[i];
    if (Number.isFinite(ac) && ac < maxDecel) maxDecel = ac;
  }
  const apexIdx = seg.kind === 'corner' ? (seg.apex !== undefined ? idxOf(trace, seg.apex) : minIdx) : minIdx;

  let brakeStart: number | null = null;
  let brakeOrigin: SegmentMetrics['brakeOrigin'] = null;
  if (seg.kind === 'corner') {
    const s = idxOf(trace, brakeSearchStart);
    if (trace.brake) {
      let maxB = 0;
      for (const v of trace.brake) if (Number.isFinite(v) && v > maxB) maxB = v;
      const th = maxB * 0.1;
      for (let i = s; i <= apexIdx; i++) if (trace.brake[i] > th) {
        brakeStart = trace.frac[i];
        brakeOrigin = 'brake-channel';
        break;
      }
    }
    if (brakeStart === null && trace.accelOrigin !== 'none') {
      const step = trace.distance / (trace.frac.length - 1);
      const sustain = Math.max(2, Math.round(3 / step));
      for (let i = s; i <= apexIdx - sustain; i++) {
        let ok = true;
        for (let q = i; q < i + sustain; q++) if (!(trace.accel[q] < BRAKE_DECEL)) {
          ok = false;
          break;
        }
        if (ok) {
          brakeStart = trace.frac[i];
          brakeOrigin = trace.accelOrigin === 'measured' ? 'accel-measured' : 'accel-derived';
          break;
        }
      }
    }
  }

  let throttlePickup: number | null = null;
  if (trace.throttle && seg.kind === 'corner') {
    const end = Math.min(trace.frac.length - 1, b + Math.round((b - a) * 0.5));
    for (let i = apexIdx; i <= end; i++) if (trace.throttle[i] >= 80) {
      throttlePickup = trace.frac[i];
      break;
    }
  }

  return {
    time: segmentTime(trace, seg),
    entrySpeed: valueAtFraction(trace, trace.speed, seg.start),
    exitSpeed: valueAtFraction(trace, trace.speed, seg.end),
    minSpeed: Number.isFinite(minSpeed) ? minSpeed : NaN,
    minSpeedAt: trace.frac[minIdx],
    maxSpeed: Number.isFinite(maxSpeed) ? maxSpeed : NaN,
    maxDecel,
    brakeStart,
    brakeOrigin,
    throttlePickup,
  };
}

/** Onde começar a procurar o ponto de frenagem: início do segmento anterior quando ele é uma reta. */
export function brakeSearchStart(segments: Segment[], i: number): number {
  const prev = segments[i - 1];
  return prev && prev.kind === 'straight' ? prev.start : segments[i].start;
}

export function compareLaps(ref: LapTrace, cmp: LapTrace, segments: Segment[]): LapComparison {
  const n = ref.frac.length;
  const delta = new Array<number>(n);
  const speedDiff = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const f = ref.frac[i];
    delta[i] = timeAtFraction(cmp, f) - ref.time[i];
    speedDiff[i] = valueAtFraction(cmp, cmp.speed, f) - ref.speed[i];
  }
  const scale = ref.distance;
  const segs = segments.map((segment, i) => {
    const bs = brakeSearchStart(segments, i);
    const r = segmentMetrics(ref, segment, bs);
    const c = segmentMetrics(cmp, segment, bs);
    return {
      segment,
      ref: r,
      cmp: c,
      timeDelta: c.time - r.time,
      entryDelta: c.entrySpeed - r.entrySpeed,
      minDelta: c.minSpeed - r.minSpeed,
      exitDelta: c.exitSpeed - r.exitSpeed,
      brakeDelta: r.brakeStart !== null && c.brakeStart !== null ? (c.brakeStart - r.brakeStart) * scale : null,
      throttleDelta: r.throttlePickup !== null && c.throttlePickup !== null ? (c.throttlePickup - r.throttlePickup) * scale : null,
    };
  });
  return { ref, cmp, scale, delta, speedDiff, segments: segs, totalDelta: cmp.lapTime - ref.lapTime };
}

export interface SegmentStats {
  segment: Segment;
  times: { lap: number; time: number }[];
  best: number;
  bestLap: number;
  mean: number;
  std: number;
}

/** Estatística de cada segmento entre as voltas incluídas (base da consistência por segmento). */
export function segmentStats(traces: LapTrace[], segments: Segment[]): SegmentStats[] {
  return segments.map((segment) => {
    const times = traces.map((tr) => ({ lap: tr.lapNumber, time: segmentTime(tr, segment) }));
    const best = times.reduce((a, b) => (b.time < a.time ? b : a), times[0] ?? { lap: -1, time: NaN });
    return {
      segment,
      times,
      best: best.time,
      bestLap: best.lap,
      mean: mean(times.map((t) => t.time)),
      std: stdDev(times.map((t) => t.time)),
    };
  });
}

export function includedTraces(traces: Map<number, LapTrace>, laps: Lap[]): LapTrace[] {
  return laps.filter((l) => l.included).map((l) => traces.get(l.number)).filter((t): t is LapTrace => !!t);
}
