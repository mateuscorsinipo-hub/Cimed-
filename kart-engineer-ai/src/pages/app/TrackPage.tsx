import { useEffect, useMemo, useState } from 'react';
import { Eraser, Link2, PenLine, Save, Trash2, Undo2 } from 'lucide-react';
import { LAP_COLORS, PageHeader, WithSession } from '@/components/app/shared';
import { LineChart } from '@/components/charts/LineChart';
import { TrackMap, type MapMarker } from '@/components/charts/TrackMap';
import { cn, Field, KindTag, Notice, Panel, Tabs, useUi } from '@/components/ui';
import { useAnalysis, useApp } from '@/state/AppState';
import { compareLaps } from '@/lib/lap-comparator';
import { derivative, movingAverage, type LapTrace } from '@/lib/telemetry-metrics';
import { gpsNoiseFloor, lateralDeviation, segmentDeviation, tracePoints } from '@/lib/track-map/trajectory';
import { catmullRomClosed, cumulativeLengths, polylineLength, resamplePolyline } from '@/lib/track-map/geometry';
import { deleteTrack, listTracks, saveTrack } from '@/lib/session-storage';
import { uid } from '@/lib/analysis/pipeline';
import { fmtDelta, fmtLapTime, fmtSignedMeters, fmtSpeedDelta } from '@/lib/format';
import type { Segment, Session, TrackDef, TrajectoryMarker, XY } from '@/lib/types';

type Tab = 'mapa' | 'linha' | 'manual';

export default function TrackPage() {
  const [tab, setTab] = useState<Tab>('mapa');
  return (
    <>
      <PageHeader
        eyebrow="Traçado"
        title="Mapa, trajetórias e linha de referência"
        subtitle="Trajetórias vêm do GPS do arquivo. Sem GPS, desenhe um traçado esquemático — ele não representa a geometria real da pista."
        actions={<Tabs value={tab} onChange={setTab} items={[{ id: 'mapa', label: 'Mapa do circuito' }, { id: 'linha', label: 'Linha ideal' }, { id: 'manual', label: 'Traçado manual' }]} />}
      />
      {tab === 'manual' ? <ManualTrackEditor /> : <WithSession what="visualizar o traçado">{(s) => (tab === 'mapa' ? <CircuitMap session={s} /> : <IdealLine session={s} />)}</WithSession>}
    </>
  );
}

function corners(session: Session) {
  return session.segments.filter((g) => g.kind === 'corner').map((g) => ({ fraction: g.apex ?? (g.start + g.end) / 2, text: g.name.replace('Curva ', '') }));
}

function CircuitMap({ session }: { session: Session }) {
  const analysis = useAnalysis(session);
  const { prefs } = useApp();
  const [lapNum, setLapNum] = useState<number>(session.referenceLap ?? session.laps[0]?.number);
  const [cmpNum, setCmpNum] = useState<number | null>(null);
  const [mode, setMode] = useState<'speed' | 'delta'>('speed');
  const [segId, setSegId] = useState<string | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [tracks, setTracks] = useState<TrackDef[]>([]);
  useEffect(() => {
    listTracks().then(setTracks).catch(() => undefined);
  }, []);

  const tr = analysis?.traces.get(lapNum);
  const cmp = cmpNum !== null ? analysis?.traces.get(cmpNum) : undefined;
  const pts = tr ? tracePoints(tr) : null;
  const schematic = !pts ? tracks.find((t) => t.id === session.trackId) : undefined;
  const comparison = useMemo(() => (tr && cmp ? compareLaps(tr, cmp, session.segments) : null), [tr, cmp, session.segments]);

  // Colorir pela taxa de variação do delta: vermelho onde a comparada perde tempo.
  const colorValues = useMemo(() => {
    if (!tr) return undefined;
    if (mode === 'delta' && comparison) {
      const g = movingAverage(derivative(comparison.delta, tr.frac.map((f) => f * tr.distance)), 9);
      return g.map((v) => -v);
    }
    return tr.speed;
  }, [tr, mode, comparison]);
  if (!analysis) return null;

  const ref = comparison ?? (tr ? compareLaps(tr, tr, session.segments) : null);
  const markers: MapMarker[] = [];
  ref?.segments.forEach((r) => {
    if (r.ref.brakeStart !== null) markers.push({ id: `b${r.segment.id}`, fraction: r.ref.brakeStart, color: '#FF4F4F', shape: 'bar' });
    if (r.ref.throttlePickup !== null) markers.push({ id: `t${r.segment.id}`, fraction: r.ref.throttlePickup, color: '#C6F432', shape: 'diamond' });
  });
  const seg = session.segments.find((g) => g.id === segId);
  const segRow = ref?.segments.find((r) => r.segment.id === segId);
  const brakeOrigin = ref?.segments.find((r) => r.ref.brakeOrigin)?.ref.brakeOrigin;

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <Panel bodyClass="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Volta">
            {(id) => (
              <select id={id} className="input !w-auto" value={lapNum} onChange={(e) => setLapNum(Number(e.target.value))}>
                {session.laps.map((l) => <option key={l.number} value={l.number}>V{l.number} · {fmtLapTime(l.lapTime)}{l.number === session.referenceLap ? ' · ref.' : ''}</option>)}
              </select>
            )}
          </Field>
          <Field label="Comparar com">
            {(id) => (
              <select id={id} className="input !w-auto" value={cmpNum ?? ''} onChange={(e) => setCmpNum(e.target.value ? Number(e.target.value) : null)}>
                <option value="">—</option>
                {session.laps.filter((l) => l.number !== lapNum).map((l) => <option key={l.number} value={l.number}>V{l.number} · {fmtLapTime(l.lapTime)}</option>)}
              </select>
            )}
          </Field>
          <Tabs value={mode} onChange={setMode} items={[{ id: 'speed', label: 'Cor: velocidade' }, { id: 'delta', label: 'Cor: ganho/perda' }]} />
        </div>
        {pts ? (
          <TrackMap
            points={pts}
            colorValues={mode === 'delta' && !comparison ? tr!.speed : colorValues}
            overlays={cmp?.x ? [{ id: 'c', points: tracePoints(cmp)!, color: '#4DA3FF', label: `V${cmp.lapNumber}`, width: 1.2, dashed: true }] : []}
            labels={corners(session)}
            markers={markers}
            highlight={seg ? { start: seg.start, end: seg.end } : null}
            cursorFraction={cursor}
            onHover={setCursor}
            onPick={(f) => setSegId(session.segments.find((g) => f >= g.start && f <= g.end)?.id ?? null)}
            height={520}
          />
        ) : schematic ? (
          <TrackMap points={schematic.points} schematic labels={schematic.segments.filter((g) => g.kind === 'corner').map((g) => ({ fraction: g.apex ?? g.start, text: g.name.replace('Curva ', '') }))} height={480}
            footer={<div className="border-t border-ink-600 px-3 py-2 text-[11px] text-warn">Traçado esquemático “{schematic.name}”, desenhado manualmente — não representa a geometria real.</div>} />
        ) : (
          <Notice tone="info" title="Sem GPS nesta sessão">Não é possível reconstruir a trajetória real. Crie um traçado esquemático na aba “Traçado manual” e vincule-o a esta sessão.</Notice>
        )}
        <div className="flex flex-wrap gap-4 text-[11px] text-fg-dim">
          <span className="flex items-center gap-1.5"><i className="h-3 w-1 bg-loss" /> Início de frenagem ({brakeOrigin === 'brake-channel' ? 'canal de freio' : 'estimado pela desaceleração'})</span>
          {session.channels.throttle && <span className="flex items-center gap-1.5"><i className="h-2 w-2 rotate-45 bg-gain" /> Acelerador ≥ 80% após o ápice (medido)</span>}
          {mode === 'delta' && comparison && <span>Vermelho: trechos onde V{cmp!.lapNumber} perde tempo para V{tr!.lapNumber}; verde: ganha.</span>}
          <span>Zoom: botões ou Ctrl + roda do mouse. Arraste para mover.</span>
        </div>
      </Panel>
      <div className="space-y-4">
        <Panel title="Segmentos">
          <ul className="space-y-1">
            {session.segments.map((g) => {
              const r = ref?.segments.find((x) => x.segment.id === g.id);
              return (
                <li key={g.id}>
                  <button onClick={() => setSegId(g.id === segId ? null : g.id)} className={cn('flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-ink-800', g.id === segId && 'bg-ink-700')}>
                    <span>{g.name} {g.direction && <span className="text-xs text-fg-dim">({g.direction === 'L' ? 'esq.' : 'dir.'})</span>}</span>
                    <span className="num text-xs">
                      {r ? `${r.ref.time.toFixed(3)} s` : ''}
                      {comparison && r && <span className={cn('ml-2', r.timeDelta > 0.01 ? 'text-loss' : r.timeDelta < -0.01 ? 'text-gain' : 'text-fg-dim')}>{fmtDelta(r.timeDelta, 2)}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Panel>
        {seg && segRow && (
          <Panel title={seg.name}>
            <dl className="space-y-1.5 text-sm">
              {[
                ['Tempo no segmento', `${segRow.ref.time.toFixed(3)} s`, 'calculated'],
                ['Velocidade de entrada', `${(segRow.ref.entrySpeed * 3.6).toFixed(1)} km/h`, session.origins.speed === 'derived' ? 'derived' : 'measured'],
                ['Velocidade mínima', `${(segRow.ref.minSpeed * 3.6).toFixed(1)} km/h`, session.origins.speed === 'derived' ? 'derived' : 'measured'],
                ['Velocidade de saída', `${(segRow.ref.exitSpeed * 3.6).toFixed(1)} km/h`, session.origins.speed === 'derived' ? 'derived' : 'measured'],
                ['Desaceleração máxima', `${Math.abs(segRow.ref.maxDecel).toFixed(2)} g`, tr?.accelOrigin === 'measured' ? 'measured' : 'derived'],
              ].map(([k, v, kind]) => (
                <div key={k} className="flex items-center justify-between gap-2">
                  <dt className="text-fg-muted">{k}</dt>
                  <dd className="flex items-center gap-2"><span className="num">{v}</span><KindTag kind={kind as 'measured'} /></dd>
                </div>
              ))}
            </dl>
            {comparison && (
              <p className="mt-3 text-xs text-fg-muted">V{cmp!.lapNumber}: {fmtDelta(segRow.timeDelta)} · saída {fmtSpeedDelta(segRow.exitDelta, prefs.speedUnit)} · mínima {fmtSpeedDelta(segRow.minDelta, prefs.speedUnit)}</p>
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}

function IdealLine({ session }: { session: Session }) {
  const analysis = useAnalysis(session);
  const { updateSession, prefs } = useApp();
  const { confirm } = useUi();
  const refNum = session.referenceLap ?? session.laps[0]?.number;
  const [lapNums, setLapNums] = useState<number[]>(() => session.laps.filter((l) => l.included && l.number !== refNum).slice(0, 2).map((l) => l.number));
  const [tool, setTool] = useState<'none' | 'entry' | 'apex' | 'exit' | 'line'>('none');
  const [cursor, setCursor] = useState<number | null>(null);
  if (!analysis) return null;
  const ref = analysis.traces.get(refNum);
  if (!session.xy || !ref?.x) {
    return <Notice tone="info" title="Linha ideal requer GPS">Esta sessão não tem coordenadas GPS. A comparação de trajetórias e o desvio lateral dependem da posição registrada.</Notice>;
  }
  const refPts = tracePoints(ref)!;
  const noise = gpsNoiseFloor(session.sampleRate);
  const others = lapNums.map((n) => analysis.traces.get(n)).filter((t): t is LapTrace => !!t && !!t.x);
  const devs = others.map((t) => ({ t, dev: lateralDeviation(refPts, tracePoints(t)!), cmp: compareLaps(ref, t, session.segments) }));
  const L = ref.distance;
  const x = ref.frac.map((f) => f * L);
  const refLine = session.referenceLine;
  const refLineDev = refLine && refLine.length > 2 ? lateralDeviation(resamplePolyline(refLine, 1), refPts) : null;

  const pick = async (f: number, q: XY) => {
    if (tool === 'line') {
      await updateSession({ ...session, referenceLine: [...(session.referenceLine ?? []), q] });
      return;
    }
    if (tool === 'none') return;
    const seg = session.segments.find((g) => f >= g.start && f <= g.end);
    const m: TrajectoryMarker = { id: uid(), type: tool, fraction: f, segmentId: seg?.id };
    await updateSession({ ...session, trajectoryMarkers: [...session.trajectoryMarkers, m] });
  };

  const mColors = { entry: '#4DA3FF', apex: '#FFB547', exit: '#C6F432' } as const;
  const mLabel = { entry: 'E', apex: 'A', exit: 'S' } as const;

  // Hipóteses: segmentos em que desvio acima do ruído coincide com diferença de tempo.
  const hyps = devs.flatMap(({ t, dev, cmp }) =>
    session.segments
      .filter((g) => g.kind === 'corner')
      .map((g) => {
        const d = segmentDeviation(dev, g);
        const r = cmp.segments.find((s) => s.segment.id === g.id)!;
        return { t, g, d, r };
      })
      .filter(({ d, r }) => Math.abs(d.atApex) >= noise && Math.abs(r.timeDelta) >= 0.03),
  ).sort((a, b) => Math.abs(b.r.timeDelta) - Math.abs(a.r.timeDelta)).slice(0, 4);

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
      <Panel bodyClass="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="label">Ferramenta:</span>
          {([['none', 'Navegar'], ['entry', 'Marcar entrada'], ['apex', 'Marcar ápice'], ['exit', 'Marcar saída'], ['line', 'Desenhar linha de referência']] as const).map(([id, label]) => (
            <button key={id} onClick={() => setTool(id)} aria-pressed={tool === id} className={cn('rounded-md border px-2.5 py-1 text-xs font-semibold', tool === id ? 'border-gain/60 bg-gain/10 text-gain' : 'border-ink-600 text-fg-muted hover:text-fg')}>
              {id === 'line' && <PenLine className="mr-1 inline h-3 w-3" />}{label}
            </button>
          ))}
          {refLine && refLine.length > 0 && (
            <>
              <button className="btn-ghost btn-sm" onClick={() => updateSession({ ...session, referenceLine: refLine.slice(0, -1) })}><Undo2 className="h-3.5 w-3.5" /> Desfazer ponto</button>
              <button className="btn-ghost btn-sm" onClick={async () => (await confirm({ title: 'Apagar linha de referência?', message: 'Os pontos desenhados serão removidos.', danger: true, confirmLabel: 'Apagar' })) && updateSession({ ...session, referenceLine: [] })}><Eraser className="h-3.5 w-3.5" /> Apagar linha</button>
            </>
          )}
        </div>
        <TrackMap
          points={refPts}
          overlays={[
            ...others.map((t, i) => ({ id: `l${t.lapNumber}`, points: tracePoints(t)!, color: LAP_COLORS[(i + 1) % LAP_COLORS.length], label: `V${t.lapNumber}`, width: 1.4 })),
            ...(refLine && refLine.length > 1 ? [{ id: 'refline', points: refLine, color: '#E17CFF', label: 'Linha de referência', width: 2, dashed: true }] : []),
          ]}
          labels={corners(session)}
          markers={session.trajectoryMarkers.map((m) => ({ id: m.id, fraction: m.fraction, color: mColors[m.type], label: mLabel[m.type] }))}
          cursorFraction={cursor}
          onHover={setCursor}
          onPick={(f, q) => pick(f, q)}
          height={520}
        />
        <div className="flex flex-wrap gap-4 text-[11px] text-fg-muted">
          <span style={{ color: LAP_COLORS[0] }}>— V{ref.lapNumber} (referência)</span>
          {others.map((t, i) => <span key={t.lapNumber} style={{ color: LAP_COLORS[(i + 1) % LAP_COLORS.length] }}>— V{t.lapNumber}</span>)}
          {refLine && refLine.length > 1 && <span className="text-[#E17CFF]">- - linha de referência manual</span>}
        </div>
        <LineChart
          title="Desvio lateral em relação à referência"
          unit="m"
          format={(v) => v.toFixed(1)}
          zeroLine
          series={[
            ...devs.map(({ t, dev }, i) => ({ id: `d${t.lapNumber}`, label: `V${t.lapNumber}`, color: LAP_COLORS[(i + 1) % LAP_COLORS.length], x, y: dev })),
            ...(refLineDev ? [{ id: 'rl', label: `V${ref.lapNumber} vs. linha manual`, color: '#E17CFF', x, y: refLineDev, dashed: true }] : []),
          ]}
          bands={[{ x0: 0, x1: L, color: 'transparent' }]}
          yDomain={undefined}
          cursorX={cursor !== null ? cursor * L : null}
          onCursor={(v) => setCursor(v !== null ? v / L : null)}
          height={170}
          emptyText="Selecione voltas para comparar trajetórias."
        />
        <p className="text-[11px] text-fg-dim">Positivo = à esquerda da trajetória de referência. Desvios menores que ±{noise.toFixed(1)} m são indistinguíveis do ruído típico do GPS nesta taxa de amostragem ({session.sampleRate.toFixed(0)} Hz).</p>
      </Panel>

      <div className="space-y-4">
        <Panel title="Voltas comparadas">
          <div className="flex flex-wrap gap-1.5">
            {session.laps.filter((l) => l.number !== refNum).map((l) => (
              <button key={l.number} onClick={() => setLapNums((s) => (s.includes(l.number) ? s.filter((n) => n !== l.number) : [...s, l.number].slice(-4)))} aria-pressed={lapNums.includes(l.number)} className={cn('rounded-md border px-2 py-1 text-xs', lapNums.includes(l.number) ? 'border-gain/60 text-gain' : 'border-ink-600 text-fg-muted')}>
                V{l.number}
              </button>
            ))}
          </div>
        </Panel>
        <Panel title="Hipóteses de trajetória para testar">
          {hyps.length ? (
            <ul className="space-y-3 text-sm">
              {hyps.map(({ t, g, d, r }) => (
                <li key={`${t.lapNumber}-${g.id}`} className="rounded-lg border border-ink-600 p-3">
                  <div className="flex items-center justify-between gap-2"><span className="font-semibold">{g.name} · V{t.lapNumber}</span><KindTag kind="hypothesis" /></div>
                  <p className="mt-1.5 text-fg-muted">
                    No ápice, V{t.lapNumber} passou {fmtSignedMeters(Math.abs(d.atApex))} {d.atApex > 0 ? 'à esquerda' : 'à direita'} da referência; saída {fmtSpeedDelta(r.exitDelta, prefs.speedUnit)} e tempo {fmtDelta(r.timeDelta)} no segmento.
                  </p>
                  <p className="mt-1.5 text-xs text-fg-dim">
                    {r.timeDelta < 0 ? 'A variação coincidiu com ganho de tempo — vale testar essa trajetória de forma controlada.' : 'A variação coincidiu com perda de tempo — compare com a trajetória da referência.'} Coincidência não prova causa.
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-fg-muted">Nenhum segmento com desvio acima do ruído do GPS (±{noise.toFixed(1)} m) e diferença de tempo relevante nas voltas selecionadas.</p>
          )}
          <p className="mt-3 text-[11px] leading-relaxed text-fg-dim">A trajetória mais curta não é necessariamente a mais rápida: o que importa é a velocidade que você consegue manter e levar para a reta. Este sistema não calcula uma linha matematicamente ideal — isso exigiria um modelo físico de aderência e do kart que não está disponível.</p>
        </Panel>
        <Panel title={`Marcações (${session.trajectoryMarkers.length})`}>
          {session.trajectoryMarkers.length ? (
            <ul className="space-y-1 text-sm">
              {[...session.trajectoryMarkers].sort((a, b) => a.fraction - b.fraction).map((m) => (
                <li key={m.id} className="flex items-center justify-between">
                  <span><span className="font-semibold" style={{ color: mColors[m.type] }}>{{ entry: 'Entrada', apex: 'Ápice', exit: 'Saída' }[m.type]}</span> · {session.segments.find((g) => g.id === m.segmentId)?.name ?? '—'} · {(m.fraction * L).toFixed(0)} m</span>
                  <button className="btn-ghost btn-sm" aria-label="Remover marcação" onClick={() => updateSession({ ...session, trajectoryMarkers: session.trajectoryMarkers.filter((x) => x.id !== m.id) })}><Trash2 className="h-3.5 w-3.5" /></button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-fg-muted">Escolha “Marcar entrada/ápice/saída” e clique no mapa.</p>
          )}
        </Panel>
      </div>
    </div>
  );
}

/* --------------------------- Editor de traçado manual --------------------------- */

const EW = 1000;
const EH = 620;

function ManualTrackEditor() {
  const { active, updateSession } = useApp();
  const { toast, confirm } = useUi();
  const [tracks, setTracks] = useState<TrackDef[]>([]);
  const [editing, setEditing] = useState<TrackDef | null>(null);
  const [ctrl, setCtrl] = useState<XY[]>([]);
  const [cornerFs, setCornerFs] = useState<number[]>([]);
  const [mode, setMode] = useState<'points' | 'corners'>('points');
  const [name, setName] = useState('');
  const [length, setLength] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const reload = () => listTracks().then(setTracks).catch(() => setTracks([]));
  useEffect(() => {
    reload();
  }, []);

  const path = useMemo(() => (ctrl.length >= 3 ? catmullRomClosed(ctrl, 20) : []), [ctrl]);
  const cum = useMemo(() => cumulativeLengths(path), [path]);
  const pathD = path.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('');

  const start = (t?: TrackDef) => {
    setErr(null);
    if (t) {
      // Converte de metros para o espaço do editor.
      const L = t.length;
      const pl = polylineLength(t.points) || 1;
      const k = pl / L;
      setEditing(t);
      setName(t.name);
      setLength(String(Math.round(L)));
      setCtrl(t.points.filter((_, i) => i % 20 === 0).map((p) => ({ x: p.x * k, y: EH - p.y * k })));
      setCornerFs(t.segments.filter((g) => g.kind === 'corner').map((g) => g.apex ?? g.start));
    } else {
      setEditing({ id: uid(), name: '', kind: 'manual', points: [], length: 0, segments: [], createdAt: Date.now(), updatedAt: Date.now() });
      setName('');
      setLength('');
      setCtrl([]);
      setCornerFs([]);
    }
    setMode('points');
  };

  const click = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const q = { x: ((e.clientX - r.left) / r.width) * EW, y: ((e.clientY - r.top) / r.height) * EH };
    if (mode === 'points') setCtrl((c) => [...c, q]);
    else if (path.length > 2) {
      let best = 0;
      let bd = Infinity;
      path.forEach((p, i) => {
        const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
        if (d < bd) { bd = d; best = i; }
      });
      setCornerFs((c) => [...c, cum[best] / cum[cum.length - 1]].sort((a, b) => a - b));
    }
  };

  const save = async () => {
    const L = Number(length);
    if (!name.trim()) return setErr('Informe o nome do traçado.');
    if (ctrl.length < 3) return setErr('Adicione ao menos 3 pontos para formar um circuito.');
    if (!(L >= 200 && L <= 5000)) return setErr('Informe o comprimento real da pista entre 200 e 5000 m (usado para escalar o desenho).');
    const plen = cum[cum.length - 1];
    const k = L / plen;
    const pts = path.map((p) => ({ x: p.x * k, y: (EH - p.y) * k }));
    const segs: Segment[] = cornerFs.map((f, i) => ({
      id: `c${i + 1}`,
      name: `Curva ${i + 1}`,
      kind: 'corner',
      start: Math.max(0, f - 0.025),
      end: Math.min(1, f + 0.025),
      apex: f,
      source: 'manual',
    }));
    const t: TrackDef = { ...editing!, name: name.trim(), points: pts, length: L, segments: segs, updatedAt: Date.now() };
    await saveTrack(t);
    toast('Traçado esquemático salvo.');
    setEditing(null);
    reload();
  };

  const link = async (t: TrackDef, applySegments: boolean) => {
    if (!active) return;
    let segments = active.segments;
    if (applySegments && t.segments.length) {
      // Preenche os intervalos entre curvas com retas, mantendo uma partição completa da volta.
      const out: Segment[] = [];
      let cur = 0;
      t.segments.forEach((g, i) => {
        if (g.start - cur > 0.01) out.push({ id: `s${i}`, name: i === 0 ? 'Largada → C1' : `C${i} → C${i + 1}`, kind: 'straight', start: cur, end: g.start, source: 'manual' });
        out.push({ ...g, start: Math.max(cur, g.start) });
        cur = g.end;
      });
      if (cur < 0.99) out.push({ id: 'sEnd', name: `C${t.segments.length} → Chegada`, kind: 'straight', start: cur, end: 1, source: 'manual' });
      segments = out;
    }
    await updateSession({ ...active, trackId: t.id, segments }, { rebuild: applySegments, keepSegments: true });
    toast(applySegments ? 'Traçado vinculado e curvas aplicadas como segmentos.' : 'Traçado vinculado à sessão.');
  };

  if (editing) {
    return (
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <Panel bodyClass="space-y-3">
          <Tabs value={mode} onChange={setMode} items={[{ id: 'points', label: '1. Desenhar contorno' }, { id: 'corners', label: '2. Numerar curvas' }]} />
          <svg viewBox={`0 0 ${EW} ${EH}`} className="grid-bg w-full cursor-crosshair rounded-lg border border-ink-600 bg-ink-950" onClick={click} role="img" aria-label="Área de desenho do traçado esquemático">
            {pathD && <path d={pathD} fill="none" stroke="#323844" strokeWidth={22} strokeLinejoin="round" />}
            {pathD && <path d={pathD} fill="none" stroke="#9AA3B2" strokeWidth={3} strokeDasharray="10 6" />}
            {ctrl.map((p, i) => (
              <g key={i}>
                <circle cx={p.x} cy={p.y} r={6} fill={i === 0 ? '#C6F432' : '#4DA3FF'} />
                <text x={p.x + 9} y={p.y - 8} fontSize={12} fill="#6B7382">{i + 1}</text>
              </g>
            ))}
            {path.length > 2 && cornerFs.map((f, i) => {
              const idx = cum.findIndex((c) => c >= f * cum[cum.length - 1]);
              const p = path[Math.max(0, idx)];
              return (
                <g key={i}>
                  <circle cx={p.x} cy={p.y} r={13} fill="#14171C" stroke="#FFB547" strokeWidth={2} />
                  <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize={12} fontWeight={700} fill="#F2F4F7">{i + 1}</text>
                </g>
              );
            })}
          </svg>
          <p className="text-xs text-fg-dim">
            {mode === 'points'
              ? 'Clique para adicionar pontos no sentido de circulação. O primeiro ponto (verde) é a linha de chegada. O contorno é suavizado e fechado automaticamente.'
              : 'Clique sobre o traçado para marcar cada curva, na ordem em que aparecem a partir da linha de chegada.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary btn-sm" onClick={() => (mode === 'points' ? setCtrl((c) => c.slice(0, -1)) : setCornerFs((c) => c.slice(0, -1)))}><Undo2 className="h-3.5 w-3.5" /> Desfazer</button>
            <button className="btn-ghost btn-sm" onClick={() => (mode === 'points' ? (setCtrl([]), setCornerFs([])) : setCornerFs([]))}><Eraser className="h-3.5 w-3.5" /> Limpar</button>
          </div>
        </Panel>
        <Panel title="Dados do traçado">
          <div className="space-y-3">
            <Field label="Nome">{(id) => <input id={id} className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />}</Field>
            <Field label="Comprimento real (m)" hint="Usado para escalar o desenho. O formato continua esquemático.">{(id) => <input id={id} type="number" className="input" value={length} onChange={(e) => setLength(e.target.value)} />}</Field>
            <p className="text-sm text-fg-muted">{ctrl.length} pontos · {cornerFs.length} curvas</p>
            {err && <Notice tone="error">{err}</Notice>}
            <div className="flex gap-2">
              <button className="btn-secondary" onClick={() => setEditing(null)}>Cancelar</button>
              <button className="btn-primary" onClick={save}><Save className="h-4 w-4" /> Salvar</button>
            </div>
            <Notice tone="warn">Traçados desenhados à mão são esquemáticos. Não os use como mapa real da pista.</Notice>
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-fg-muted">Sem GPS, desenhe um traçado simplificado com as curvas numeradas para acompanhar a posição na volta e organizar os segmentos.</p>
        <button className="btn-primary" onClick={() => start()}><PenLine className="h-4 w-4" /> Novo traçado</button>
      </div>
      {!tracks.length ? (
        <Panel><p className="text-sm text-fg-muted">Nenhum traçado esquemático salvo.</p></Panel>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {tracks.map((t) => (
            <Panel key={t.id} title={t.name} actions={active?.trackId === t.id && <span className="chip border-gain/40 text-gain">vinculado</span>}>
              <TrackMap points={t.points} schematic height={180} labels={t.segments.map((g, i) => ({ fraction: g.apex ?? g.start, text: String(i + 1) }))} />
              <p className="mt-2 text-xs text-fg-dim">{t.length} m · {t.segments.length} curvas · esquemático</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="btn-secondary btn-sm" onClick={() => start(t)}><PenLine className="h-3.5 w-3.5" /> Editar</button>
                {active && (
                  <>
                    <button className="btn-secondary btn-sm" onClick={() => link(t, false)}><Link2 className="h-3.5 w-3.5" /> Vincular à sessão</button>
                    {t.segments.length > 0 && <button className="btn-ghost btn-sm" onClick={() => link(t, true)}>Usar curvas como segmentos</button>}
                  </>
                )}
                <button className="btn-danger btn-sm" onClick={async () => {
                  if (await confirm({ title: 'Excluir traçado?', message: `“${t.name}” será removido.`, danger: true, confirmLabel: 'Excluir' })) {
                    await deleteTrack(t.id);
                    reload();
                  }
                }}><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
