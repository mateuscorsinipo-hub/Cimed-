import type { ChannelKey, ChannelOrigin, Channels, RawTable } from '../types';
import { CHANNEL_LABELS, type ColumnMapping } from './columns';
import { ParseError, parseNumber } from './csv';
import { parseClock, parseIso, toInternal } from './units';

export interface ChannelReport {
  channel: ChannelKey;
  column: string;
  unit: string;
  valid: number;
  missing: number;
  outOfRange: number;
}

export interface ValidationReport {
  rowCount: number;
  keptRows: number;
  duplicateTimestamps: number;
  backwardTimestamps: number;
  gaps: number;
  sampleRate: number;
  duration: number;
  channels: ChannelReport[];
  warnings: string[];
  errors: string[];
}

export interface NormalizedTelemetry {
  channels: Channels;
  origins: Partial<Record<ChannelKey, ChannelOrigin>>;
  report: ValidationReport;
}

/** Faixas fisicamente plausíveis (unidades internas) para detectar valores inválidos. */
const RANGES: Partial<Record<ChannelKey, [number, number]>> = {
  lat: [-90, 90],
  lon: [-180, 180],
  speed: [0, 70],
  accelLong: [-8, 8],
  accelLat: [-8, 8],
  rpm: [0, 30000],
  throttle: [-5, 105],
  steering: [-1080, 1080],
  distance: [-1, 1e6],
};

export function median(values: number[]): number {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function parseTimeCell(s: string, unit: string, decimalComma: boolean): number {
  if (unit === 'clock') return parseClock(s);
  if (unit === 'iso') return parseIso(s);
  const n = parseNumber(s, decimalComma);
  if (Number.isFinite(n)) return toInternal('time', unit, n);
  // Valor em formato de relógio numa coluna marcada como numérica.
  if (s.includes(':')) return parseClock(s);
  return NaN;
}

/**
 * Aplica o mapeamento de colunas, converte unidades, valida valores e
 * garante uma base de tempo monotônica. Não cria canais que não existem no arquivo.
 */
export function normalizeTable(table: RawTable, mapping: ColumnMapping): NormalizedTelemetry {
  const errors: string[] = [];
  const warnings: string[] = [];
  const tMap = mapping.time;
  if (!tMap) {
    throw new ParseError('Selecione a coluna de timestamp. Sem tempo não é possível calcular tempos de volta.');
  }
  const keys = (Object.keys(mapping) as ChannelKey[]).filter((k) => mapping[k]);
  const n = table.rows.length;

  const rawTime = new Array<number>(n);
  for (let i = 0; i < n; i++) rawTime[i] = parseTimeCell(table.rows[i][tMap.column] ?? '', tMap.unit, table.decimalComma);

  const lapCol = mapping.lap;
  const rawLap = lapCol
    ? table.rows.map((r) => parseNumber(r[lapCol.column] ?? '', table.decimalComma))
    : null;

  // Tempo que reinicia a cada volta: transforma em tempo acumulado da sessão.
  let resets = 0;
  if (rawLap) {
    let offset = 0;
    for (let i = 1; i < n; i++) {
      if (rawTime[i] < rawTime[i - 1] && rawLap[i] !== rawLap[i - 1] && Number.isFinite(rawTime[i])) {
        resets++;
      }
    }
    if (resets > 0) {
      let last = rawTime[0];
      for (let i = 1; i < n; i++) {
        const cur = rawTime[i];
        if (Number.isFinite(cur) && cur < last && rawLap[i] !== rawLap[i - 1]) offset += last - cur + 1e-3;
        if (Number.isFinite(cur)) {
          last = cur;
          rawTime[i] = cur + offset;
        }
      }
      warnings.push('O timestamp reinicia a cada volta; foi convertido em tempo acumulado da sessão.');
    }
  }

  // Seleciona linhas com tempo válido e estritamente crescente.
  const keep: number[] = [];
  let duplicates = 0;
  let backward = 0;
  let invalidTime = 0;
  let lastT = -Infinity;
  for (let i = 0; i < n; i++) {
    const t = rawTime[i];
    if (!Number.isFinite(t)) {
      invalidTime++;
      continue;
    }
    if (t === lastT) {
      duplicates++;
      continue;
    }
    if (t < lastT) {
      backward++;
      continue;
    }
    keep.push(i);
    lastT = t;
  }
  if (invalidTime) warnings.push(`${invalidTime} linha(s) sem timestamp válido foram descartadas.`);
  if (duplicates) warnings.push(`${duplicates} timestamp(s) duplicado(s) foram descartados (mantida a primeira ocorrência).`);
  if (backward) {
    const msg = `${backward} amostra(s) com timestamp anterior à amostra precedente foram descartadas.`;
    if (backward > n * 0.05) errors.push(`${msg} Isso indica arquivo concatenado ou fora de ordem; revise a coluna de tempo.`);
    else warnings.push(msg);
  }
  if (keep.length < 10) {
    throw new ParseError('Menos de 10 amostras com timestamp válido. Verifique a coluna e a unidade de tempo selecionadas.');
  }

  const t0 = rawTime[keep[0]];
  const time = keep.map((i) => rawTime[i] - t0);
  const channels: Channels = { time };
  const origins: Partial<Record<ChannelKey, ChannelOrigin>> = { time: 'measured' };
  const reports: ChannelReport[] = [
    { channel: 'time', column: table.headers[tMap.column], unit: tMap.unit, valid: keep.length, missing: invalidTime, outOfRange: 0 },
  ];

  for (const k of keys) {
    if (k === 'time') continue;
    const m = mapping[k]!;
    const out = new Array<number>(keep.length);
    let missing = 0;
    let oor = 0;
    const range = RANGES[k];
    for (let j = 0; j < keep.length; j++) {
      const s = table.rows[keep[j]][m.column] ?? '';
      let v = k === 'lap' && rawLap ? rawLap[keep[j]] : parseNumber(s, table.decimalComma);
      if (!Number.isFinite(v)) {
        missing++;
        out[j] = NaN;
        continue;
      }
      v = toInternal(k, m.unit, v);
      if (range && (v < range[0] || v > range[1])) {
        oor++;
        v = NaN;
      }
      out[j] = v;
    }
    // Latitude/longitude 0,0 representa ausência de fix em vários registradores.
    if (k === 'lat' || k === 'lon') {
      const other = k === 'lat' ? 'lon' : 'lat';
      const om = mapping[other];
      if (om) {
        for (let j = 0; j < keep.length; j++) {
          const ov = parseNumber(table.rows[keep[j]][om.column] ?? '', table.decimalComma);
          if (out[j] === 0 && ov === 0) {
            out[j] = NaN;
            missing++;
          }
        }
      }
    }
    const valid = keep.length - missing - oor;
    reports.push({ channel: k, column: table.headers[m.column], unit: m.unit, valid, missing, outOfRange: oor });
    if (valid < keep.length * 0.2) {
      warnings.push(`${CHANNEL_LABELS[k]}: apenas ${Math.round((valid / keep.length) * 100)}% de valores válidos; o canal foi ignorado.`);
      continue;
    }
    if (oor) warnings.push(`${CHANNEL_LABELS[k]}: ${oor} valor(es) fora da faixa plausível foram descartados.`);
    if (missing > keep.length * 0.1) warnings.push(`${CHANNEL_LABELS[k]}: ${missing} valor(es) ausentes.`);
    channels[k] = out;
    origins[k] = 'measured';
  }

  if (channels.lat && !channels.lon) {
    delete channels.lat;
    warnings.push('Latitude sem longitude correspondente: o canal foi ignorado.');
  }
  if (channels.lon && !channels.lat) {
    delete channels.lon;
    warnings.push('Longitude sem latitude correspondente: o canal foi ignorado.');
  }

  const dts: number[] = [];
  for (let i = 1; i < time.length; i++) dts.push(time[i] - time[i - 1]);
  const dt = median(dts);
  const gaps = dts.filter((d) => d > Math.max(dt * 5, 0.5)).length;
  if (gaps) warnings.push(`${gaps} lacuna(s) na gravação (intervalos maiores que 5× o período de amostragem).`);
  const sampleRate = dt > 0 ? 1 / dt : 0;
  if (sampleRate > 0 && sampleRate < 4) {
    warnings.push(`Taxa de amostragem baixa (${sampleRate.toFixed(1)} Hz). Diferenças em curvas terão baixa precisão.`);
  }
  if (!channels.speed && !channels.lat && !channels.distance) {
    errors.push('O arquivo não possui velocidade, distância nem GPS. Mapeie ao menos um desses canais para comparar voltas.');
  }

  return {
    channels,
    origins,
    report: {
      rowCount: n,
      keptRows: keep.length,
      duplicateTimestamps: duplicates,
      backwardTimestamps: backward,
      gaps,
      sampleRate,
      duration: time[time.length - 1],
      channels: reports,
      warnings,
      errors,
    },
  };
}
