import type { ChannelKey } from '../types';

export interface UnitOption {
  id: string;
  label: string;
}

/** Unidades aceitas por canal. A primeira é a unidade interna (SI) quando aplicável. */
export const UNIT_OPTIONS: Record<ChannelKey, UnitOption[]> = {
  time: [
    { id: 's', label: 'segundos (s)' },
    { id: 'ms', label: 'milissegundos (ms)' },
    { id: 'us', label: 'microssegundos (µs)' },
    { id: 'clock', label: 'relógio (hh:mm:ss.sss)' },
    { id: 'iso', label: 'data/hora ISO 8601' },
    { id: 'unix-s', label: 'Unix (s)' },
    { id: 'unix-ms', label: 'Unix (ms)' },
  ],
  distance: [
    { id: 'm', label: 'metros (m)' },
    { id: 'km', label: 'quilômetros (km)' },
    { id: 'ft', label: 'pés (ft)' },
    { id: 'mi', label: 'milhas (mi)' },
  ],
  lat: [
    { id: 'deg', label: 'graus decimais' },
    { id: 'deg1e7', label: 'graus × 10⁷ (inteiro)' },
  ],
  lon: [
    { id: 'deg', label: 'graus decimais' },
    { id: 'deg1e7', label: 'graus × 10⁷ (inteiro)' },
  ],
  speed: [
    { id: 'kmh', label: 'km/h' },
    { id: 'ms', label: 'm/s' },
    { id: 'mph', label: 'mph' },
    { id: 'kn', label: 'nós (kn)' },
  ],
  accelLong: [
    { id: 'g', label: 'g' },
    { id: 'ms2', label: 'm/s²' },
  ],
  accelLat: [
    { id: 'g', label: 'g' },
    { id: 'ms2', label: 'm/s²' },
  ],
  rpm: [{ id: 'rpm', label: 'rpm' }],
  throttle: [
    { id: 'pct', label: '% (0–100)' },
    { id: 'frac', label: 'fração (0–1)' },
  ],
  brake: [
    { id: 'pct', label: '% (0–100)' },
    { id: 'frac', label: 'fração (0–1)' },
    { id: 'bar', label: 'pressão (bar)' },
    { id: 'raw', label: 'valor bruto do sensor' },
  ],
  steering: [
    { id: 'deg', label: 'graus (°)' },
    { id: 'rad', label: 'radianos (rad)' },
  ],
  lap: [{ id: 'id', label: 'número da volta' }],
};

const G = 9.80665;

/** Converte um valor numérico para a unidade interna do canal. */
export function toInternal(channel: ChannelKey, unit: string, v: number): number {
  if (!Number.isFinite(v)) return NaN;
  switch (channel) {
    case 'time':
      if (unit === 'ms' || unit === 'unix-ms') return v / 1000;
      if (unit === 'us') return v / 1e6;
      return v;
    case 'distance':
      if (unit === 'km') return v * 1000;
      if (unit === 'ft') return v * 0.3048;
      if (unit === 'mi') return v * 1609.344;
      return v;
    case 'lat':
    case 'lon':
      return unit === 'deg1e7' ? v / 1e7 : v;
    case 'speed':
      if (unit === 'kmh') return v / 3.6;
      if (unit === 'mph') return v * 0.44704;
      if (unit === 'kn') return v * 0.514444;
      return v;
    case 'accelLong':
    case 'accelLat':
      return unit === 'ms2' ? v / G : v;
    case 'throttle':
      return unit === 'frac' ? v * 100 : v;
    case 'brake':
      return unit === 'frac' ? v * 100 : v;
    case 'steering':
      return unit === 'rad' ? (v * 180) / Math.PI : v;
    default:
      return v;
  }
}

/** Converte velocidade interna (m/s) para exibição. */
export function speedToDisplay(ms: number, unit: 'kmh' | 'mph'): number {
  return unit === 'mph' ? ms / 0.44704 : ms * 3.6;
}

export function speedUnitLabel(unit: 'kmh' | 'mph'): string {
  return unit === 'mph' ? 'mph' : 'km/h';
}

/** Interpreta "hh:mm:ss.sss", "mm:ss.sss" ou "ss.sss" como segundos. */
export function parseClock(s: string): number {
  const t = s.trim();
  if (!t) return NaN;
  const parts = t.split(':');
  if (parts.length > 3) return NaN;
  let total = 0;
  for (const p of parts) {
    const n = Number(p.replace(',', '.'));
    if (!Number.isFinite(n)) return NaN;
    total = total * 60 + n;
  }
  return total;
}

/** Interpreta data/hora ISO 8601 como segundos Unix, preservando milissegundos. */
export function parseIso(s: string): number {
  const ms = Date.parse(s.trim());
  return Number.isFinite(ms) ? ms / 1000 : NaN;
}
