import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, ChevronLeft, ChevronRight, Film, Link2, Pause, Play, Plus, Rewind, FastForward, Trash2, Unlink } from 'lucide-react';
import { PageHeader, WithSession } from '@/components/app/shared';
import { LineChart } from '@/components/charts/LineChart';
import { TrackMap } from '@/components/charts/TrackMap';
import { cn, Field, KindTag, Notice, Panel, useUi } from '@/components/ui';
import { useAnalysis, useApp } from '@/state/AppState';
import { captureFrame, fitSync, LARGE_VIDEO_BYTES, MARKER_LABELS, PLAYBACK_RATES, positionAtTime, telemetryToVideo, timeAtLapFraction, videoToTelemetry } from '@/lib/onboard-player';
import { frameAnalyzer } from '@/lib/onboard-player/vision';
import { uid } from '@/lib/analysis/pipeline';
import { downloadBlob } from '@/lib/report-generator';
import { fmtBytes, fmtClock, fmtLapTime } from '@/lib/format';
import { speedToDisplay, speedUnitLabel } from '@/lib/telemetry-parser/units';
import type { MarkerType, Session, VideoMarker, VideoState } from '@/lib/types';

export default function Onboard() {
  return <WithSession what="sincronizar vídeos com a telemetria">{(s) => <OnboardView session={s} />}</WithSession>;
}

const FRAME = 1 / 30;

function usePlayer() {
  const ref = useRef<HTMLVideoElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [file, setFile] = useState<{ name: string; size: number } | null>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  const load = (f: File) => {
    setError(null);
    if (!f.type.startsWith('video/') && !/\.(mp4|webm|mov|m4v|ogv)$/i.test(f.name)) {
      setError('Selecione um arquivo de vídeo (MP4, WebM ou MOV).');
      return;
    }
    if (url) URL.revokeObjectURL(url);
    setUrl(URL.createObjectURL(f));
    setFile({ name: f.name, size: f.size });
    setTime(0);
    setPlaying(false);
  };
  const seek = (t: number) => {
    const v = ref.current;
    if (!v) return;
    v.currentTime = Math.min(Math.max(0, t), v.duration || t);
    setTime(v.currentTime);
  };
  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) v.play().catch((e) => setError(`Não foi possível reproduzir: ${e.message}`));
    else v.pause();
  };
  const bind = {
    ref,
    src: url ?? undefined,
    onTimeUpdate: () => setTime(ref.current?.currentTime ?? 0),
    onLoadedMetadata: () => setDuration(ref.current?.duration ?? 0),
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onError: () => setError('O navegador não consegue decodificar este vídeo (codec não suportado). Converta para MP4 H.264 ou WebM.'),
    playsInline: true,
    preload: 'metadata' as const,
  };
  return { ref, url, file, time, duration, playing, rate, setRate: (r: number) => { setRate(r); if (ref.current) ref.current.playbackRate = r; }, error, load, seek, toggle, bind };
}

function Controls({ p, markers, onAddMarker }: { p: ReturnType<typeof usePlayer>; markers?: VideoMarker[]; onAddMarker?: () => void }) {
  return (
    <div className="space-y-2">
      <div className="relative">
        <input
          type="range"
          min={0}
          max={p.duration || 0}
          step={0.01}
          value={p.time}
          onChange={(e) => p.seek(Number(e.target.value))}
          className="w-full accent-[#C6F432]"
          aria-label="Posição do vídeo"
        />
        {markers && p.duration > 0 && (
          <div className="pointer-events-none absolute inset-x-0 -bottom-1 h-2">
            {markers.map((m) => (
              <span key={m.id} className="absolute h-2 w-0.5 bg-warn" style={{ left: `${(m.time / p.duration) * 100}%` }} />
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button className="btn-secondary btn-sm" onClick={() => p.seek(p.time - 5)} aria-label="Voltar 5 segundos"><Rewind className="h-4 w-4" /></button>
        <button className="btn-secondary btn-sm" onClick={() => p.seek(p.time - FRAME)} aria-label="Quadro anterior"><ChevronLeft className="h-4 w-4" /></button>
        <button className="btn-primary btn-sm min-w-[72px]" onClick={p.toggle} aria-label={p.playing ? 'Pausar' : 'Reproduzir'}>
          {p.playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        <button className="btn-secondary btn-sm" onClick={() => p.seek(p.time + FRAME)} aria-label="Próximo quadro"><ChevronRight className="h-4 w-4" /></button>
        <button className="btn-secondary btn-sm" onClick={() => p.seek(p.time + 5)} aria-label="Avançar 5 segundos"><FastForward className="h-4 w-4" /></button>
        <span className="num ml-1 text-xs text-fg-muted">{fmtClock(p.time)} / {fmtClock(p.duration)}</span>
        <select className="input ml-auto !w-auto !py-1 text-xs" value={p.rate} onChange={(e) => p.setRate(Number(e.target.value))} aria-label="Velocidade de reprodução">
          {PLAYBACK_RATES.map((r) => <option key={r} value={r}>{r}×</option>)}
        </select>
        {onAddMarker && <button className="btn-secondary btn-sm" onClick={onAddMarker}><Plus className="h-4 w-4" /> Marcador</button>}
      </div>
    </div>
  );
}

function OnboardView({ session }: { session: Session }) {
  const { updateSession, prefs } = useApp();
  const analysis = useAnalysis(session);
  const { toast, confirm } = useUi();
  const a = usePlayer();
  const b = usePlayer();
  const [state, setState] = useState<VideoState>(session.video ?? { fileName: '', fileSize: 0, markers: [], syncPoints: [] });
  const [mType, setMType] = useState<MarkerType>('apex');
  const [mLabel, setMLabel] = useState('');
  const [mNote, setMNote] = useState('');
  const [syncLap, setSyncLap] = useState<number>(session.referenceLap ?? session.laps[0]?.number ?? 1);
  const [showB, setShowB] = useState(false);
  const [lapB, setLapB] = useState<number | null>(null);
  const [lapBStart, setLapBStart] = useState<number | null>(null);

  useEffect(() => setState(session.video ?? { fileName: '', fileSize: 0, markers: [], syncPoints: [] }), [session.id]);

  const persist = useCallback(
    async (next: VideoState) => {
      setState(next);
      await updateSession({ ...session, video: next });
    },
    [session, updateSession],
  );

  const model = useMemo(() => fitSync(state.syncPoints), [state.syncPoints]);
  const telTime = model ? videoToTelemetry(model, a.time) : null;
  const pos = telTime !== null ? positionAtTime(session, telTime) : null;
  const trace = pos && analysis ? analysis.traces.get(pos.lap.number) : undefined;
  const unit = prefs.speedUnit;
  const mismatch = a.file && state.fileName && (a.file.name !== state.fileName || a.file.size !== state.fileSize);

  // Segunda gravação acompanha a primeira pela mesma fração de distância.
  useEffect(() => {
    if (!showB || !pos || !b.ref.current || lapB === null || lapBStart === null) return;
    const lap = session.laps.find((l) => l.number === lapB);
    if (!lap) return;
    const target = lapBStart + (timeAtLapFraction(session, lap, pos.fraction) - lap.startTime);
    if (Math.abs(b.ref.current.currentTime - target) > 0.2) b.seek(target);
    if (a.playing && b.ref.current.paused) b.ref.current.play().catch(() => undefined);
    if (!a.playing && !b.ref.current.paused) b.ref.current.pause();
  }, [a.time, a.playing, showB, pos, lapB, lapBStart, session, b]);

  useEffect(() => {
    if (b.ref.current) b.ref.current.playbackRate = a.rate;
  }, [a.rate, b.ref]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || !a.url) return;
      if (e.key === ' ') { e.preventDefault(); a.toggle(); }
      if (e.key === 'ArrowLeft') a.seek(a.time - (e.shiftKey ? 5 : 1));
      if (e.key === 'ArrowRight') a.seek(a.time + (e.shiftKey ? 5 : 1));
      if (e.key === ',') a.seek(a.time - FRAME);
      if (e.key === '.') a.seek(a.time + FRAME);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [a]);

  const loadA = (f?: File) => {
    if (!f) return;
    a.load(f);
    if (f.size > LARGE_VIDEO_BYTES) toast(`Vídeo grande (${fmtBytes(f.size)}). Em celulares, a reprodução pode travar; prefira um trecho menor.`, 'info');
    if (!state.fileName) persist({ ...state, fileName: f.name, fileSize: f.size });
  };

  const addMarker = () => {
    if (!a.url) return;
    const seg = pos ? session.segments.find((g) => pos.fraction >= g.start && pos.fraction <= g.end) : undefined;
    const m: VideoMarker = {
      id: uid(),
      time: a.time,
      type: mType,
      label: mLabel.trim() || `${MARKER_LABELS[mType]}${seg ? ` · ${seg.name}` : ''}`,
      note: mNote.trim() || undefined,
      lapFraction: pos?.fraction,
      segmentId: seg?.id,
    };
    persist({ ...state, fileName: a.file?.name ?? state.fileName, fileSize: a.file?.size ?? state.fileSize, markers: [...state.markers, m].sort((x, y) => x.time - y.time) });
    setMLabel('');
    setMNote('');
  };

  const addSyncAtLapStart = () => {
    const lap = session.laps.find((l) => l.number === syncLap);
    if (!lap || !a.url) return;
    persist({ ...state, fileName: a.file?.name ?? state.fileName, fileSize: a.file?.size ?? state.fileSize, syncPoints: [...state.syncPoints, { videoTime: a.time, telemetryTime: lap.startTime }] });
    toast(`Vídeo ${fmtClock(a.time)} vinculado à passagem que inicia a V${lap.number}.`);
  };

  const seekToFraction = (f: number) => {
    if (!model || !pos) return;
    a.seek(telemetryToVideo(model, timeAtLapFraction(session, pos.lap, f)));
  };

  const mapPts = trace?.x ? trace.x.map((x, i) => ({ x, y: trace.y![i] })) : null;

  return (
    <>
      <PageHeader eyebrow="Vídeos onboard" title="Onboard e sincronização" subtitle="O vídeo é reproduzido a partir do arquivo local e não é enviado a nenhum serviço. Marcadores e sincronização ficam salvos na sessão." />
      <div className="grid gap-4 xl:grid-cols-[1.25fr_1fr]">
        <div className="space-y-4">
          <Panel
            title="Gravação principal"
            actions={a.url && (
              <button className="btn-ghost btn-sm" onClick={async () => {
                try { downloadBlob(await captureFrame(a.ref.current!), `quadro-${a.time.toFixed(2)}s.png`); } catch (e) { toast((e as Error).message, 'error'); }
              }}><Camera className="h-4 w-4" /> Capturar quadro</button>
            )}
          >
            {!a.url ? (
              <label className="grid-bg flex cursor-pointer flex-col items-center rounded-lg border-2 border-dashed border-ink-500 px-6 py-14 text-center hover:border-gain/60">
                <Film className="h-8 w-8 text-gain" />
                <span className="mt-3 font-semibold">Selecionar vídeo onboard</span>
                <span className="mt-1 text-sm text-fg-muted">MP4 (H.264), WebM ou MOV compatível com o navegador</span>
                {state.fileName && <span className="mt-3 text-xs text-fg-dim">Última gravação usada nesta sessão: {state.fileName} ({fmtBytes(state.fileSize)})</span>}
                <input type="file" accept="video/*" className="hidden" onChange={(e) => loadA(e.target.files?.[0])} />
              </label>
            ) : (
              <>
                <video {...a.bind} className="aspect-video w-full rounded-lg bg-black" onClick={a.toggle} />
                <div className="mt-3">
                  <Controls p={a} markers={state.markers} onAddMarker={addMarker} />
                </div>
                <p className="mt-2 text-[11px] text-fg-dim">Atalhos: espaço reproduz/pausa · ← → 1 s (Shift: 5 s) · , . quadro a quadro (aprox. 1/30 s).</p>
              </>
            )}
            {a.error && <div className="mt-3"><Notice tone="error">{a.error}</Notice></div>}
            {mismatch && <div className="mt-3"><Notice tone="warn">Este arquivo difere do usado anteriormente ({state.fileName}). Marcadores e sincronização podem não corresponder.</Notice></div>}
          </Panel>

          {a.url && (
            <Panel title="Sincronização com a telemetria">
              <p className="mb-3 text-sm text-fg-muted">
                Pause o vídeo no instante exato em que o kart cruza a linha de chegada e vincule à volta correspondente. Com dois ou mais pontos, a diferença de relógio da câmera também é corrigida.
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Volta que começa neste quadro">
                  {(id) => (
                    <select id={id} className="input !w-auto" value={syncLap} onChange={(e) => setSyncLap(Number(e.target.value))}>
                      {session.laps.map((l) => <option key={l.number} value={l.number}>V{l.number} · {fmtLapTime(l.lapTime)}</option>)}
                    </select>
                  )}
                </Field>
                <button className="btn-primary" onClick={addSyncAtLapStart}><Link2 className="h-4 w-4" /> Vincular em {fmtClock(a.time)}</button>
              </div>
              {state.syncPoints.length > 0 && (
                <ul className="mt-3 space-y-1.5 text-sm">
                  {state.syncPoints.map((p, i) => (
                    <li key={i} className="flex items-center justify-between rounded-md bg-ink-900 px-3 py-1.5">
                      <span className="num">vídeo {fmtClock(p.videoTime)} ↔ telemetria {p.telemetryTime.toFixed(2)} s</span>
                      <button className="btn-ghost btn-sm" aria-label="Remover ponto" onClick={() => persist({ ...state, syncPoints: state.syncPoints.filter((_, j) => j !== i) })}><Unlink className="h-3.5 w-3.5" /></button>
                    </li>
                  ))}
                </ul>
              )}
              {model && (
                <p className="mt-2 text-xs text-fg-dim">
                  Modelo: telemetria = {model.rate.toFixed(4)} × vídeo {model.offset >= 0 ? '+' : '−'} {Math.abs(model.offset).toFixed(2)} s ({model.points} ponto{model.points > 1 ? 's' : ''}). Sincronização manual: a precisão depende de quão exato foi o quadro escolhido.
                </p>
              )}
            </Panel>
          )}

          <Panel title="Comparar com segunda gravação" actions={<button className="btn-ghost btn-sm" onClick={() => setShowB((s) => !s)}>{showB ? 'Ocultar' : 'Mostrar'}</button>}>
            {!showB ? (
              <p className="text-sm text-fg-muted">Coloque outra gravação lado a lado. Ela acompanha a principal pela mesma posição na volta (requer ambas sincronizadas).</p>
            ) : (
              <div className="space-y-3">
                {!b.url ? (
                  <label className="btn-secondary cursor-pointer"><Film className="h-4 w-4" /> Selecionar segunda gravação<input type="file" accept="video/*" className="hidden" onChange={(e) => e.target.files?.[0] && b.load(e.target.files[0])} /></label>
                ) : (
                  <>
                    <video {...b.bind} muted className="aspect-video w-full rounded-lg bg-black" />
                    <Controls p={b} />
                    <div className="flex flex-wrap items-end gap-2">
                      <Field label="Volta mostrada nesta gravação">
                        {(id) => (
                          <select id={id} className="input !w-auto" value={lapB ?? ''} onChange={(e) => setLapB(Number(e.target.value) || null)}>
                            <option value="">Selecione…</option>
                            {session.laps.map((l) => <option key={l.number} value={l.number}>V{l.number} · {fmtLapTime(l.lapTime)}</option>)}
                          </select>
                        )}
                      </Field>
                      <button className="btn-secondary" disabled={lapB === null} onClick={() => { setLapBStart(b.time); toast('Início da volta marcado na segunda gravação.'); }}>
                        <Link2 className="h-4 w-4" /> Este quadro = início da volta
                      </button>
                    </div>
                    <p className="text-xs text-fg-dim">
                      {lapBStart !== null ? `Vinculada: V${lapB} começa em ${fmtClock(lapBStart)}. ` : 'Pause no cruzamento da linha de chegada e vincule. '}
                      A segunda gravação usa os mesmos dados de telemetria desta sessão para alinhar por distância.
                    </p>
                    {b.error && <Notice tone="error">{b.error}</Notice>}
                  </>
                )}
              </div>
            )}
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Telemetria no instante do vídeo">
            {!model ? (
              <p className="text-sm text-fg-muted">Sem sincronização. Carregue o vídeo e vincule um ponto para ver velocidade, posição e segmento correspondentes.</p>
            ) : !pos ? (
              <Notice tone="info">O instante atual ({telTime?.toFixed(1)} s na telemetria) está fora das voltas detectadas.</Notice>
            ) : (
              <>
                <dl className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-ink-900 p-2"><dt className="label">Volta</dt><dd className="num mt-0.5 font-semibold">V{pos.lap.number}</dd></div>
                  <div className="rounded-lg bg-ink-900 p-2"><dt className="label">Na volta</dt><dd className="num mt-0.5 font-semibold">{pos.lapElapsed.toFixed(2)} s</dd></div>
                  <div className="rounded-lg bg-ink-900 p-2"><dt className="label">Distância</dt><dd className="num mt-0.5 font-semibold">{trace ? (pos.fraction * trace.distance).toFixed(0) : '—'} m</dd></div>
                </dl>
                {trace && (
                  <LineChart
                    className="mt-3"
                    height={150}
                    title={`Velocidade V${pos.lap.number}`}
                    unit={speedUnitLabel(unit)}
                    format={(v) => v.toFixed(0)}
                    series={[{ id: 'v', label: `V${pos.lap.number}`, color: '#C6F432', x: trace.frac.map((f) => f * trace.distance), y: trace.speed.map((v) => speedToDisplay(v, unit)) }]}
                    cursorX={pos.fraction * trace.distance}
                    onCursor={() => undefined}
                    bands={session.segments.filter((g) => g.kind === 'corner').map((g) => ({ x0: g.start * trace.distance, x1: g.end * trace.distance, color: 'rgba(77,163,255,0.06)', label: g.name.replace('Curva ', 'C') }))}
                  />
                )}
                {mapPts && (
                  <div className="mt-3">
                    <TrackMap points={mapPts} colorValues={trace?.speed} cursorFraction={pos.fraction} onPick={(f) => seekToFraction(f)} height={240} labels={session.segments.filter((g) => g.kind === 'corner').map((g) => ({ fraction: g.apex ?? g.start, text: g.name.replace('Curva ', '') }))} />
                    <p className="mt-1 text-[11px] text-fg-dim">Clique no mapa para levar o vídeo até aquele ponto desta volta.</p>
                  </div>
                )}
              </>
            )}
          </Panel>

          <Panel title={`Marcadores (${state.markers.length})`}>
            <div className="grid gap-2 sm:grid-cols-[auto_1fr]">
              <select className="input !w-auto" value={mType} onChange={(e) => setMType(e.target.value as MarkerType)} aria-label="Tipo de marcador">
                {(Object.keys(MARKER_LABELS) as MarkerType[]).map((t) => <option key={t} value={t}>{MARKER_LABELS[t]}</option>)}
              </select>
              <input className="input" placeholder="Rótulo (opcional)" value={mLabel} maxLength={80} onChange={(e) => setMLabel(e.target.value)} />
            </div>
            <textarea className="input mt-2" rows={2} placeholder="Nota sobre este ponto (opcional)" value={mNote} maxLength={500} onChange={(e) => setMNote(e.target.value)} />
            <button className="btn-secondary btn-sm mt-2" onClick={addMarker} disabled={!a.url}><Plus className="h-4 w-4" /> Marcar em {fmtClock(a.time)}</button>
            {!a.url && <p className="mt-1 text-xs text-fg-dim">Carregue o vídeo para criar marcadores.</p>}
            <ul className="mt-4 divide-y divide-ink-700">
              {state.markers.map((m) => (
                <li key={m.id} className="flex items-start gap-3 py-2.5">
                  <button className="num rounded bg-ink-700 px-2 py-1 text-xs hover:bg-ink-600" onClick={() => a.seek(m.time)} disabled={!a.url} title="Ir para este instante">{fmtClock(m.time)}</button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {m.label}
                      <span className={cn('chip border-ink-500 text-fg-muted')}>{MARKER_LABELS[m.type]}</span>
                      {m.lapFraction !== undefined && <KindTag kind="calculated" />}
                    </div>
                    {m.note && <p className="mt-0.5 text-xs text-fg-muted">{m.note}</p>}
                  </div>
                  <button className="btn-ghost btn-sm" aria-label="Excluir marcador" onClick={async () => {
                    if (await confirm({ title: 'Excluir marcador?', message: m.label, confirmLabel: 'Excluir', danger: true })) persist({ ...state, markers: state.markers.filter((x) => x.id !== m.id) });
                  }}><Trash2 className="h-3.5 w-3.5" /></button>
                </li>
              ))}
            </ul>
          </Panel>
          <Notice tone="info" title="Análise automática de vídeo">{frameAnalyzer.reason}</Notice>
        </div>
      </div>
    </>
  );
}

