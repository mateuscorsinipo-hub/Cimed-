/**
 * Tipos centrais compartilhados por todos os módulos de análise.
 * Unidades internas (SI): tempo em s, distância em m, velocidade em m/s,
 * aceleração em g, ângulos em graus, acelerador em %.
 */

export type ChannelKey =
  | 'time'
  | 'distance'
  | 'lat'
  | 'lon'
  | 'speed'
  | 'accelLong'
  | 'accelLat'
  | 'rpm'
  | 'throttle'
  | 'brake'
  | 'steering'
  | 'lap';

/** Canais normalizados, em colunas. Valores ausentes são NaN. */
export type Channels = Partial<Record<ChannelKey, number[]>> & { time: number[] };

/** Origem de cada canal: medido pelo equipamento ou derivado por cálculo. */
export type ChannelOrigin = 'measured' | 'derived';

export interface RawTable {
  headers: string[];
  units: (string | null)[];
  rows: string[][];
  delimiter: string;
  decimalComma: boolean;
  headerLine: number;
  preamble: string[];
}

export type LapSource = 'column' | 'gps-gate' | 'distance-reset' | 'track-length' | 'manual';

export interface Lap {
  /** Número da volta na sessão (1..n, inclui volta de saída se existir). */
  number: number;
  startIdx: number;
  endIdx: number;
  /** Tempos absolutos (s) dentro da sessão; podem ser interpolados no cruzamento da linha. */
  startTime: number;
  endTime: number;
  lapTime: number;
  distance: number;
  /** Volta suspeita (saída de box, volta de saída, interrupção). Excluída das estatísticas por padrão. */
  flagged: boolean;
  flagReason?: string;
  included: boolean;
}

export type SegmentKind = 'corner' | 'straight';

export interface Segment {
  id: string;
  name: string;
  kind: SegmentKind;
  /** Fração da distância da volta (0..1). */
  start: number;
  end: number;
  /** Fração do ápice estimado (quando curva). */
  apex?: number;
  direction?: 'L' | 'R';
  source: 'gps-curvature' | 'speed-profile' | 'manual' | 'sectors';
}

export interface XY {
  x: number;
  y: number;
}

export interface StartFinishGate {
  /** Ponto local (m) e direção de passagem (vetor unitário). */
  x: number;
  y: number;
  hx: number;
  hy: number;
  width: number;
}

export interface TrackDef {
  id: string;
  name: string;
  kind: 'gps' | 'manual';
  /** Polilinha local em metros; para traçado manual é esquemática. */
  points: XY[];
  length: number;
  segments: Segment[];
  createdAt: number;
  updatedAt: number;
}

export type MarkerType = 'entry' | 'apex' | 'exit' | 'brake' | 'throttle' | 'note';

export interface VideoMarker {
  id: string;
  time: number;
  type: MarkerType;
  label: string;
  note?: string;
  /** Distância da volta (fração) associada, quando houver sincronização. */
  lapFraction?: number;
  segmentId?: string;
}

export interface VideoSyncPoint {
  videoTime: number;
  telemetryTime: number;
}

export interface VideoState {
  fileName: string;
  fileSize: number;
  markers: VideoMarker[];
  syncPoints: VideoSyncPoint[];
}

export interface TrajectoryMarker {
  id: string;
  type: 'entry' | 'apex' | 'exit';
  fraction: number;
  segmentId?: string;
  note?: string;
}

export interface SessionSummary {
  bestLapTime: number | null;
  bestLapNumber: number | null;
  meanLapTime: number | null;
  lapCount: number;
  validLapCount: number;
  consistencyStd: number | null;
  consistencyCv: number | null;
  maxSpeed: number | null;
  theoreticalBest: number | null;
}

export interface SessionMeta {
  id: string;
  name: string;
  trackName: string;
  createdAt: number;
  updatedAt: number;
  isDemo: boolean;
  summary: SessionSummary;
}

export type DistanceSource = 'column' | 'gps' | 'integrated-speed' | 'none';

export interface Session extends SessionMeta {
  source: { fileName: string; fileSize: number; format: 'csv' | 'gpx' | 'demo' | 'backup' };
  channels: Channels;
  origins: Partial<Record<ChannelKey, ChannelOrigin>>;
  /** Coordenadas locais (m) derivadas do GPS já filtrado. */
  xy?: { x: number[]; y: number[] };
  distanceSource: DistanceSource;
  sampleRate: number;
  laps: Lap[];
  lapSource: LapSource;
  gate?: StartFinishGate;
  referenceLap: number | null;
  segments: Segment[];
  trackId?: string;
  warnings: string[];
  notes: string;
  trajectoryMarkers: TrajectoryMarker[];
  referenceLine?: XY[];
  video?: VideoState;
}

export interface Preferences {
  speedUnit: 'kmh' | 'mph';
  deltaThreshold: number;
  onboardingDismissed: boolean;
  activeSessionId: string | null;
  llm: { enabled: boolean; endpoint: string; model: string };
}

export const DEFAULT_PREFERENCES: Preferences = {
  speedUnit: 'kmh',
  deltaThreshold: 0.05,
  onboardingDismissed: false,
  activeSessionId: null,
  llm: { enabled: false, endpoint: '', model: '' },
};
