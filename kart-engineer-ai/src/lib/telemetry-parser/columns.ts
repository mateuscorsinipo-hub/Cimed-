import type { ChannelKey, RawTable } from '../types';
import { looksNumeric, parseNumber } from './csv';
import { UNIT_OPTIONS } from './units';

export const CHANNEL_LABELS: Record<ChannelKey, string> = {
  time: 'Timestamp',
  distance: 'Distância',
  lat: 'Latitude',
  lon: 'Longitude',
  speed: 'Velocidade',
  accelLong: 'Aceleração longitudinal',
  accelLat: 'Aceleração lateral',
  rpm: 'RPM',
  throttle: 'Acelerador',
  brake: 'Freio',
  steering: 'Ângulo de direção',
  lap: 'Identificador de volta',
};

export const CHANNEL_ORDER: ChannelKey[] = [
  'time', 'distance', 'lat', 'lon', 'speed', 'accelLong', 'accelLat', 'rpm', 'throttle', 'brake', 'steering', 'lap',
];

const ALIASES: Record<ChannelKey, string[]> = {
  time: ['time', 'timestamp', 'tempo', 't', 'seconds', 'secs', 'elapsed', 'elapsedtime', 'sessiontime', 'datetime', 'hora', 'gpstime', 'utc', 'timesec', 'times'],
  distance: ['distance', 'dist', 'distancia', 'odometer', 'lapdistance', 'gpsdistance', 'distanceonvehiclespeed', 'distancetraveled'],
  lat: ['lat', 'latitude', 'gpslatitude', 'gpslat', 'latdeg'],
  lon: ['lon', 'lng', 'long', 'longitude', 'gpslongitude', 'gpslon', 'gpslong', 'londeg'],
  speed: ['speed', 'velocidade', 'vel', 'gpsspeed', 'groundspeed', 'vehiclespeed', 'speedgps', 'velocity', 'kmh', 'kph', 'mph', 'wheelspeed'],
  accelLong: ['accellong', 'longaccel', 'longitudinalacceleration', 'gpslonacc', 'gpslongacc', 'inlineacc', 'accx', 'ax', 'gx', 'longg', 'aceleracaolongitudinal', 'acclong', 'longacc', 'lonacc', 'lonaccel', 'inlineaccel'],
  accelLat: ['accellat', 'lataccel', 'lateralacceleration', 'gpslatacc', 'lateralacc', 'accy', 'ay', 'gy', 'latg', 'aceleracaolateral', 'acclat', 'latacc'],
  rpm: ['rpm', 'enginerpm', 'rotacao', 'rpms', 'motorrpm', 'enginespeed'],
  throttle: ['throttle', 'tps', 'acelerador', 'throttleposition', 'throttlepos', 'gas', 'pedalacelerador'],
  brake: ['brake', 'freio', 'brakepressure', 'brakepos', 'frontbrake', 'brakepress', 'pressaofreio'],
  steering: ['steering', 'steer', 'steeringangle', 'volante', 'direcao', 'steerangle', 'anguloderecao'],
  lap: ['lap', 'lapnumber', 'volta', 'lapno', 'lapindex', 'lapnum', 'numerovolta', 'lapcount'],
};

const EXCLUDE: Partial<Record<ChannelKey, RegExp>> = {
  lap: /time|tempo|dist|beacon/,
  lat: /acc|^g/,
  lon: /acc|^g/,
  time: /lap|volta/,
  speed: /rpm/,
};

/** Normaliza um nome de coluna: minúsculas, sem acentos, sem unidade, só alfanumérico. */
export function normalizeHeader(h: string): string {
  return h
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[[(].*?[\])]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/** Extrai unidade embutida no nome: "Speed (km/h)", "Speed [kph]". */
export function extractHeaderUnit(h: string): string | null {
  const m = h.match(/[[(]([^\])]+)[\])]/);
  return m ? m[1].trim() : null;
}

export interface ColumnMappingEntry {
  column: number;
  unit: string;
  /** true quando a unidade foi deduzida pela faixa de valores e precisa de confirmação. */
  unitInferred: boolean;
}

export type ColumnMapping = Partial<Record<ChannelKey, ColumnMappingEntry>>;

function score(header: string, channel: ChannelKey): number {
  const n = normalizeHeader(header);
  if (!n) return 0;
  const ex = EXCLUDE[channel];
  if (ex && ex.test(n)) return 0;
  let best = 0;
  for (const a of ALIASES[channel]) {
    if (n === a) best = Math.max(best, 3);
    else if (a.length >= 3 && n.startsWith(a)) best = Math.max(best, 2);
    else if (a.length >= 4 && n.includes(a)) best = Math.max(best, 1);
  }
  return best;
}

export function columnStats(table: RawTable, col: number) {
  let numeric = 0;
  let empty = 0;
  let min = Infinity;
  let max = -Infinity;
  const sample: string[] = [];
  const n = table.rows.length;
  const step = Math.max(1, Math.floor(n / 4000));
  let seen = 0;
  for (let i = 0; i < n; i += step) {
    const s = table.rows[i][col] ?? '';
    seen++;
    if (sample.length < 4 && s) sample.push(s);
    if (!s) {
      empty++;
      continue;
    }
    if (looksNumeric(s, table.decimalComma)) {
      numeric++;
      const v = parseNumber(s, table.decimalComma);
      if (Number.isFinite(v)) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
  }
  return {
    numericRatio: seen ? numeric / seen : 0,
    emptyRatio: seen ? empty / seen : 1,
    min: Number.isFinite(min) ? min : null,
    max: Number.isFinite(max) ? max : null,
    sample,
  };
}

function normUnitText(u: string): string {
  return u.toLowerCase().replace(/\s/g, '').replace('²', '2').replace('^2', '2');
}

/** Converte o texto de unidade de um arquivo para o id interno. */
export function matchUnitText(channel: ChannelKey, text: string | null): string | null {
  if (!text) return null;
  const u = normUnitText(text);
  const map: Partial<Record<ChannelKey, Record<string, string>>> = {
    time: { s: 's', sec: 's', seconds: 's', ms: 'ms', msec: 'ms', us: 'us', 'µs': 'us' },
    distance: { m: 'm', km: 'km', ft: 'ft', mi: 'mi', metros: 'm' },
    speed: { 'km/h': 'kmh', kmh: 'kmh', kph: 'kmh', 'm/s': 'ms', mps: 'ms', mph: 'mph', kn: 'kn', kts: 'kn', knots: 'kn' },
    accelLong: { g: 'g', 'm/s2': 'ms2', ms2: 'ms2' },
    accelLat: { g: 'g', 'm/s2': 'ms2', ms2: 'ms2' },
    throttle: { '%': 'pct', pct: 'pct' },
    brake: { '%': 'pct', bar: 'bar', pct: 'pct' },
    steering: { deg: 'deg', '°': 'deg', rad: 'rad' },
    lat: { deg: 'deg', '°': 'deg' },
    lon: { deg: 'deg', '°': 'deg' },
    rpm: { rpm: 'rpm' },
  };
  return map[channel]?.[u] ?? null;
}

function inferUnit(channel: ChannelKey, header: string, table: RawTable, col: number): { unit: string; inferred: boolean } {
  const fromText = matchUnitText(channel, table.units[col]) ?? matchUnitText(channel, extractHeaderUnit(header));
  if (fromText) return { unit: fromText, inferred: false };
  const n = normalizeHeader(header);
  const st = columnStats(table, col);
  const max = Math.max(Math.abs(st.max ?? 0), Math.abs(st.min ?? 0));
  const first = st.sample[0] ?? '';
  switch (channel) {
    case 'time': {
      if (/^\d{4}-\d{2}-\d{2}[T ]/.test(first)) return { unit: 'iso', inferred: false };
      if (first.includes(':')) return { unit: 'clock', inferred: false };
      if (n.endsWith('ms')) return { unit: 'ms', inferred: false };
      if ((st.min ?? 0) > 1e11) return { unit: 'unix-ms', inferred: true };
      if ((st.min ?? 0) > 1e9) return { unit: 'unix-s', inferred: true };
      // Valores típicos: sessão de 5–60 min. Acima de 10.000 com amostras inteiras sugere ms.
      if ((st.max ?? 0) > 20000 && Number.isInteger(Number(first))) return { unit: 'ms', inferred: true };
      return { unit: 's', inferred: true };
    }
    case 'speed':
      if (n.includes('kmh') || n.includes('kph')) return { unit: 'kmh', inferred: false };
      if (n.includes('mph')) return { unit: 'mph', inferred: false };
      // Kart competitivo não ultrapassa ~45 m/s; acima disso o valor só faz sentido em km/h.
      return { unit: max > 45 ? 'kmh' : 'ms', inferred: true };
    case 'distance':
      return { unit: 'm', inferred: true };
    case 'accelLong':
    case 'accelLat':
      return { unit: max > 6 ? 'ms2' : 'g', inferred: true };
    case 'throttle':
    case 'brake':
      if (channel === 'brake' && /press|bar/.test(n)) return { unit: 'bar', inferred: true };
      return { unit: max <= 1.05 ? 'frac' : 'pct', inferred: true };
    case 'steering':
      return { unit: max < 7 ? 'rad' : 'deg', inferred: true };
    case 'lat':
    case 'lon':
      return { unit: max > 1000 ? 'deg1e7' : 'deg', inferred: max > 1000 };
    default:
      return { unit: UNIT_OPTIONS[channel][0].id, inferred: false };
  }
}

/** Mapeamento automático: cada canal recebe no máximo uma coluna e vice-versa. */
export function autoMapColumns(table: RawTable): ColumnMapping {
  const candidates: { ch: ChannelKey; col: number; s: number }[] = [];
  table.headers.forEach((h, col) => {
    for (const ch of CHANNEL_ORDER) {
      const s = score(h, ch);
      if (s > 0) candidates.push({ ch, col, s });
    }
  });
  candidates.sort((a, b) => b.s - a.s || CHANNEL_ORDER.indexOf(a.ch) - CHANNEL_ORDER.indexOf(b.ch));
  const mapping: ColumnMapping = {};
  const usedCols = new Set<number>();
  for (const c of candidates) {
    if (mapping[c.ch] || usedCols.has(c.col)) continue;
    const st = columnStats(table, c.col);
    if (st.numericRatio < 0.5) continue;
    const u = inferUnit(c.ch, table.headers[c.col], table, c.col);
    mapping[c.ch] = { column: c.col, unit: u.unit, unitInferred: u.inferred };
    usedCols.add(c.col);
  }
  return mapping;
}

export function defaultUnitFor(channel: ChannelKey, table: RawTable, col: number): ColumnMappingEntry {
  const u = inferUnit(channel, table.headers[col], table, col);
  return { column: col, unit: u.unit, unitInferred: u.inferred };
}
