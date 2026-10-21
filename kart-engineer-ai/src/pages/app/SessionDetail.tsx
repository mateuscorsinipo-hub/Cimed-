import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { RotateCcw, Save } from 'lucide-react';
import { PageHeader } from '@/components/app/shared';
import { LapDetectionPanel, LapsTable } from '@/components/app/LapDetectionPanel';
import { Notice, Panel, Spinner, useUi, EmptyState, cn } from '@/components/ui';
import { useApp } from '@/state/AppState';
import { availableLapMethods, type LapDetectionResult } from '@/lib/analysis/pipeline';
import { LAP_SOURCE_LABEL } from '@/lib/lap-detector';
import { SEGMENT_SOURCE_LABEL } from '@/lib/track-map/corners';
import { CHANNEL_LABELS } from '@/lib/telemetry-parser/columns';
import { fmtBytes, fmtDate, fmtLapTime } from '@/lib/format';
import type { PreparedTelemetry } from '@/lib/telemetry-metrics';
import type { ChannelKey, Segment, Session } from '@/lib/types';

export function preparedFromSession(s: Session): PreparedTelemetry {
  return {
    channels: s.channels,
    origins: s.origins,
    xy: s.xy,
    distanceCum: s.channels.distance ?? null,
    distanceSource: s.distanceSource,
    distanceResets: [],
    sampleRate: s.sampleRate,
    warnings: [],
  };
}

const DIST_LABEL = { column: 'coluna do arquivo (medida)', gps: 'GPS filtrado (derivada)', 'integrated-speed': 'integração da velocidade (estimada)', none: 'indisponível' };

export default function SessionDetail() {
  const { id } = useParams();
  const { active, openSession, ready, sessions, updateSession } = useApp();
  const { toast } = useUi();
  const [redetect, setRedetect] = useState<LapDetectionResult | null>(null);
  const [segDraft, setSegDraft] = useState<Segment[] | null>(null);
  const [segErr, setSegErr] = useState<string | null>(null);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (id && ready && active?.id !== id && sessions.some((s) => s.id === id)) openSession(id);
  }, [id, ready, active?.id, sessions, openSession]);
  useEffect(() => {
    setNotes(active?.notes ?? '');
    setSegDraft(null);
    setRedetect(null);
  }, [active?.id]);

  const refLap = active?.laps.find((l) => l.number === active.referenceLap);
  const L = refLap?.distance ?? 1;
  const prepared = useMemo(() => (active ? preparedFromSession(active) : null), [active]);

  if (!ready) return <Spinner />;
  if (!sessions.some((s) => s.id === id)) {
    return <EmptyState title="Sessão não encontrada" actions={<Link to="/app/sessoes" className="btn-primary">Ver sessões</Link>}>Ela pode ter sido excluída ou pertencer a outro navegador.</EmptyState>;
  }
  if (!active || active.id !== id || !prepared) return <Spinner label="Abrindo sessão…" />;
  const s = active;

  const toggle = (n: number) => updateSession({ ...s, laps: s.laps.map((l) => (l.number === n ? { ...l, included: !l.included } : l)) }, { rebuild: true, keepSegments: true });
  const setRef = (n: number) => updateSession({ ...s, referenceLap: n }, { rebuild: true, keepSegments: s.segments[0]?.source === 'manual' });

  const saveSegments = async () => {
    if (!segDraft) return;
    const sorted = [...segDraft].sort((a, b) => a.start - b.start);
    for (let i = 0; i < sorted.length; i++) {
      const g = sorted[i];
      if (!g.name.trim()) return setSegErr('Todo segmento precisa de nome.');
      if (!(g.end > g.start)) return setSegErr(`${g.name}: o fim deve ser maior que o início.`);
      if (i > 0 && g.start < sorted[i - 1].end - 1e-6) return setSegErr(`${g.name} sobrepõe ${sorted[i - 1].name}.`);
    }
    setSegErr(null);
    await updateSession({ ...s, segments: sorted.map((g) => ({ ...g, source: 'manual' as const })) }, { rebuild: true, keepSegments: true });
    setSegDraft(null);
    toast('Segmentos salvos.');
  };

  const editSeg = (i: number, patch: Partial<Segment>) => setSegDraft((d) => d!.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  const segs = segDraft ?? s.segments;
  const channelKeys = (Object.keys(s.channels) as ChannelKey[]).filter((k) => s.channels[k]);

  return (
    <>
      <PageHeader
        eyebrow="Sessão"
        title={s.name}
        subtitle={`${s.trackName || 'Pista não informada'} · ${fmtDate(s.createdAt)}`}
        actions={
          <>
            <Link to="/app/comparar" className="btn-secondary">Comparar voltas</Link>
            <Link to={`/app/relatorios/${s.id}`} className="btn-primary">Relatório</Link>
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Panel title="Voltas" actions={<span className="text-xs text-fg-dim">Desmarque voltas com tráfego, bandeira ou erro para tirá-las das estatísticas.</span>}>
            <LapsTable laps={s.laps} onToggle={toggle} referenceLap={s.referenceLap} onReference={setRef} />
          </Panel>

          <Panel title="Segmentos" actions={
            segDraft ? (
              <>
                <button className="btn-ghost btn-sm" onClick={() => { setSegDraft(null); setSegErr(null); }}>Cancelar</button>
                <button className="btn-primary btn-sm" onClick={saveSegments}><Save className="h-3.5 w-3.5" /> Salvar</button>
              </>
            ) : (
              <>
                <button className="btn-secondary btn-sm" onClick={() => setSegDraft(s.segments.map((g) => ({ ...g })))}>Editar</button>
                <button className="btn-ghost btn-sm" onClick={() => updateSession({ ...s, segments: [] }, { rebuild: true }).then(() => toast('Segmentos recalculados automaticamente.'))}>
                  <RotateCcw className="h-3.5 w-3.5" /> Automático
                </button>
              </>
            )
          }>
            <p className="mb-3 text-xs text-fg-dim">Origem: {s.segments[0] ? SEGMENT_SOURCE_LABEL[s.segments[0].source] : '—'}. Posições em metros pela distância da volta de referência ({L.toFixed(0)} m).</p>
            <div className="overflow-x-auto rounded-lg border border-ink-600">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="bg-ink-900">
                  <tr className="text-left">{['Nome', 'Tipo', 'Início (m)', 'Fim (m)', 'Sentido'].map((h) => <th key={h} className="label px-3 py-2 font-semibold">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {segs.map((g, i) => (
                    <tr key={g.id} className="border-t border-ink-700">
                      <td className="px-3 py-1.5">{segDraft ? <input className="input !py-1" value={g.name} onChange={(e) => editSeg(i, { name: e.target.value })} aria-label="Nome do segmento" /> : g.name}</td>
                      <td className="px-3 py-1.5">
                        {segDraft ? (
                          <select className="input !py-1" value={g.kind} onChange={(e) => editSeg(i, { kind: e.target.value as Segment['kind'] })} aria-label="Tipo">
                            <option value="corner">Curva</option>
                            <option value="straight">Reta</option>
                          </select>
                        ) : g.kind === 'corner' ? 'Curva' : 'Reta'}
                      </td>
                      {(['start', 'end'] as const).map((k) => (
                        <td key={k} className="num px-3 py-1.5">
                          {segDraft ? (
                            <input type="number" className="input w-24 !py-1" value={Math.round(g[k] * L)} min={0} max={Math.round(L)} onChange={(e) => editSeg(i, { [k]: Math.min(1, Math.max(0, Number(e.target.value) / L)) })} aria-label={k === 'start' ? 'Início' : 'Fim'} />
                          ) : Math.round(g[k] * L)}
                        </td>
                      ))}
                      <td className="px-3 py-1.5 text-fg-muted">{g.direction === 'L' ? 'Esquerda' : g.direction === 'R' ? 'Direita' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {segErr && <p className="mt-2 text-sm text-loss">{segErr}</p>}
          </Panel>

          <Panel title="Recalcular voltas">
            {redetect ? (
              <>
                <LapDetectionPanel prepared={prepared} value={redetect} onChange={setRedetect} />
                <div className="mt-4 flex gap-2">
                  <button className="btn-secondary" onClick={() => setRedetect(null)}>Cancelar</button>
                  <button
                    className="btn-primary"
                    disabled={!redetect.laps.some((l) => l.included) || !redetect.source}
                    onClick={async () => {
                      await updateSession({ ...s, laps: redetect.laps, lapSource: redetect.source!, gate: redetect.gate, referenceLap: null, segments: [] }, { rebuild: true });
                      setRedetect(null);
                      toast('Voltas atualizadas e análise recalculada.');
                    }}
                  >
                    Aplicar
                  </button>
                </div>
              </>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-fg-muted">Método atual: {LAP_SOURCE_LABEL[s.lapSource]}. Redefina a linha de chegada, o comprimento da pista ou os instantes de passagem.</p>
                <button className="btn-secondary" onClick={() => setRedetect({ laps: s.laps, source: s.lapSource, gate: s.gate, message: `${s.laps.length} volta(s) atuais.`, available: availableLapMethods(prepared) })}>
                  Redefinir voltas
                </button>
              </div>
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Dados da sessão">
            <dl className="space-y-2 text-sm">
              {[
                ['Arquivo', `${s.source.fileName} (${fmtBytes(s.source.fileSize)})`],
                ['Formato', s.source.format.toUpperCase()],
                ['Amostragem', `${s.sampleRate.toFixed(1)} Hz`],
                ['Duração', `${Math.round(s.channels.time[s.channels.time.length - 1])} s`],
                ['Distância', DIST_LABEL[s.distanceSource]],
                ['Voltas', LAP_SOURCE_LABEL[s.lapSource]],
                ['Melhor volta', fmtLapTime(s.summary.bestLapTime)],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 border-b border-ink-700 pb-2 last:border-0">
                  <dt className="text-fg-muted">{k}</dt>
                  <dd className="text-right">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {channelKeys.map((k) => (
                <span key={k} className={cn('chip', s.origins[k] === 'derived' ? 'border-data/40 text-data' : 'border-gain/40 text-gain')}>
                  {CHANNEL_LABELS[k]}{s.origins[k] === 'derived' ? ' (derivado)' : ''}
                </span>
              ))}
            </div>
          </Panel>
          {s.warnings.length > 0 && (
            <Panel title="Avisos da importação">
              <div className="space-y-2">{s.warnings.map((w) => <Notice key={w} tone="warn">{w}</Notice>)}</div>
            </Panel>
          )}
          <Panel title="Notas">
            <textarea className="input min-h-[140px]" value={notes} maxLength={5000} onChange={(e) => setNotes(e.target.value)} placeholder="Condições da pista, pneus, ajustes de chassi, sensações…" aria-label="Notas da sessão" />
            <button className="btn-secondary btn-sm mt-2" disabled={notes === s.notes} onClick={() => updateSession({ ...s, notes }).then(() => toast('Notas salvas.'))}>
              <Save className="h-3.5 w-3.5" /> Salvar notas
            </button>
          </Panel>
        </div>
      </div>
    </>
  );
}
