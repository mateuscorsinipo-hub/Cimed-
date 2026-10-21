import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FileDown, FileText, Printer, Table } from 'lucide-react';
import { DiagnosticCard, LAP_COLORS, PageHeader } from '@/components/app/shared';
import { LapsTable } from '@/components/app/LapDetectionPanel';
import { LineChart } from '@/components/charts/LineChart';
import { TrackMap } from '@/components/charts/TrackMap';
import { EmptyState, Kpi, Notice, Panel, Spinner, useUi } from '@/components/ui';
import { useAnalysis, useApp } from '@/state/AppState';
import { compareLaps, includedTraces, segmentStats } from '@/lib/lap-comparator';
import { dataLimitations } from '@/lib/diagnostics-engine';
import { DISCLAIMER, downloadBlob, generatePdf, lapsCsv, safeFileName, segmentsCsv, telemetryCsv } from '@/lib/report-generator';
import { exportBackup } from '@/lib/session-storage';
import { fmtDate, fmtDelta, fmtLapTime, fmtPct, fmtSpeed } from '@/lib/format';
import { speedToDisplay, speedUnitLabel } from '@/lib/telemetry-parser/units';
import { tracePoints } from '@/lib/track-map/trajectory';
import type { Session } from '@/lib/types';

export default function Reports() {
  const { id } = useParams();
  const { ready, sessions, active, openSession } = useApp();
  const nav = useNavigate();
  useEffect(() => {
    if (id && ready && active?.id !== id && sessions.some((s) => s.id === id)) openSession(id);
  }, [id, ready, active?.id, sessions, openSession]);

  if (!ready) return <Spinner />;
  if (!id) {
    return (
      <>
        <PageHeader eyebrow="Relatórios" title="Relatórios por sessão" subtitle="Gere PDF, imprima ou exporte os dados em CSV e JSON." />
        {!sessions.length ? (
          <EmptyState icon={<FileText className="h-6 w-6" />} title="Nenhuma sessão para relatar" actions={<Link to="/app/analise" className="btn-primary">Importar telemetria</Link>} />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {sessions.map((m) => (
              <button key={m.id} onClick={() => nav(`/app/relatorios/${m.id}`)} className="panel p-5 text-left transition-colors hover:border-gain/50">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="truncate font-semibold">{m.name}</h2>
                  {m.isDemo && <span className="chip border-warn/40 text-warn">demo</span>}
                </div>
                <p className="mt-1 text-sm text-fg-muted">{m.trackName || 'Pista não informada'} · {fmtDate(m.createdAt)}</p>
                <p className="num mt-3 text-gain">{fmtLapTime(m.summary.bestLapTime)}</p>
              </button>
            ))}
          </div>
        )}
      </>
    );
  }
  if (!sessions.some((s) => s.id === id)) return <EmptyState title="Sessão não encontrada" actions={<Link to="/app/relatorios" className="btn-primary">Ver relatórios</Link>} />;
  if (!active || active.id !== id) return <Spinner label="Abrindo sessão…" />;
  return <Report session={active} />;
}

function Report({ session }: { session: Session }) {
  const analysis = useAnalysis(session);
  const { prefs } = useApp();
  const { toast } = useUi();
  const [busy, setBusy] = useState(false);
  if (!analysis) return null;
  const s = session.summary;
  const unit = prefs.speedUnit;
  const ref = session.referenceLap !== null ? analysis.traces.get(session.referenceLap) : undefined;
  const second = session.laps.filter((l) => l.included && l.number !== session.referenceLap).sort((a, b) => a.lapTime - b.lapTime)[0];
  const cmp = second ? analysis.traces.get(second.number) : undefined;
  const comparison = ref && cmp ? compareLaps(ref, cmp, session.segments) : null;
  const inc = includedTraces(analysis.traces, session.laps);
  const stats = inc.length ? segmentStats(inc, session.segments) : [];
  const diags = analysis.diagnostics.filter((d) => d.rule !== 'data-quality');
  const limits = [...(analysis.ctx ? dataLimitations(analysis.ctx) : []), ...session.warnings];
  const base = safeFileName(session.name);
  const csv = (text: string, name: string) => downloadBlob(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }), name);

  const pdf = async () => {
    setBusy(true);
    try {
      const blob = await generatePdf({ session, traces: analysis.traces, diagnostics: analysis.diagnostics, ctx: analysis.ctx, speedUnit: unit });
      downloadBlob(blob, `${base}-relatorio.pdf`);
    } catch (e) {
      toast(`Falha ao gerar PDF: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="print-area">
      <PageHeader
        eyebrow="Relatório de sessão"
        title={session.name}
        subtitle={`${session.trackName || 'Pista não informada'} · ${fmtDate(session.createdAt)} · ${session.source.fileName}`}
        actions={
          <>
            <button className="btn-primary" onClick={pdf} disabled={busy}><FileDown className="h-4 w-4" /> {busy ? 'Gerando…' : 'Exportar PDF'}</button>
            <button className="btn-secondary" onClick={() => window.print()}><Printer className="h-4 w-4" /> Imprimir</button>
          </>
        }
      />
      {session.isDemo && <div className="mb-4"><Notice tone="warn" title="Dados demonstrativos">Sessão sintética em pista fictícia. Não representa piloto ou resultado real.</Notice></div>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Melhor volta" value={fmtLapTime(s.bestLapTime)} sub={`Volta ${s.bestLapNumber ?? '—'}`} tone="gain" />
        <Kpi label="Média" value={fmtLapTime(s.meanLapTime)} />
        <Kpi label="Voltas válidas" value={`${s.validLapCount}/${s.lapCount}`} />
        <Kpi label="Desvio-padrão" value={s.consistencyStd !== null ? `${s.consistencyStd.toFixed(3)} s` : '—'} sub={s.consistencyCv !== null ? `CV ${fmtPct(s.consistencyCv)}` : undefined} />
        <Kpi label="Vel. máxima" value={fmtSpeed(s.maxSpeed, unit)} sub={session.origins.speed === 'derived' ? 'estimativa' : 'medição'} />
        <Kpi label="Soma melhores segm." value={fmtLapTime(s.theoreticalBest)} sub="cálculo, não previsão" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <Panel title={comparison ? `Comparação V${ref!.lapNumber} × V${cmp!.lapNumber}` : 'Velocidade'}>
          {ref ? (
            <>
              <LineChart
                title="Velocidade"
                unit={speedUnitLabel(unit)}
                format={(v) => v.toFixed(0)}
                height={200}
                series={[ref, ...(cmp ? [cmp] : [])].map((t, i) => ({ id: String(t.lapNumber), label: `V${t.lapNumber}`, color: LAP_COLORS[i], x: ref.frac.map((f) => f * ref.distance), y: t.speed.map((v) => speedToDisplay(v, unit)) }))}
              />
              {comparison && (
                <LineChart className="mt-4" title="Δ tempo acumulado" unit="s" format={(v) => v.toFixed(2)} height={120} zeroLine signColored series={[{ id: 'd', label: `V${cmp!.lapNumber} − V${ref.lapNumber}`, color: '#FF4F4F', x: ref.frac.map((f) => f * ref.distance), y: comparison.delta }]} />
              )}
            </>
          ) : <p className="text-sm text-fg-muted">Sem volta de referência.</p>}
        </Panel>
        <Panel title="Mapa do circuito">
          {ref?.x ? (
            <TrackMap points={tracePoints(ref)!} colorValues={ref.speed} labels={session.segments.filter((g) => g.kind === 'corner').map((g) => ({ fraction: g.apex ?? g.start, text: g.name.replace('Curva ', '') }))} height={320} />
          ) : <p className="text-sm text-fg-muted">Sem GPS nesta sessão: mapa real indisponível.</p>}
        </Panel>
      </div>

      <Panel className="mt-6" title="Voltas"><LapsTable laps={session.laps} /></Panel>

      {stats.length > 0 && (
        <Panel className="mt-6" title="Segmentos críticos e consistência" bodyClass="!p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-ink-900"><tr className="text-left">{['Segmento', 'Referência', 'Melhor', 'Média', 'Desvio', 'Ref. − melhor'].map((h) => <th key={h} className="label px-4 py-2 font-semibold">{h}</th>)}</tr></thead>
              <tbody>
                {stats.map((r) => {
                  const refT = r.times.find((t) => t.lap === session.referenceLap)?.time;
                  return (
                    <tr key={r.segment.id} className="border-t border-ink-700">
                      <td className="px-4 py-2 font-medium">{r.segment.name}</td>
                      <td className="num px-4 py-2">{refT?.toFixed(3) ?? '—'}</td>
                      <td className="num px-4 py-2">{r.best.toFixed(3)} <span className="text-fg-dim">(V{r.bestLap})</span></td>
                      <td className="num px-4 py-2">{r.mean.toFixed(3)}</td>
                      <td className="num px-4 py-2">{Number.isFinite(r.std) ? r.std.toFixed(3) : '—'}</td>
                      <td className="num px-4 py-2">{refT !== undefined ? fmtDelta(refT - r.best) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <h2 className="mb-3 mt-8 text-xl font-semibold">Diagnósticos e recomendações prioritárias</h2>
      {diags.length ? <div className="grid gap-4 lg:grid-cols-2">{diags.map((d) => <DiagnosticCard key={d.id} d={d} />)}</div> : <p className="text-sm text-fg-muted">Nenhum diagnóstico atende aos critérios das regras.</p>}

      <Panel className="mt-6" title="Limitações dos dados">
        {limits.length ? <ul className="list-disc space-y-1 pl-5 text-sm text-fg-muted">{limits.map((l) => <li key={l}>{l}</li>)}</ul> : <p className="text-sm text-fg-muted">Nenhuma limitação relevante identificada.</p>}
        <p className="mt-4 text-xs text-fg-dim">{DISCLAIMER}</p>
      </Panel>

      <Panel className="no-print mt-6" title="Exportar dados">
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={() => csv(lapsCsv(session), `${base}-voltas.csv`)}><Table className="h-4 w-4" /> Voltas (CSV)</button>
          <button className="btn-secondary" onClick={() => csv(segmentsCsv(session, analysis.traces), `${base}-segmentos.csv`)}><Table className="h-4 w-4" /> Segmentos (CSV)</button>
          <button className="btn-secondary" onClick={() => csv(telemetryCsv(session), `${base}-telemetria.csv`)}><Table className="h-4 w-4" /> Telemetria normalizada (CSV)</button>
          <button className="btn-secondary" onClick={async () => downloadBlob(new Blob([JSON.stringify(await exportBackup([session.id]))], { type: 'application/json' }), `${base}.kart.json`)}><FileDown className="h-4 w-4" /> Sessão completa (JSON)</button>
        </div>
      </Panel>
    </div>
  );
}
