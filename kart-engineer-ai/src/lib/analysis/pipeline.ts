import type { Lap, LapSource, Segment, Session, StartFinishGate } from '../types';
import {
  autoGate,
  lapsFromColumn,
  lapsFromDistanceResets,
  lapsFromGate,
  lapsFromManualTimes,
  lapsFromTrackLength,
} from '../lap-detector';
import { buildTraces, includedTraces } from '../lap-comparator';
import { fastestLap, prepareTelemetry, summarize, type PreparedTelemetry } from '../telemetry-metrics';
import type { NormalizedTelemetry } from '../telemetry-parser/normalize';
import { detectSegments } from '../track-map/corners';

export type LapMethod = LapSource | 'auto';

export interface LapOptions {
  method: LapMethod;
  trackLength?: number;
  trackOffset?: number;
  manualTimes?: number[];
  gate?: StartFinishGate;
}

export interface LapDetectionResult {
  laps: Lap[];
  source: LapSource | null;
  gate?: StartFinishGate;
  message: string;
  available: LapSource[];
}

export function uid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function availableLapMethods(p: PreparedTelemetry): LapSource[] {
  const out: LapSource[] = [];
  if (p.channels.lap && new Set(p.channels.lap.filter(Number.isFinite)).size >= 2) out.push('column');
  if (p.xy) out.push('gps-gate');
  if (p.distanceResets.length >= 1) out.push('distance-reset');
  if (p.distanceCum) out.push('track-length');
  out.push('manual');
  return out;
}

export function detectLaps(p: PreparedTelemetry, opt: LapOptions): LapDetectionResult {
  const t = p.channels.time;
  const available = availableLapMethods(p);
  const tryMethod = (m: LapSource): LapDetectionResult | null => {
    switch (m) {
      case 'column': {
        if (!p.channels.lap) return null;
        const laps = lapsFromColumn(p.channels.lap, t, p.distanceCum);
        return { laps, source: m, message: `${laps.length} volta(s) pela coluna de identificação do arquivo.`, available };
      }
      case 'gps-gate': {
        if (!p.xy) return null;
        const gate = opt.gate ?? autoGate(p.xy.x, p.xy.y, t, p.channels.speed, p.sampleRate);
        if (!gate) return { laps: [], source: m, message: 'Não foi possível posicionar automaticamente a linha de chegada. Clique no mapa para defini-la.', available };
        const laps = lapsFromGate(p.xy.x, p.xy.y, t, gate, p.distanceCum);
        return {
          laps,
          source: m,
          gate,
          message: opt.gate
            ? `${laps.length} volta(s) pela linha de chegada definida no mapa.`
            : `${laps.length} volta(s) pela linha de chegada posicionada automaticamente. Ajuste no mapa se necessário.`,
          available,
        };
      }
      case 'distance-reset': {
        const laps = lapsFromDistanceResets(p.distanceResets, t, p.distanceCum);
        return { laps, source: m, message: `${laps.length} volta(s) pelos reinícios da coluna de distância.`, available };
      }
      case 'track-length': {
        if (!p.distanceCum || !opt.trackLength) {
          return { laps: [], source: m, message: 'Informe o comprimento da pista em metros para dividir as voltas.', available };
        }
        const laps = lapsFromTrackLength(p.distanceCum, t, opt.trackLength, opt.trackOffset ?? 0);
        return {
          laps,
          source: m,
          message: `${laps.length} volta(s) dividindo a distância a cada ${opt.trackLength} m. A precisão depende da calibração da distância.`,
          available,
        };
      }
      case 'manual': {
        const times = opt.manualTimes ?? [];
        if (times.length < 2) return { laps: [], source: m, message: 'Informe ao menos dois instantes de passagem pela linha de chegada.', available };
        const laps = lapsFromManualTimes(times, t, p.distanceCum);
        return { laps, source: m, message: `${laps.length} volta(s) pelos instantes informados.`, available };
      }
    }
  };

  if (opt.method !== 'auto') return tryMethod(opt.method) ?? { laps: [], source: null, message: 'Método indisponível para estes dados.', available };
  for (const m of ['column', 'gps-gate', 'distance-reset'] as LapSource[]) {
    if (!available.includes(m)) continue;
    const r = tryMethod(m);
    if (r && r.laps.length >= 1) return r;
  }
  return {
    laps: [],
    source: null,
    message: 'Nenhuma volta foi detectada automaticamente. Informe o comprimento da pista ou os instantes de passagem.',
    available,
  };
}

export interface BuildSessionInput {
  name: string;
  trackName: string;
  fileName: string;
  fileSize: number;
  format: Session['source']['format'];
  normalized: NormalizedTelemetry;
  prepared: PreparedTelemetry;
  laps: Lap[];
  lapSource: LapSource;
  gate?: StartFinishGate;
  referenceLap?: number | null;
  isDemo?: boolean;
}

/** Recalcula referência, segmentos e resumo após qualquer alteração de voltas. */
export function rebuildAnalysis(session: Session, opts: { keepSegments?: boolean } = {}): Session {
  let ref = session.referenceLap;
  const refLap = session.laps.find((l) => l.number === ref && l.included);
  if (!refLap) ref = fastestLap(session.laps)?.number ?? session.laps[0]?.number ?? null;
  const traces = buildTraces(session, ref);
  let segments: Segment[] = session.segments;
  const manual = segments.length && segments[0].source === 'manual';
  if (!(opts.keepSegments || manual) || !segments.length) {
    const refTrace = ref !== null ? traces.get(ref) : undefined;
    segments = refTrace ? detectSegments(refTrace) : [];
  }
  const summary = summarize(session, segments, includedTraces(traces, session.laps));
  return { ...session, referenceLap: ref, segments, summary, updatedAt: Date.now() };
}

export function buildSession(input: BuildSessionInput): Session {
  const now = Date.now();
  const p = input.prepared;
  const base: Session = {
    id: uid(),
    name: input.name.trim() || 'Sessão sem nome',
    trackName: input.trackName.trim(),
    createdAt: now,
    updatedAt: now,
    isDemo: !!input.isDemo,
    summary: {
      bestLapTime: null, bestLapNumber: null, meanLapTime: null, lapCount: 0, validLapCount: 0,
      consistencyStd: null, consistencyCv: null, maxSpeed: null, theoreticalBest: null,
    },
    source: { fileName: input.fileName, fileSize: input.fileSize, format: input.format },
    channels: p.channels,
    origins: p.origins,
    xy: p.xy,
    distanceSource: p.distanceSource,
    sampleRate: p.sampleRate,
    laps: input.laps,
    lapSource: input.lapSource,
    gate: input.gate,
    referenceLap: input.referenceLap ?? null,
    segments: [],
    warnings: [...input.normalized.report.warnings, ...p.warnings],
    notes: '',
    trajectoryMarkers: [],
  };
  return rebuildAnalysis(base);
}

export function prepareFromNormalized(n: NormalizedTelemetry): PreparedTelemetry {
  return prepareTelemetry(n.channels, n.origins, n.report.sampleRate);
}
