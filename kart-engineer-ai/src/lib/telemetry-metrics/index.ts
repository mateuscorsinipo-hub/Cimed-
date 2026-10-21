import type { Channels, ChannelKey, ChannelOrigin, Lap, Segment, SessionSummary } from '../types';
import { derivative, interp, interpMany, mean, minMax, movingAverage, stdDev } from './signal';

export * from './signal';
export * from './derive';

export const G = 9.80665;

/** Dados mínimos de uma sessão necessários para os cálculos. */
export interface TelemetrySource {
  channels: Channels;
  origins: Partial<Record<ChannelKey, ChannelOrigin>>;
  xy?: { x: number[]; y: number[] };
  laps: Lap[];
}

export interface LapTrace {
  lapNumber: number;
  lapTime: number;
  distance: number;
  /** Fração da volta (0..1) — eixo comum para comparar voltas equivalentes. */
  frac: number[];
  /** Tempo decorrido desde o início da volta (s). */
  time: number[];
  speed: number[];
  /** Aceleração longitudinal (g): medida se existir canal, senão derivada da velocidade. */
  accel: number[];
  accelOrigin: ChannelOrigin | 'none';
  accelLat?: number[];
  rpm?: number[];
  throttle?: number[];
  brake?: number[];
  steering?: number[];
  x?: number[];
  y?: number[];
}

const OPTIONAL: ChannelKey[] = ['accelLat', 'rpm', 'throttle', 'brake', 'steering'];

/** Valor de um canal em um instante arbitrário (interpolação linear no tempo). */
export function valueAtTime(time: number[], values: number[], t: number): number {
  return interp(time, values, t);
}

/**
 * Reamostra uma volta numa grade uniforme de fração de distância.
 * Inclui os instantes exatos de início e fim (interpolados) para que o tempo
 * acumulado na fração 1 seja exatamente o tempo de volta.
 */
export function resampleLap(src: TelemetrySource, lap: Lap, points: number): LapTrace | null {
  const { channels } = src;
  const t = channels.time;
  const dist = channels.distance;
  if (!dist) return null;
  const idx: number[] = [];
  for (let i = lap.startIdx; i <= lap.endIdx; i++) idx.push(i);
  const tAbs = [lap.startTime, ...idx.map((i) => t[i]).filter((v) => v > lap.startTime && v < lap.endTime), lap.endTime];
  const dAbs = tAbs.map((v) => interp(t, dist, v));
  const d0 = dAbs[0];
  const L = dAbs[dAbs.length - 1] - d0;
  if (!(L > 10)) return null;

  // Sequência estritamente crescente em distância (descarta trechos parados).
  const f: number[] = [];
  const tt: number[] = [];
  for (let k = 0; k < tAbs.length; k++) {
    const fr = (dAbs[k] - d0) / L;
    if (f.length && fr <= f[f.length - 1]) continue;
    f.push(fr);
    tt.push(tAbs[k]);
  }
  if (f[f.length - 1] < 1) {
    f.push(1);
    tt.push(lap.endTime);
  }

  const grid = Array.from({ length: points }, (_, i) => i / (points - 1));
  const tGridAbs = interpMany(f, tt, grid);
  const at = (arr: number[]) => tGridAbs.map((q) => interp(t, arr, q));
  const time = tGridAbs.map((q) => q - lap.startTime);
  time[time.length - 1] = lap.lapTime;

  const speed = channels.speed ? at(channels.speed) : grid.map(() => NaN);
  let accel: number[];
  let accelOrigin: LapTrace['accelOrigin'];
  if (channels.accelLong) {
    accel = at(channels.accelLong);
    accelOrigin = src.origins.accelLong ?? 'measured';
  } else if (channels.speed) {
    const w = Math.max(3, Math.round(points / Math.max(L / 6, 1)));
    accel = movingAverage(derivative(speed, time), w).map((a) => a / G);
    accelOrigin = 'derived';
  } else {
    accel = grid.map(() => NaN);
    accelOrigin = 'none';
  }

  const trace: LapTrace = { lapNumber: lap.number, lapTime: lap.lapTime, distance: L, frac: grid, time, speed, accel, accelOrigin };
  for (const k of OPTIONAL) {
    const arr = channels[k];
    if (arr) (trace as unknown as Record<string, number[]>)[k] = at(arr);
  }
  if (src.xy) {
    trace.x = at(src.xy.x);
    trace.y = at(src.xy.y);
  }
  return trace;
}

/** Número de pontos da grade: ~1 ponto por metro, limitado para manter a interface fluida. */
export function gridPointsFor(distance: number): number {
  return Math.max(200, Math.min(3000, Math.round(distance)));
}

export interface SpeedStats {
  min: number;
  max: number;
  avg: number;
  minAt: number;
  maxAt: number;
}

/** Estatísticas de velocidade; a média é distância/tempo (não a média das amostras). */
export function speedStats(trace: LapTrace): SpeedStats {
  const mm = minMax(trace.speed);
  return {
    min: mm.min,
    max: mm.max,
    avg: trace.distance / trace.lapTime,
    minAt: mm.minIdx >= 0 ? trace.frac[mm.minIdx] : NaN,
    maxAt: mm.maxIdx >= 0 ? trace.frac[mm.maxIdx] : NaN,
  };
}

/** Tempo decorrido na fração f da volta. */
export function timeAtFraction(trace: LapTrace, f: number): number {
  return interp(trace.frac, trace.time, f);
}

export function valueAtFraction(trace: LapTrace, values: number[] | undefined, f: number): number {
  return values ? interp(trace.frac, values, f) : NaN;
}

/** Tempo por setor/segmento: diferença de tempo acumulado entre as frações de início e fim. */
export function segmentTime(trace: LapTrace, seg: Pick<Segment, 'start' | 'end'>): number {
  return timeAtFraction(trace, seg.end) - timeAtFraction(trace, seg.start);
}

export interface ConsistencyStats {
  std: number;
  cv: number;
  range: number;
  count: number;
}

/** Consistência: desvio-padrão amostral e coeficiente de variação dos tempos válidos. */
export function consistency(times: number[]): ConsistencyStats {
  const v = times.filter(Number.isFinite);
  const m = mean(v);
  const s = stdDev(v);
  const mm = minMax(v);
  return { std: s, cv: s / m, range: mm.max - mm.min, count: v.length };
}

export function includedLaps(laps: Lap[]): Lap[] {
  return laps.filter((l) => l.included);
}

export function fastestLap(laps: Lap[]): Lap | null {
  const inc = includedLaps(laps);
  if (!inc.length) return null;
  return inc.reduce((a, b) => (b.lapTime < a.lapTime ? b : a));
}

/**
 * Resumo da sessão. A "volta ideal teórica" é a soma dos melhores tempos de cada
 * segmento entre voltas incluídas — um cálculo, não uma previsão de desempenho.
 */
export function summarize(src: TelemetrySource, segments: Segment[], traces?: LapTrace[]): SessionSummary {
  const inc = includedLaps(src.laps);
  const times = inc.map((l) => l.lapTime);
  const best = fastestLap(src.laps);
  const c = consistency(times);
  let maxSpeed: number | null = null;
  if (src.channels.speed && inc.length) {
    let m = -Infinity;
    for (const l of inc) for (let i = l.startIdx; i <= l.endIdx; i++) {
      const v = src.channels.speed[i];
      if (Number.isFinite(v) && v > m) m = v;
    }
    maxSpeed = Number.isFinite(m) ? m : null;
  }
  let theoreticalBest: number | null = null;
  if (traces && traces.length >= 2 && segments.length >= 2) {
    theoreticalBest = segments.reduce((acc, s) => acc + Math.min(...traces.map((tr) => segmentTime(tr, s))), 0);
  }
  return {
    bestLapTime: best?.lapTime ?? null,
    bestLapNumber: best?.number ?? null,
    meanLapTime: times.length ? mean(times) : null,
    lapCount: src.laps.length,
    validLapCount: inc.length,
    consistencyStd: Number.isFinite(c.std) ? c.std : null,
    consistencyCv: Number.isFinite(c.cv) ? c.cv : null,
    maxSpeed,
    theoreticalBest,
  };
}
