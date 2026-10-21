import { useMemo, useState } from 'react';
import { Crosshair, RefreshCw } from 'lucide-react';
import type { Lap, LapSource } from '@/lib/types';
import type { PreparedTelemetry } from '@/lib/telemetry-metrics';
import { detectLaps, type LapDetectionResult } from '@/lib/analysis/pipeline';
import { gateAt, LAP_SOURCE_LABEL } from '@/lib/lap-detector';
import { parseClock } from '@/lib/telemetry-parser/units';
import { fmtDelta, fmtLapTime } from '@/lib/format';
import { TrackMap } from '../charts/TrackMap';
import { cn, Field, Notice } from '../ui';

interface Props {
  prepared: PreparedTelemetry;
  value: LapDetectionResult;
  onChange: (r: LapDetectionResult) => void;
}

export function LapsTable({ laps, onToggle, referenceLap, onReference }: { laps: Lap[]; onToggle?: (n: number) => void; referenceLap?: number | null; onReference?: (n: number) => void }) {
  const best = Math.min(...laps.filter((l) => l.included).map((l) => l.lapTime));
  return (
    <div className="overflow-x-auto rounded-lg border border-ink-600">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="bg-ink-900">
          <tr className="text-left">
            {['Volta', 'Tempo', 'Δ melhor', 'Distância', 'Situação', onToggle ? 'Incluir' : '', onReference ? 'Referência' : ''].filter((h, i) => h || i < 5).map((h) => (
              <th key={h} className="label px-3 py-2 font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {laps.map((l) => (
            <tr key={l.number} className={cn('border-t border-ink-700', !l.included && 'text-fg-dim')}>
              <td className="num px-3 py-2">V{l.number}</td>
              <td className={cn('num px-3 py-2 font-semibold', l.included && l.lapTime === best && 'text-gain')}>{fmtLapTime(l.lapTime)}</td>
              <td className="num px-3 py-2">{l.included && Number.isFinite(best) ? fmtDelta(l.lapTime - best) : '—'}</td>
              <td className="num px-3 py-2">{Number.isFinite(l.distance) ? `${l.distance.toFixed(0)} m` : '—'}</td>
              <td className="px-3 py-2 text-xs">{l.flagged ? <span className="text-warn" title={l.flagReason}>Suspeita: {l.flagReason}</span> : l.included ? 'Válida' : 'Excluída manualmente'}</td>
              {onToggle && (
                <td className="px-3 py-2">
                  <input type="checkbox" className="h-4 w-4 accent-[#C6F432]" checked={l.included} onChange={() => onToggle(l.number)} aria-label={`Incluir volta ${l.number}`} />
                </td>
              )}
              {onReference && (
                <td className="px-3 py-2">
                  <input type="radio" name="ref-lap" className="h-4 w-4 accent-[#C6F432]" checked={referenceLap === l.number} disabled={!l.included} onChange={() => onReference(l.number)} aria-label={`Usar volta ${l.number} como referência`} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function parseTimes(text: string): number[] {
  return text
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.includes(':') ? parseClock(s) : Number(s.replace(',', '.'))));
}

export function LapDetectionPanel({ prepared, value, onChange }: Props) {
  const available = value.available;
  const [method, setMethod] = useState<LapSource>(value.source ?? available[0]);
  const [trackLength, setTrackLength] = useState('');
  const [offset, setOffset] = useState('0');
  const [manual, setManual] = useState('');
  const [error, setError] = useState<string | null>(null);
  const xy = prepared.xy;

  const path = useMemo(() => {
    if (!xy) return [];
    const step = Math.max(1, Math.floor(xy.x.length / 3000));
    const out = [];
    for (let i = 0; i < xy.x.length; i += step) out.push({ x: xy.x[i], y: xy.y[i] });
    return out;
  }, [xy]);

  const gateOverlay = value.gate
    ? [{ id: 'gate', color: '#FF4F4F', label: 'linha', width: 5, points: [
        { x: value.gate.x - value.gate.hy * (value.gate.width / 2), y: value.gate.y + value.gate.hx * (value.gate.width / 2) },
        { x: value.gate.x + value.gate.hy * (value.gate.width / 2), y: value.gate.y - value.gate.hx * (value.gate.width / 2) },
      ] }]
    : [];

  const run = (m: LapSource, extra: Partial<Parameters<typeof detectLaps>[1]> = {}) => {
    setError(null);
    if (m === 'track-length' && !(Number(trackLength) > 50) && !extra.trackLength) {
      setError('Informe o comprimento da pista em metros (maior que 50).');
      return;
    }
    if (m === 'manual') {
      const t = parseTimes(manual);
      if (t.some((v) => !Number.isFinite(v))) {
        setError('Há valores inválidos. Use segundos (ex.: 63.25) ou m:ss.sss (ex.: 1:03.250).');
        return;
      }
      if (t.length < 2) {
        setError('Informe ao menos dois instantes de passagem.');
        return;
      }
    }
    const r = detectLaps(prepared, {
      method: m,
      trackLength: Number(trackLength) || undefined,
      trackOffset: Number(offset) || 0,
      manualTimes: m === 'manual' ? parseTimes(manual) : undefined,
      ...extra,
    });
    onChange(r);
  };

  const pickGate = (q: { x: number; y: number }) => {
    if (!xy) return;
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < xy.x.length; i++) {
      const d = (xy.x[i] - q.x) ** 2 + (xy.y[i] - q.y) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    const g = gateAt(xy.x, xy.y, best, Math.max(2, Math.round(prepared.sampleRate * 0.4)));
    if (!g) {
      setError('Não foi possível posicionar a linha neste ponto (kart parado?). Tente outro ponto da trajetória.');
      return;
    }
    run('gps-gate', { gate: g });
  };

  const toggle = (n: number) => onChange({ ...value, laps: value.laps.map((l) => (l.number === n ? { ...l, included: !l.included } : l)) });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Método de detecção">
          {(id) => (
            <select id={id} className="input !w-auto" value={method} onChange={(e) => setMethod(e.target.value as LapSource)}>
              {available.map((m) => (
                <option key={m} value={m}>{LAP_SOURCE_LABEL[m]}</option>
              ))}
            </select>
          )}
        </Field>
        {method === 'track-length' && (
          <>
            <Field label="Comprimento da pista (m)">
              {(id) => <input id={id} type="number" min={50} inputMode="decimal" className="input w-36" value={trackLength} onChange={(e) => setTrackLength(e.target.value)} placeholder="ex.: 1040" />}
            </Field>
            <Field label="Início da 1ª volta (m)">
              {(id) => <input id={id} type="number" min={0} className="input w-32" value={offset} onChange={(e) => setOffset(e.target.value)} />}
            </Field>
          </>
        )}
        <button className="btn-secondary" onClick={() => run(method)}>
          <RefreshCw className="h-4 w-4" /> Detectar voltas
        </button>
      </div>
      {method === 'manual' && (
        <Field label="Instantes de passagem pela linha de chegada" hint="Um por linha, em segundos desde o início do arquivo (ex.: 12.4) ou m:ss.sss (ex.: 1:05.320).">
          {(id) => <textarea id={id} rows={4} className="input font-mono" value={manual} onChange={(e) => setManual(e.target.value)} />}
        </Field>
      )}
      {method === 'gps-gate' && xy && (
        <div>
          <p className="mb-2 flex items-center gap-2 text-xs text-fg-muted">
            <Crosshair className="h-3.5 w-3.5 text-gain" /> Clique sobre a trajetória para posicionar a linha de chegada (vermelho). A linha é perpendicular ao sentido de percurso naquele ponto.
          </p>
          <TrackMap points={path} overlays={gateOverlay} onPick={(_, q) => pickGate(q)} height={300} showDirection={false} />
        </div>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      <Notice tone={value.laps.length ? 'ok' : 'warn'}>{value.message}</Notice>
      {value.laps.length > 0 && <LapsTable laps={value.laps} onToggle={toggle} />}
    </div>
  );
}
