import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Circle, Download, FileUp, FlaskConical, X } from 'lucide-react';
import { useAnalysis, useApp } from '@/state/AppState';
import { DiagnosticCard, PageHeader } from '@/components/app/shared';
import { cn, EmptyState, Kpi, Panel, Spinner, useUi } from '@/components/ui';
import { fmtDate, fmtLapTime, fmtPct, fmtSpeed } from '@/lib/format';
import { downloadBlob } from '@/lib/report-generator';
import type { Session } from '@/lib/types';

export async function downloadDemoCsv() {
  const { generateDemoCsv } = await import('@/lib/demo/demo-data');
  downloadBlob(new Blob([generateDemoCsv()], { type: 'text/csv' }), 'kart-engineer-exemplo-sintetico.csv');
}

function Onboarding() {
  const { prefs, setPrefs, sessions, loadDemo } = useApp();
  const { toast } = useUi();
  if (prefs.onboardingDismissed) return null;
  const hasDemo = sessions.some((s) => s.isDemo);
  const hasReal = sessions.some((s) => !s.isDemo);
  const steps = [
    { done: hasDemo || hasReal, title: 'Explore a sessão demonstrativa', text: 'Dados sintéticos de uma pista fictícia, para conhecer as ferramentas.', action: <button className="btn-secondary btn-sm" onClick={() => loadDemo().then(() => toast('Sessão demonstrativa aberta.'))}><FlaskConical className="h-3.5 w-3.5" />Abrir demo</button> },
    { done: false, title: 'Veja o formato esperado', text: 'Baixe o CSV de exemplo e compare com o que o seu equipamento exporta.', action: <button className="btn-secondary btn-sm" onClick={downloadDemoCsv}><Download className="h-3.5 w-3.5" />CSV de exemplo</button> },
    { done: hasReal, title: 'Importe seus dados', text: 'CSV ou GPX. O assistente identifica colunas, unidades e voltas.', action: <Link to="/app/analise" className="btn-primary btn-sm"><FileUp className="h-3.5 w-3.5" />Importar</Link> },
    { done: false, title: 'Compare e gere o relatório', text: 'Escolha a referência, compare voltas e exporte o PDF.', action: <Link to="/app/comparar" className="btn-secondary btn-sm">Comparar</Link> },
  ];
  return (
    <Panel
      className="mb-6"
      title="Primeiros passos"
      actions={
        <button className="btn-ghost btn-sm" onClick={() => setPrefs({ onboardingDismissed: true })} aria-label="Ocultar primeiros passos">
          <X className="h-4 w-4" /> Ocultar
        </button>
      }
    >
      <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {steps.map((s, i) => (
          <li key={s.title} className="flex flex-col rounded-lg border border-ink-600 bg-ink-900 p-4">
            <div className="flex items-center gap-2 text-xs text-fg-dim">
              {s.done ? <CheckCircle2 className="h-4 w-4 text-gain" /> : <Circle className="h-4 w-4" />} Passo {i + 1}
            </div>
            <div className="mt-2 font-semibold">{s.title}</div>
            <p className="mt-1 flex-1 text-sm text-fg-muted">{s.text}</p>
            <div className="mt-3">{s.action}</div>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-xs text-fg-dim">Nunca usou telemetria? Comece pela demonstração: a tela “Comparar voltas” mostra a diferença de tempo acumulada ao longo da volta — subindo, a volta comparada está perdendo tempo; descendo, ganhando.</p>
    </Panel>
  );
}

function LapBars({ session }: { session: Session }) {
  const laps = session.laps;
  const valid = laps.filter((l) => l.included).map((l) => l.lapTime);
  if (!valid.length) return null;
  const min = Math.min(...valid);
  const max = Math.max(...laps.map((l) => l.lapTime));
  const lo = min - (max - min) * 0.15 - 0.2;
  return (
    <div className="flex h-44 items-end gap-1.5 overflow-x-auto pb-1" role="img" aria-label="Tempos de volta da sessão">
      {laps.map((l) => {
        const h = ((l.lapTime - lo) / (max - lo)) * 100;
        const best = l.number === session.summary.bestLapNumber;
        return (
          <div key={l.number} className="flex min-w-[28px] flex-1 flex-col items-center gap-1" title={`Volta ${l.number}: ${fmtLapTime(l.lapTime)}${l.included ? '' : ' (excluída)'}`}>
            <span className={cn('num text-[10px]', best ? 'text-gain' : 'text-fg-dim')}>{l.lapTime.toFixed(1)}</span>
            <div className={cn('w-full rounded-t', best ? 'bg-gain' : l.included ? 'bg-data/60' : 'bg-ink-600')} style={{ height: `${Math.max(4, h)}%` }} />
            <span className="num text-[10px] text-fg-muted">V{l.number}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function Overview() {
  const { ready, sessions, active, prefs, loadDemo, openSession } = useApp();
  const analysis = useAnalysis(active);
  if (!ready) return <Spinner />;

  if (!sessions.length) {
    return (
      <>
        <PageHeader eyebrow="Visão geral" title="Bem-vindo ao Kart Engineer AI" subtitle="Nenhuma sessão salva neste dispositivo ainda." />
        <Onboarding />
        <EmptyState
          icon={<FileUp className="h-6 w-6" />}
          title="Importe sua primeira telemetria"
          actions={
            <>
              <Link to="/app/analise" className="btn-primary">
                <FileUp className="h-4 w-4" /> Importar telemetria
              </Link>
              <button className="btn-secondary" onClick={() => loadDemo()}>
                <FlaskConical className="h-4 w-4" /> Explorar demonstração
              </button>
            </>
          }
        >
          Os indicadores deste painel são calculados a partir dos seus dados. Sem sessões importadas, não exibimos números.
        </EmptyState>
      </>
    );
  }

  const s = active?.summary;
  const opps = analysis?.diagnostics.filter((d) => d.tone === 'loss').slice(0, 3) ?? [];
  const last = sessions[0];

  return (
    <>
      <PageHeader
        eyebrow="Visão geral"
        title={active ? active.name : 'Selecione uma sessão'}
        subtitle={active ? `${active.trackName || 'Pista não informada'} · ${fmtDate(active.createdAt)} · ${active.source.fileName}` : undefined}
        actions={
          active && (
            <>
              <Link to={`/app/sessoes/${active.id}`} className="btn-secondary">Detalhes da sessão</Link>
              <Link to={`/app/relatorios/${active.id}`} className="btn-primary">Relatório</Link>
            </>
          )
        }
      />
      <Onboarding />
      {active && s ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Kpi label="Melhor volta" value={fmtLapTime(s.bestLapTime)} sub={s.bestLapNumber ? `Volta ${s.bestLapNumber} · medição` : undefined} tone="gain" />
            <Kpi label="Tempo médio" value={fmtLapTime(s.meanLapTime)} sub="Voltas válidas · cálculo" />
            <Kpi label="Voltas analisadas" value={`${s.validLapCount}/${s.lapCount}`} sub="Válidas / detectadas" />
            <Kpi label="Consistência" value={s.consistencyStd !== null ? `±${s.consistencyStd.toFixed(3)}` : '—'} sub={s.consistencyCv !== null ? `Desvio-padrão (s) · CV ${fmtPct(s.consistencyCv)}` : 'Requer 2+ voltas'} tone="data" />
            <Kpi
              label="Velocidade máxima"
              value={s.maxSpeed !== null ? fmtSpeed(s.maxSpeed, prefs.speedUnit, 1) : '—'}
              sub={s.maxSpeed === null ? 'Indisponível' : active.origins.speed === 'derived' ? 'Derivada do GPS · estimativa' : 'Medição'}
            />
            <Kpi label="Última sessão" value={<span className="text-base">{fmtDate(last.createdAt)}</span>} sub={<button className="link truncate" onClick={() => openSession(last.id)}>{last.name}</button>} />
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_1fr]">
            <Panel title="Tempos de volta" actions={<Link to="/app/comparar" className="btn-ghost btn-sm">Comparar <ArrowRight className="h-3.5 w-3.5" /></Link>}>
              <LapBars session={active} />
              <p className="mt-2 text-xs text-fg-dim">Verde: melhor volta. Cinza: voltas excluídas das estatísticas (volta de saída, box ou marcadas por você).</p>
            </Panel>
            <Panel title="Principais oportunidades" actions={<Link to="/app/engenheiro" className="btn-ghost btn-sm">Engenheiro <ArrowRight className="h-3.5 w-3.5" /></Link>}>
              {opps.length ? (
                <div className="space-y-3">
                  {opps.map((d) => (
                    <DiagnosticCard key={d.id} d={d} compact />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-fg-muted">Nenhum segmento com perda acima do limiar configurado ({prefs.deltaThreshold.toFixed(2)} s). Isso pode indicar voltas muito consistentes ou poucas voltas válidas.</p>
              )}
            </Panel>
          </div>
        </>
      ) : (
        <EmptyState title="Nenhuma sessão aberta">Selecione uma sessão no topo da página.</EmptyState>
      )}

      <Panel className="mt-6" title="Histórico de sessões" actions={<Link to="/app/sessoes" className="btn-ghost btn-sm">Gerenciar <ArrowRight className="h-3.5 w-3.5" /></Link>} bodyClass="!p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-ink-600 text-left">
                {['Sessão', 'Pista', 'Data', 'Melhor', 'Média', 'Voltas', ''].map((h) => (
                  <th key={h} className="label px-5 py-2.5 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sessions.slice(0, 8).map((m) => (
                <tr key={m.id} className={cn('border-b border-ink-700/60 last:border-0', m.id === active?.id && 'bg-ink-800/60')}>
                  <td className="px-5 py-2.5 font-medium">
                    {m.name} {m.isDemo && <span className="chip ml-1 border-warn/40 text-warn">demo</span>}
                  </td>
                  <td className="px-5 py-2.5 text-fg-muted">{m.trackName || '—'}</td>
                  <td className="px-5 py-2.5 text-fg-muted">{fmtDate(m.createdAt)}</td>
                  <td className="num px-5 py-2.5 text-gain">{fmtLapTime(m.summary.bestLapTime)}</td>
                  <td className="num px-5 py-2.5">{fmtLapTime(m.summary.meanLapTime)}</td>
                  <td className="num px-5 py-2.5">{m.summary.validLapCount}/{m.summary.lapCount}</td>
                  <td className="px-5 py-2.5 text-right">
                    <button className="btn-ghost btn-sm" onClick={() => openSession(m.id)} disabled={m.id === active?.id}>
                      {m.id === active?.id ? 'Aberta' : 'Abrir'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
