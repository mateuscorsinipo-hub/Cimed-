import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CheckCircle2, FileSpreadsheet, FileUp, FlaskConical, Play } from 'lucide-react';
import { PageHeader } from '@/components/app/shared';
import { LapDetectionPanel, LapsTable } from '@/components/app/LapDetectionPanel';
import { TrackMap } from '@/components/charts/TrackMap';
import { cn, Field, KindTag, Notice, Panel, Spinner, useUi } from '@/components/ui';
import { useApp } from '@/state/AppState';
import { readTextFile, sniffBinary, CHANNEL_LABELS, CHANNEL_ORDER, columnStats, defaultUnitFor, MAX_FILE_BYTES, UNIT_OPTIONS, type ColumnMapping } from '@/lib/telemetry-parser';
import { parseFile, processTable, type ParseResult, type ProcessResult } from '@/lib/analysis/worker-client';
import { buildSession, type LapDetectionResult } from '@/lib/analysis/pipeline';
import { fastestLap } from '@/lib/telemetry-metrics';
import { listTracks } from '@/lib/session-storage';
import { fmtBytes, fmtLapTime } from '@/lib/format';
import type { ChannelKey, Session, TrackDef } from '@/lib/types';

const STEPS = ['Importar arquivo', 'Identificar colunas', 'Pista', 'Voltas', 'Referência', 'Executar', 'Relatório'];

interface FileInfo {
  name: string;
  size: number;
}

export default function NewAnalysis() {
  const { addSession, sessions } = useApp();
  const { toast } = useUi();
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<FileInfo | null>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [processed, setProcessed] = useState<ProcessResult | null>(null);
  const [detection, setDetection] = useState<LapDetectionResult | null>(null);
  const [sessionName, setSessionName] = useState('');
  const [trackName, setTrackName] = useState('');
  const [trackId, setTrackId] = useState('');
  const [tracks, setTracks] = useState<TrackDef[]>([]);
  const [refLap, setRefLap] = useState<number | null>(null);
  const [result, setResult] = useState<Session | null>(null);
  const [drag, setDrag] = useState(false);
  const [pasted, setPasted] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listTracks().then(setTracks).catch(() => setTracks([]));
  }, []);

  const trackNames = useMemo(() => [...new Set([...sessions.map((s) => s.trackName), ...tracks.map((t) => t.name)].filter(Boolean))], [sessions, tracks]);

  const loadText = async (name: string, size: number, text: string) => {
    setError(null);
    setBusy('Lendo e interpretando o arquivo…');
    try {
      const r = await parseFile(name, text);
      setFile({ name, size });
      setParsed(r);
      setMapping(r.mapping);
      setProcessed(null);
      setDetection(null);
      setResult(null);
      setSessionName(name.replace(/\.[^.]+$/, ''));
      setStep(1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_FILE_BYTES) {
      setError(`Arquivo de ${fmtBytes(f.size)} excede o limite de ${fmtBytes(MAX_FILE_BYTES)}. Exporte um trecho menor da sessão.`);
      return;
    }
    if (f.size === 0) {
      setError('O arquivo está vazio.');
      return;
    }
    const binary = await sniffBinary(f);
    if (binary) {
      setError(binary);
      return;
    }
    try {
      await loadText(f.name, f.size, await readTextFile(f));
    } catch (e) {
      setError(`Não foi possível ler o arquivo: ${(e as Error).message}`);
    }
  };

  const useExample = async () => {
    const { generateDemoCsv } = await import('@/lib/demo/demo-data');
    const csv = generateDemoCsv();
    await loadText('exemplo-sintetico.csv', csv.length, csv);
  };

  const mappingIssues = useMemo(() => {
    const issues: string[] = [];
    if (!mapping.time) issues.push('Selecione a coluna de timestamp.');
    const cols = Object.values(mapping).filter(Boolean).map((m) => m!.column);
    if (new Set(cols).size !== cols.length) issues.push('Uma mesma coluna foi atribuída a mais de um canal.');
    if (!!mapping.lat !== !!mapping.lon) issues.push('Latitude e longitude devem ser mapeadas juntas.');
    if (!mapping.speed && !mapping.distance && !mapping.lat) issues.push('Mapeie ao menos velocidade, distância ou GPS.');
    return issues;
  }, [mapping]);

  const validate = async () => {
    if (!parsed) return;
    setError(null);
    setBusy('Validando valores, convertendo unidades e filtrando o GPS…');
    try {
      const r = await processTable(parsed.table, mapping, { method: 'auto' });
      setProcessed(r);
      setDetection(r.detection);
    } catch (e) {
      setProcessed(null);
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const execute = async () => {
    if (!processed || !detection || !file || !parsed) return;
    setBusy('Executando análise…');
    setError(null);
    try {
      await new Promise((r) => setTimeout(r, 30));
      const s = buildSession({
        name: sessionName,
        trackName,
        fileName: file.name,
        fileSize: file.size,
        format: parsed.format,
        normalized: processed.normalized,
        prepared: processed.prepared,
        laps: detection.laps,
        lapSource: detection.source ?? 'manual',
        gate: detection.gate,
        referenceLap: refLap,
      });
      const withTrack = trackId ? { ...s, trackId } : s;
      await addSession(withTrack);
      setResult(withTrack);
      setStep(6);
      toast('Sessão analisada e salva neste dispositivo.');
    } catch (e) {
      setError(`Falha ao salvar a sessão: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const includedLaps = detection?.laps.filter((l) => l.included) ?? [];
  const canNext = [
    !!parsed,
    !!processed && !processed.normalized.report.errors.length && !mappingIssues.length,
    sessionName.trim().length > 0,
    includedLaps.length >= 1,
    refLap !== null,
    !!result,
    true,
  ][step];

  const goNext = () => {
    if (step === 3 && detection) {
      const best = fastestLap(detection.laps);
      if (refLap === null || !includedLaps.some((l) => l.number === refLap)) setRefLap(best?.number ?? null);
    }
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  return (
    <>
      <PageHeader eyebrow="Nova análise" title="Importar e analisar telemetria" subtitle="Processamento local: o arquivo não sai deste navegador." />
      <ol className="mb-6 flex gap-1 overflow-x-auto pb-1" aria-label="Etapas">
        {STEPS.map((s, i) => (
          <li key={s} className="min-w-[110px] flex-1">
            <div className={cn('h-1 rounded-full', i < step ? 'bg-gain' : i === step ? 'bg-gain/60' : 'bg-ink-600')} />
            <div className={cn('mt-1.5 text-[11px] font-semibold', i === step ? 'text-fg' : 'text-fg-dim')} aria-current={i === step ? 'step' : undefined}>
              {i + 1}. {s}
            </div>
          </li>
        ))}
      </ol>

      {error && (
        <div className="mb-4">
          <Notice tone="error" title="Não foi possível continuar">{error}</Notice>
        </div>
      )}
      {busy && (
        <div className="mb-4">
          <Spinner label={busy} />
        </div>
      )}

      {step === 0 && (
        <Panel title="1. Importar arquivo">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e: DragEvent) => {
              e.preventDefault();
              setDrag(false);
              onFile(e.dataTransfer.files[0]);
            }}
            className={cn('grid-bg flex flex-col items-center rounded-lg border-2 border-dashed px-6 py-14 text-center transition-colors', drag ? 'border-gain bg-gain/5' : 'border-ink-500')}
          >
            <FileUp className="h-8 w-8 text-gain" aria-hidden />
            <p className="mt-4 text-lg font-semibold">Arraste o arquivo de telemetria aqui</p>
            <p className="mt-1 text-sm text-fg-muted">CSV/TXT/TSV delimitado ou GPX · até {fmtBytes(MAX_FILE_BYTES)}</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <button className="btn-primary" onClick={() => inputRef.current?.click()} disabled={!!busy}>
                <FileSpreadsheet className="h-4 w-4" /> Selecionar arquivo
              </button>
              <button className="btn-secondary" onClick={useExample} disabled={!!busy}>
                <FlaskConical className="h-4 w-4" /> Usar arquivo de exemplo (sintético)
              </button>
            </div>
            <input ref={inputRef} type="file" className="hidden" onChange={(e) => { onFile(e.target.files?.[0] ?? undefined); e.target.value = ''; }} />
          </div>
          <div className="mt-5 rounded-lg border border-ink-600 p-4">
            <label htmlFor="paste-csv" className="font-semibold">Não consegue selecionar o arquivo?</label>
            <p className="mt-1 text-sm text-fg-muted">Abra o CSV em qualquer editor de texto, copie tudo e cole aqui. Funciona inclusive dentro de aplicativos que bloqueiam o envio de arquivos.</p>
            <textarea id="paste-csv" rows={5} className="input mt-3 font-mono text-xs" placeholder={'Time;Speed;Latitude;Longitude\n0,00;45,2;-23,70123;-46,69876\n…'} value={pasted} onChange={(e) => setPasted(e.target.value)} />
            <button className="btn-secondary mt-2" disabled={!pasted.trim() || !!busy} onClick={() => loadText('dados-colados.csv', pasted.length, pasted)}>
              Analisar texto colado
            </button>
          </div>
          <div className="mt-5 grid gap-3 text-sm text-fg-muted md:grid-cols-3">
            <div className="rounded-lg border border-ink-600 p-4">
              <div className="mb-1 font-semibold text-fg">Campos reconhecidos</div>
              Timestamp, distância, latitude/longitude, velocidade, acelerações, RPM, acelerador, freio, direção e volta. Todos opcionais, exceto o tempo.
            </div>
            <div className="rounded-lg border border-ink-600 p-4">
              <div className="mb-1 font-semibold text-fg">Formatos de CSV</div>
              Separadores vírgula, ponto e vírgula, tabulação ou barra; vírgula decimal; metadados antes do cabeçalho e linha de unidades.
            </div>
            <div className="rounded-lg border border-ink-600 p-4">
              <div className="mb-1 font-semibold text-fg">O que não fazemos</div>
              Não inferimos acelerador, freio ou volante a partir de velocidade ou GPS. Só analisamos o que o arquivo contém.
            </div>
          </div>
        </Panel>
      )}

      {step === 1 && parsed && (
        <ColumnStep parsed={parsed} mapping={mapping} setMapping={(m) => { setMapping(m); setProcessed(null); }} issues={mappingIssues} processed={processed} onValidate={validate} busy={!!busy} file={file!} />
      )}

      {step === 2 && processed && (
        <Panel title="3. Pista e identificação">
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-4">
              <Field label="Nome da sessão" error={sessionName.trim() ? null : 'Informe um nome.'}>
                {(id) => <input id={id} className="input" value={sessionName} maxLength={120} onChange={(e) => setSessionName(e.target.value)} />}
              </Field>
              <Field label="Nome da pista" hint="Texto livre para organizar o histórico. Não carregamos mapas de pistas reais.">
                {(id) => (
                  <>
                    <input id={id} className="input" list="track-names" value={trackName} maxLength={120} onChange={(e) => setTrackName(e.target.value)} placeholder="ex.: Kartódromo do clube" />
                    <datalist id="track-names">
                      {trackNames.map((t) => <option key={t} value={t} />)}
                    </datalist>
                  </>
                )}
              </Field>
              {!processed.prepared.xy && (
                <Field label="Traçado esquemático (opcional)" hint="Sem GPS, use um traçado desenhado manualmente em “Traçado” para visualizar a posição na volta.">
                  {(id) => (
                    <select id={id} className="input" value={trackId} onChange={(e) => setTrackId(e.target.value)}>
                      <option value="">Nenhum — criar depois</option>
                      {tracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  )}
                </Field>
              )}
            </div>
            <div>
              {processed.prepared.xy ? (
                <>
                  <div className="mb-2 flex items-center gap-2 text-sm text-fg-muted"><KindTag kind="measured" /> Trajetória reconstruída a partir do GPS do arquivo</div>
                  <TrackMap points={processed.prepared.xy.x.filter((_, i) => i % 3 === 0).map((x, i) => ({ x, y: processed.prepared.xy!.y[i * 3] }))} height={280} />
                </>
              ) : (
                <Notice tone="info" title="Sem coordenadas GPS">
                  O mapa real não pode ser reconstruído. As análises por distância e velocidade continuam disponíveis; para visualizar, crie um traçado esquemático depois.
                </Notice>
              )}
            </div>
          </div>
        </Panel>
      )}

      {step === 3 && processed && detection && (
        <Panel title="4. Detectar ou marcar voltas">
          <LapDetectionPanel prepared={processed.prepared} value={detection} onChange={setDetection} />
        </Panel>
      )}

      {step === 4 && detection && (
        <Panel title="5. Volta de referência">
          <p className="mb-3 text-sm text-fg-muted">A referência é a volta com a qual as demais serão comparadas. Por padrão, a mais rápida entre as válidas.</p>
          <LapsTable laps={detection.laps} referenceLap={refLap} onReference={setRefLap} />
        </Panel>
      )}

      {step === 5 && processed && detection && (
        <Panel title="6. Executar a análise">
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['Sessão', sessionName],
              ['Pista', trackName || '—'],
              ['Voltas válidas', `${includedLaps.length} de ${detection.laps.length}`],
              ['Referência', refLap !== null ? `V${refLap} · ${fmtLapTime(detection.laps.find((l) => l.number === refLap)?.lapTime)}` : '—'],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-ink-600 p-3">
                <dt className="label">{k}</dt>
                <dd className="mt-1 font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-sm text-fg-muted">Serão calculados: alinhamento das voltas por distância, segmentos (curvas e retas), tempos por segmento, velocidades, diferenças acumuladas, consistência e diagnósticos por regras.</p>
          <button className="btn-primary mt-5" onClick={execute} disabled={!!busy}>
            <Play className="h-4 w-4" /> Executar análise
          </button>
        </Panel>
      )}

      {step === 6 && result && (
        <Panel title="7. Análise concluída">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-6 w-6 text-gain" />
            <div>
              <p className="text-lg font-semibold">{result.name}</p>
              <p className="text-sm text-fg-muted">
                Melhor volta {fmtLapTime(result.summary.bestLapTime)} · {result.summary.validLapCount} voltas válidas · {result.segments.length} segmentos identificados.
              </p>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <button className="btn-primary" onClick={() => nav(`/app/relatorios/${result.id}`)}>Abrir relatório</button>
            <Link to="/app/comparar" className="btn-secondary">Comparar voltas</Link>
            <Link to="/app/engenheiro" className="btn-secondary">Perguntar ao engenheiro</Link>
            <button className="btn-ghost" onClick={() => { setStep(0); setParsed(null); setResult(null); setFile(null); }}>Importar outro arquivo</button>
          </div>
        </Panel>
      )}

      {step > 0 && step < 6 && (
        <div className="mt-5 flex justify-between gap-3">
          <button className="btn-secondary" onClick={() => setStep((s) => s - 1)} disabled={!!busy}>
            <ArrowLeft className="h-4 w-4" /> Voltar
          </button>
          {step < 5 && (
            <button className="btn-primary" onClick={goNext} disabled={!canNext || !!busy}>
              Continuar <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
    </>
  );
}

function ColumnStep({ parsed, mapping, setMapping, issues, processed, onValidate, busy, file }: {
  parsed: ParseResult; mapping: ColumnMapping; setMapping: (m: ColumnMapping) => void; issues: string[]; processed: ProcessResult | null; onValidate: () => void; busy: boolean; file: FileInfo;
}) {
  const t = parsed.table;
  const stats = useMemo(() => t.headers.map((_, i) => columnStats(t, i)), [t]);
  const used = new Set(Object.values(mapping).map((m) => m!.column));
  const setChannel = (ch: ChannelKey, col: string) => {
    const next = { ...mapping };
    if (col === '') delete next[ch];
    else next[ch] = defaultUnitFor(ch, t, Number(col));
    setMapping(next);
  };
  const setUnit = (ch: ChannelKey, unit: string) => setMapping({ ...mapping, [ch]: { ...mapping[ch]!, unit, unitInferred: false } });
  const rep = processed?.normalized.report;

  return (
    <div className="space-y-5">
      <Panel title="2. Identificar colunas e unidades">
        <p className="mb-4 text-sm text-fg-muted">
          {file.name} · {fmtBytes(file.size)} · {parsed.format.toUpperCase()} · {t.rows.length.toLocaleString('pt-BR')} linhas · {t.headers.length} colunas
          {parsed.format === 'csv' && ` · separador “${t.delimiter === '\t' ? 'tab' : t.delimiter}”${t.decimalComma ? ' · vírgula decimal' : ''}`}
          {t.preamble.length > 0 && ` · ${t.preamble.length} linha(s) de metadados ignoradas`}
        </p>
        <div className="overflow-x-auto rounded-lg border border-ink-600">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-ink-900">
              <tr className="text-left">
                {['Canal', 'Coluna do arquivo', 'Unidade', 'Amostra', 'Faixa'].map((h) => <th key={h} className="label px-3 py-2 font-semibold">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {CHANNEL_ORDER.map((ch) => {
                const m = mapping[ch];
                const st = m ? stats[m.column] : null;
                return (
                  <tr key={ch} className="border-t border-ink-700">
                    <td className="px-3 py-2 font-medium">
                      {CHANNEL_LABELS[ch]}
                      {ch === 'time' && <span className="ml-1 text-loss">*</span>}
                    </td>
                    <td className="px-3 py-2">
                      <select className="input !py-1.5" value={m?.column ?? ''} onChange={(e) => setChannel(ch, e.target.value)} aria-label={`Coluna para ${CHANNEL_LABELS[ch]}`}>
                        <option value="">— não disponível —</option>
                        {t.headers.map((h, i) => (
                          <option key={i} value={i} disabled={used.has(i) && m?.column !== i}>
                            {h}{t.units[i] ? ` [${t.units[i]}]` : ''}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      {m && (
                        <div className="flex items-center gap-2">
                          <select className="input !py-1.5" value={m.unit} onChange={(e) => setUnit(ch, e.target.value)} aria-label={`Unidade de ${CHANNEL_LABELS[ch]}`}>
                            {UNIT_OPTIONS[ch].map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
                          </select>
                          {m.unitInferred && <span className="chip border-warn/40 text-warn" title="Unidade deduzida pela faixa de valores. Confirme.">confirme</span>}
                        </div>
                      )}
                    </td>
                    <td className="num max-w-[200px] truncate px-3 py-2 text-xs text-fg-muted">{st?.sample.slice(0, 3).join(' · ') ?? ''}</td>
                    <td className="num px-3 py-2 text-xs text-fg-muted">{st && st.min !== null ? `${+st.min.toFixed(3)} … ${+st.max!.toFixed(3)}` : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {t.headers.some((_, i) => !used.has(i)) && (
          <p className="mt-3 text-xs text-fg-dim">Colunas não utilizadas: {t.headers.filter((_, i) => !used.has(i)).join(', ')}</p>
        )}
        {issues.length > 0 && (
          <div className="mt-4">
            <Notice tone="warn">{issues.join(' ')}</Notice>
          </div>
        )}
        <button className="btn-primary mt-4" onClick={onValidate} disabled={busy || issues.length > 0}>
          Validar dados
        </button>
      </Panel>

      {rep && processed && (
        <Panel title="Resumo da validação">
          <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            {[
              ['Amostras válidas', `${rep.keptRows.toLocaleString('pt-BR')} de ${rep.rowCount.toLocaleString('pt-BR')}`],
              ['Taxa de amostragem', `${rep.sampleRate.toFixed(1)} Hz`],
              ['Duração', `${Math.floor(rep.duration / 60)} min ${Math.round(rep.duration % 60)} s`],
              ['Timestamps duplicados', String(rep.duplicateTimestamps)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-ink-600 p-3">
                <dt className="label">{k}</dt>
                <dd className="num mt-1 font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            {(Object.keys(processed.prepared.channels) as ChannelKey[]).filter((k) => processed.prepared.channels[k]).map((k) => (
              <span key={k} className="chip border-ink-500 text-fg-muted">
                {CHANNEL_LABELS[k]} · <span className={processed.prepared.origins[k] === 'derived' ? 'text-data' : 'text-gain'}>{processed.prepared.origins[k] === 'derived' ? 'derivado' : 'medido'}</span>
              </span>
            ))}
            {processed.prepared.xy && <span className="chip border-ink-500 text-fg-muted">Trajetória GPS · <span className="text-data">filtrada</span></span>}
          </div>
          <div className="mt-4 space-y-2">
            {rep.errors.map((e) => <Notice key={e} tone="error">{e}</Notice>)}
            {[...rep.warnings, ...processed.prepared.warnings].map((w) => <Notice key={w} tone="warn">{w}</Notice>)}
            {!rep.errors.length && <Notice tone="ok">Dados validados. Continue para identificar a pista.</Notice>}
          </div>
        </Panel>
      )}
    </div>
  );
}
