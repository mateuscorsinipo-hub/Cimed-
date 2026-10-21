import type { ChannelKey, ChannelOrigin, Channels, DistanceSource } from '../types';
import { cleanGps, cumulativeDistance, projectLatLon } from '../track-map/geometry';
import { derivative, fillGaps, movingAverage } from './signal';

export interface PreparedTelemetry {
  channels: Channels;
  origins: Partial<Record<ChannelKey, ChannelOrigin>>;
  xy?: { x: number[]; y: number[] };
  /** Distância acumulada da sessão (m), sempre crescente. */
  distanceCum: number[] | null;
  distanceSource: DistanceSource;
  /** Índices onde a coluna de distância original reinicia (marcador de volta do registrador). */
  distanceResets: number[];
  sampleRate: number;
  warnings: string[];
}

/** Integra velocidade (m/s) no tempo pela regra do trapézio. */
export function integrateSpeed(speed: number[], time: number[]): number[] {
  const v = fillGaps(speed);
  const d = new Array<number>(v.length);
  d[0] = 0;
  for (let i = 1; i < v.length; i++) d[i] = d[i - 1] + ((v[i] + v[i - 1]) / 2) * (time[i] - time[i - 1]);
  return d;
}

/**
 * Deriva o que pode ser derivado sem inventar canais:
 *  - trajetória local filtrada a partir do GPS;
 *  - distância: coluna do arquivo > GPS > integração da velocidade;
 *  - velocidade derivada do GPS apenas quando não existe canal medido.
 * Acelerador, freio e direção nunca são inferidos.
 */
export function prepareTelemetry(
  channels: Channels,
  origins: Partial<Record<ChannelKey, ChannelOrigin>>,
  sampleRate: number,
): PreparedTelemetry {
  const ch: Channels = { ...channels };
  const or = { ...origins };
  const warnings: string[] = [];
  const t = ch.time;
  let xy: PreparedTelemetry['xy'];
  let distanceCum: number[] | null = null;
  let distanceSource: DistanceSource = 'none';
  const distanceResets: number[] = [];

  if (ch.lat && ch.lon) {
    const p = projectLatLon(ch.lat, ch.lon);
    const c = cleanGps(p.x, p.y, t, sampleRate);
    xy = { x: c.x, y: c.y };
    if (c.rejected) warnings.push(`${c.rejected} ponto(s) de GPS com salto impossível foram descartados e interpolados.`);
  }

  if (ch.distance) {
    // Desfaz reinícios por volta para obter distância acumulada.
    const raw = fillGaps(ch.distance);
    const out = new Array<number>(raw.length);
    let offset = 0;
    out[0] = raw[0];
    for (let i = 1; i < raw.length; i++) {
      const drop = raw[i - 1] - raw[i];
      if (drop > 20) {
        offset += raw[i - 1] - raw[i];
        distanceResets.push(i);
      }
      out[i] = raw[i] + offset;
    }
    for (let i = 1; i < out.length; i++) if (out[i] < out[i - 1]) out[i] = out[i - 1];
    const d0 = out[0];
    distanceCum = out.map((d) => d - d0);
    distanceSource = 'column';
  } else if (xy) {
    distanceCum = cumulativeDistance(xy.x, xy.y);
    distanceSource = 'gps';
    warnings.push('Distância calculada a partir do GPS filtrado: sujeita ao ruído e à taxa de amostragem do receptor.');
  } else if (ch.speed) {
    distanceCum = integrateSpeed(ch.speed, t);
    distanceSource = 'integrated-speed';
    warnings.push('Distância estimada pela integração da velocidade: erros de calibração acumulam ao longo da volta.');
  }

  if (!ch.speed && distanceCum) {
    const w = Math.max(3, Math.round(sampleRate * 0.5));
    const v = movingAverage(derivative(distanceCum, t), w);
    ch.speed = v.map((x) => (Number.isFinite(x) ? Math.max(0, x) : NaN));
    or.speed = 'derived';
    warnings.push('Velocidade derivada da distância (não medida diretamente).');
  }

  if (distanceCum) ch.distance = distanceCum;
  if (distanceCum && distanceSource !== 'column') or.distance = 'derived';

  return { channels: ch, origins: or, xy, distanceCum, distanceSource, distanceResets, sampleRate, warnings };
}
