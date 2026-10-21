import { speedToDisplay, speedUnitLabel } from './telemetry-parser/units';

export function fmtLapTime(s: number | null | undefined): string {
  if (s === null || s === undefined || !Number.isFinite(s)) return '—';
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return m > 0 ? `${m}:${rest.toFixed(3).padStart(6, '0')}` : rest.toFixed(3);
}

export function fmtDelta(s: number | null | undefined, digits = 3): string {
  if (s === null || s === undefined || !Number.isFinite(s)) return '—';
  const sign = s > 0 ? '+' : s < 0 ? '−' : '±';
  return `${sign}${Math.abs(s).toFixed(digits)} s`;
}

export function fmtSpeed(ms: number | null | undefined, unit: 'kmh' | 'mph' = 'kmh', digits = 1): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  return `${speedToDisplay(ms, unit).toFixed(digits)} ${speedUnitLabel(unit)}`;
}

export function fmtSpeedDelta(ms: number | null | undefined, unit: 'kmh' | 'mph' = 'kmh'): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  const v = speedToDisplay(ms, unit);
  return `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(1)} ${speedUnitLabel(unit)}`;
}

export function fmtMeters(m: number | null | undefined, digits = 0): string {
  if (m === null || m === undefined || !Number.isFinite(m)) return '—';
  return `${m.toFixed(digits)} m`;
}

export function fmtSignedMeters(m: number | null | undefined, digits = 1): string {
  if (m === null || m === undefined || !Number.isFinite(m)) return '—';
  return `${m > 0 ? '+' : m < 0 ? '−' : '±'}${Math.abs(m).toFixed(digits)} m`;
}

export function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

export function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function fmtBytes(b: number): string {
  if (!Number.isFinite(b)) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

export function fmtClock(s: number): string {
  if (!Number.isFinite(s)) return '—';
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`;
}
