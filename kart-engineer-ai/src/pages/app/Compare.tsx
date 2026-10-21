import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { X, ZoomOut } from 'lucide-react';
import { LAP_COLORS, LapSelect, PageHeader, WithSession } from '@/components/app/shared';
import { LineChart, type Series } from '@/components/charts/LineChart';
import { TrackMap } from '@/components/charts/TrackMap';
import { cn, KindTag, Notice, Panel } from '@/components/ui';
import { useAnalysis, useApp } from '@/state/AppState';
import { compareLaps } from '@/lib/lap-comparator';
import { fmtDelta, fmtLapTime, fmtSignedMeters, fmtSpeedDelta } from '@/lib/format';
import { speedToDisplay, speedUnitLabel } from '@/lib/telemetry-parser/units';
import { listTracks } from '@/lib/session-storage';
import type { Session, TrackDef, XY } from '@/lib/types';
import type { LapTrace } from '@/lib/telemetry-metrics';

type ChartId = 'speed' | 'delta' | 'speedDiff' | 'accel' | 'accelLat' | 'throttle' | 'brake' | 'rpm' | 'steering';

const CHART_LABEL: Record<ChartId, string> = {
  speed: 'Velocidade',
  delta: 'Δ tempo acumulado',
  speedDiff: 'Δ velocidade',
  accel: 'Aceleração long.',
  accelLat: 'Aceleração lateral',
  throttle: 'Acelerador',
  brake: 'Freio',
  rpm: 'RPM',
  steering: 'Direção',
};

export default function Compare() {
  return (
    <WithSession what="comparar voltas">{(s) => <CompareView session={s} />}</WithSession>
  );
}

/** Traçado esquemático (sem GPS): pontos da polilinha manual para posicionar o cursor por fração. */
function useSchematic(session: Session): TrackDef | null {
  const [track, setTrack] = useState<TrackDef | null>(null);
  useEffect(() => {
    if (session.xy || !session.trackId) return setTrack(null);
    listTracks().then((ts) => setTrack(ts.find((t) => t.id === session.trackId) ?? null)).catch(() => setTrack(null));
  }, [session]);
  return track;
}

function CompareView({ session }: { session: Session }) {
  const analysis = useAnalysis(session);
  const { prefs } = useApp();
  const [params, setParams] = useSearchParams();
  const schematic = useSchematic(session);
  const inc = session.laps.filter((l) => l.included);
  const best = session.summary.bestLapTime;
  const refNum = Number(params.get('ref')) || session.referenceLap || inc[0]?.number || session.laps[0]?.number;
  const defaultCmp = inc.filter((l) => l.number !== refNum).sort((a, b) => a.lapTime - b.lapTime)[0]?.number;
  const cmpNums = (params.get('cmp') ?? (defaultCmp ? String(defaultCmp) : '')).split(',').map(Number).filter((n) => n && n !== refNum);
  const [cursor, setCursor] = useState<number | null>(null);
  const [zoom, setZoom] = useState<[number, number] | null>(null);
  const [segId, setSegId] = useState<string | null>(null);
  const available: ChartId[] = useMemo(() => {
    const out: ChartId[] = ['speed', 'delta', 'speedDiff', 'accel'];
    for (const k of ['accelLat', 'throttle', 'brake', 'rpm', 'steering'] as const) if (session.channels[k]) out.push(k);
    return out;
  }, [session]);
  const [charts, setCharts] = useState<ChartId[]>(['speed', 'delta', 'accel']);
  useEffect(() => {
    setCharts((c) => {
      const extra = (['throttle', 'brake'] as ChartId[]).filter((k) => available.includes(k) && !c.includes(k));
      return [...c.filter((k) => available.includes(k)), ...extra];
    });
  }, [available]);

  const unit = prefs.speedUnit;
  const set = (ref: number, cmp: number[]) => setParams({ ref: String(ref), cmp: cmp.join(',') }, { replace: true });

  const data = useMemo(() => {
    if (!analysis) return null;
    const ref = analysis.traces.get(refNum);
    if (!ref) return null;
    const cmps = cmpNums.map((n) => analysis.traces.get(n)).filter((t): t is LapTrace => !!t);
    const comps = cmps.map((c) => compareLaps(ref, c, session.segments));
    const L = ref.distance;
    const x = ref.frac.map((f) => f * L);
    return { ref, cmps, comps, L, x };
  }, [analysis, refNum, cmpNums.join(','), session.segments]);

  if (!analysis) return null;
  if (session.laps.length < 2) {
    return <Notice tone="warn" title="Voltas insuficientes">Esta sessão tem {session.laps.length} volta. São necessárias ao menos duas para comparar. Redefina as voltas nos detalhes da sessão.</Notice>;
  }
  if (!data) return <Notice tone="error">Não foi possível alinhar as voltas: a sessão não tem distância (GPS, coluna de distância ou velocidade).</Notice>;

  const { ref, cmps, comps, L, x } = data;
  const seg = session.segments.find((g) => g.id === segId) ?? null;
  const domain: [number, number] | undefined = zoom ?? (seg ? [seg.start * L, seg.end * L] : undefined);
  const bands = session.segments.filter((g) => g.kind === 'corner').map((g) => ({ x0: g.start * L, x1: g.end * L, color: g.id === segId ? 'rgba(242,244,247,0.09)' : 'rgba(77,163,255,0.05)', label: g.name.replace('Curva ', 'C') }));
  const laps = [ref, ...cmps];
  const color = (i: number) => LAP_COLORS[i % LAP_COLORS.length];

  const chartSeries = (id: ChartId): Series[] => {
    switch (id) {
      case 'speed':
        return laps.map((t, i) => ({ id: `s${t.lapNumber}`, label: `V${t.lapNumber}`, color: color(i), x, y: t.speed.map((v) => speedToDisplay(v, unit)) }));
      case 'delta':
        return comps.map((c, i) => ({ id: `d${c.cmp.lapNumber}`, label: `V${c.cmp.lapNumber} − V${ref.lapNumber}`, color: color(i + 1), x, y: c.delta }));
      case 'speedDiff':
        return comps.map((c, i) => ({ id: `v${c.cmp.lapNumber}`, label: `V${c.cmp.lapNumber} − V${ref.lapNumber}`, color: color(i + 1), x, y: c.speedDiff.map((v) => speedToDisplay(v, unit)) }));
      case 'accel':
        return laps.map((t, i) => ({ id: `a${t.lapNumber}`, label: `V${t.lapNumber}`, color: color(i), x, y: t.accel }));
      default:
        return laps.map((t, i) => ({ id: `${id}${t.lapNumber}`, label: `V${t.lapNumber}`, color: color(i), x, y: (t[id as keyof LapTrace] as number[] | undefined) ?? [] }));
    }
  };
  const chartMeta: Record<ChartId, { unit: string; fmt: (v: number) => string; zero?: boolean; sign?: boolean; tag?: 'measured' | 'derived' | 'calculated' }> = {
    speed: { unit: speedUnitLabel(unit), fmt: (v) => v.toFixed(1), tag: session.origins.speed === 'derived' ? 'derived' : 'measured' },
    delta: { unit: 's', fmt: (v) => v.toFixed(3), zero: true, sign: comps.length === 1, tag: 'calculated' },
    speedDiff: { unit: speedUnitLabel(unit), fmt: (v) => v.toFixed(1), zero: true, tag: 'calculated' },
    accel: { unit: 'g', fmt: (v) => v.toFixed(2), zero: true, tag: ref.accelOrigin === 'measured' ? 'measured' : 'derived' },
    accelLat: { unit: 'g', fmt: (v) => v.toFixed(2), zero: true, tag: 'measured' },
    throttle: { unit: '%', fmt: (v) => v.toFixed(0), tag: 'measured' },
    brake: { unit: '', fmt: (v) => v.toFixed(1), tag: 'measured' },
    rpm: { unit: 'rpm', fmt: (v) => v.toFixed(0), tag: 'measured' },
    steering: { unit: '°', fmt: (v) => v.toFixed(0), zero: true, tag: 'measured' },
  };

  const refPts: XY[] | null = ref.x ? ref.x.map((px, i) => ({ x: px, y: ref.y![i] })) : null;
  const mapPoints = refPts ?? schematic?.points ?? null;
  const cursorF = cursor !== null ? cursor / L : null;
  const cursorIdx = cursorF !== null ? Math.round(cursorF * (ref.frac.length - 1)) : null;
  const brakeMarkers = comps[0]?.segments.flatMap((s) => [
    ...(s.ref.brakeStart !== null ? [{ id: `br-${s.segment.id}`, fraction: s.ref.brakeStart, color: '#FF4F4F', shape: 'bar' as const }] : []),
  ]) ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Comparar voltas"
        title={`V${ref.lapNumber} × ${cmps.map((c) => `V${c.lapNumber}`).join(', ') || '—'}`}
        subtitle="Voltas alinhadas por distância percorrida: cada ponto compara a mesma posição relativa da pista em todas as voltas."
      />
      <Panel className="mb-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <div className="label mb-1.5">Referência</div>
            <LapSelect laps={session.laps} value={ref.lapNumber} onChange={(n) => set(n, cmpNums.filter((c) => c !== n))} referenceLap={session.referenceLap} best={best} label="Volta de referência" />
          </div>
          <div>
            <div className="label mb-1.5">Comparadas (até 3)</div>
            <div className="flex flex-wrap items-center gap-2">
              {cmpNums.map((n, i) => (
                <span key={n} className="chip border-ink-500 py-1 text-xs" style={{ color: color(i + 1) }}>
                  V{n}
                  <button aria-label={`Remover volta ${n}`} onClick={() => set(ref.lapNumber, cmpNums.filter((c) => c !== n))}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              {cmpNums.length < 3 && (
                <select className="input !w-auto !py-1.5" value="" onChange={(e) => e.target.value && set(ref.lapNumber, [...cmpNums, Number(e.target.value)])} aria-label="Adicionar volta">
                  <option value="">+ Adicionar volta</option>
                  {session.laps.filter((l) => l.number !== ref.lapNumber && !cmpNums.includes(l.number)).map((l) => (
                    <option key={l.number} value={l.number}>V{l.number} · {fmtLapTime(l.lapTime)}{l.included ? '' : ' (excluída)'}</option>
                  ))}
                </select>
              )}
            </div>
          </div>
          <div>
            <div className="label mb-1.5">Segmento</div>
            <select className="input !w-auto" value={segId ?? ''} onChange={(e) => { setSegId(e.target.value || null); setZoom(null); }} aria-label="Segmento">
              <option value="">Volta inteira</option>
              {session.segments.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          {(zoom || seg) && (
            <button className="btn-ghost btn-sm" onClick={() => { setZoom(null); setSegId(null); }}>
              <ZoomOut className="h-4 w-4" /> Volta inteira
            </button>
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-1.5" role="group" aria-label="Gráficos exibidos">
          {available.map((id) => (
            <button
              key={id}
              aria-pressed={charts.includes(id)}
              onClick={() => setCharts((c) => (c.includes(id) ? c.filter((k) => k !== id) : [...c, id]))}
              className={cn('rounded-md border px-2.5 py-1 text-xs font-semibold', charts.includes(id) ? 'border-gain/60 bg-gain/10 text-gain' : 'border-ink-600 text-fg-muted hover:text-fg')}
            >
              {CHART_LABEL[id]}
            </button>
          ))}
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <Panel bodyClass="space-y-5">
          {charts.filter((c) => available.includes(c)).map((id) => (
            <div key={id}>
              <div className="mb-1 flex justify-end"><KindTag kind={chartMeta[id].tag ?? 'measured'} /></div>
              <LineChart
                title={CHART_LABEL[id]}
                unit={chartMeta[id].unit}
                format={chartMeta[id].fmt}
                series={chartSeries(id)}
                height={id === 'speed' ? 220 : 150}
                cursorX={cursor}
                onCursor={setCursor}
                xDomain={domain}
                onZoom={setZoom}
                bands={bands}
                zeroLine={chartMeta[id].zero}
                signColored={chartMeta[id].sign}
                emptyText={id === 'delta' || id === 'speedDiff' ? 'Adicione uma volta comparada.' : 'Sem dados para este canal.'}
              />
            </div>
          ))}
          <p className="text-[11px] text-fg-dim">Arraste sobre um gráfico para ampliar; duplo clique para voltar. Δ tempo acima de zero = volta comparada atrás da referência naquele ponto. Velocidade maior em um ponto não significa tempo menor no trecho.</p>
        </Panel>

        <div className="space-y-4">
          {mapPoints ? (
            <TrackMap
              points={mapPoints}
              colorValues={refPts ? ref.speed : undefined}
              schematic={!refPts}
              overlays={refPts ? cmps.filter((c) => c.x).map((c, i) => ({ id: `o${c.lapNumber}`, points: c.x!.map((px, j) => ({ x: px, y: c.y![j] })), color: color(i + 1), label: `V${c.lapNumber}`, width: 1.2, dashed: true })) : []}
              labels={session.segments.filter((g) => g.kind === 'corner').map((g) => ({ fraction: g.apex ?? (g.start + g.end) / 2, text: g.name.replace('Curva ', '') }))}
              markers={brakeMarkers}
              highlight={seg ? { start: seg.start, end: seg.end } : null}
              cursorFraction={cursorF}
              onHover={(f) => setCursor(f !== null ? f * L : null)}
              onPick={(f) => {
                const g = session.segments.find((s) => f >= s.start && f <= s.end);
                if (g) { setSegId(g.id); setZoom(null); }
              }}
              height={320}
              footer={!refPts && <div className="border-t border-ink-600 px-3 py-2 text-[11px] text-warn">Traçado esquemático desenhado manualmente — não representa a geometria real.</div>}
            />
          ) : (
            <Notice tone="info" title="Mapa indisponível">Sem GPS nesta sessão. Crie um traçado esquemático em “Traçado” e associe-o à sessão para ver a posição do cursor.</Notice>
          )}
          <Panel title="No cursor">
            {cursorIdx === null ? (
              <p className="text-sm text-fg-muted">Passe o mouse (ou toque) sobre um gráfico ou o mapa.</p>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="text-left">{['Volta', 'Tempo', 'Δ', 'Veloc.'].map((h) => <th key={h} className="label pb-1.5">{h}</th>)}</tr></thead>
                <tbody>
                  {laps.map((t, i) => (
                    <tr key={t.lapNumber}>
                      <td className="num py-0.5" style={{ color: color(i) }}>V{t.lapNumber}</td>
                      <td className="num">{t.time[cursorIdx].toFixed(2)} s</td>
                      <td className="num">{i === 0 ? '—' : fmtDelta(comps[i - 1].delta[cursorIdx], 2)}</td>
                      <td className="num">{speedToDisplay(t.speed[cursorIdx], unit).toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td colSpan={4} className="pt-2 text-xs text-fg-dim">Distância: {cursor!.toFixed(0)} m de {L.toFixed(0)} m</td></tr></tfoot>
              </table>
            )}
          </Panel>
          <Panel title="Tempos">
            <ul className="space-y-1.5 text-sm">
              {laps.map((t, i) => (
                <li key={t.lapNumber} className="flex justify-between">
                  <span style={{ color: color(i) }}>V{t.lapNumber}{i === 0 ? ' · ref.' : ''}</span>
                  <span className="num">{fmtLapTime(t.lapTime)} {i > 0 && <span className={comps[i - 1].totalDelta > 0 ? 'text-loss' : 'text-gain'}>({fmtDelta(comps[i - 1].totalDelta)})</span>}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>

      {comps.length > 0 && (
        <Panel className="mt-4" title={`Segmentos · V${comps[0].cmp.lapNumber} vs. V${ref.lapNumber}`} bodyClass="!p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="bg-ink-900">
                <tr className="text-left">
                  {['Segmento', 'Ref.', 'Comparada', 'Δ tempo', 'Δ entrada', 'Δ mínima', 'Δ saída', 'Δ frenagem', 'Δ acelerador'].map((h) => <th key={h} className="label px-4 py-2 font-semibold">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {comps[0].segments.map((r) => (
                  <tr key={r.segment.id} onClick={() => { setSegId(r.segment.id); setZoom(null); }} className={cn('cursor-pointer border-t border-ink-700 hover:bg-ink-800', r.segment.id === segId && 'bg-ink-800')}>
                    <td className="px-4 py-2 font-medium">{r.segment.name}</td>
                    <td className="num px-4 py-2">{r.ref.time.toFixed(3)}</td>
                    <td className="num px-4 py-2">{r.cmp.time.toFixed(3)}</td>
                    <td className={cn('num px-4 py-2 font-semibold', r.timeDelta > 0.01 ? 'text-loss' : r.timeDelta < -0.01 ? 'text-gain' : '')}>{fmtDelta(r.timeDelta)}</td>
                    <td className="num px-4 py-2">{fmtSpeedDelta(r.entryDelta, unit)}</td>
                    <td className="num px-4 py-2">{r.segment.kind === 'corner' ? fmtSpeedDelta(r.minDelta, unit) : '—'}</td>
                    <td className="num px-4 py-2">{fmtSpeedDelta(r.exitDelta, unit)}</td>
                    <td className="num px-4 py-2" title={r.ref.brakeOrigin === 'brake-channel' ? 'Canal de freio' : 'Estimado pela desaceleração'}>{fmtSignedMeters(r.brakeDelta, 0)}{r.brakeDelta !== null && r.ref.brakeOrigin !== 'brake-channel' ? '*' : ''}</td>
                    <td className="num px-4 py-2">{fmtSignedMeters(r.throttleDelta, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-ink-700 px-4 py-2.5 text-[11px] text-fg-dim">Δ frenagem negativo = a volta comparada começa a frear antes. * estimativa pela desaceleração (sem canal de freio). Δ acelerador só existe com canal de acelerador (momento em que atinge 80%).</p>
        </Panel>
      )}
    </>
  );
}
