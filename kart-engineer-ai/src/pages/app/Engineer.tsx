import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Send, Sparkles } from 'lucide-react';
import { DiagnosticCard, PageHeader, WithSession } from '@/components/app/shared';
import { cn, KindTag, Notice, Panel } from '@/components/ui';
import { useAnalysis, useApp } from '@/state/AppState';
import { answer, SUGGESTED_QUESTIONS, type AnswerBlock, type EngineerAnswer } from '@/lib/engineer-assistant';
import { disabledProvider, openAICompatibleProvider, type ExplanationProvider } from '@/lib/engineer-assistant/llm-provider';
import { RULES } from '@/lib/diagnostics-engine';
import type { Session } from '@/lib/types';

export default function Engineer() {
  return <WithSession what="consultar o engenheiro virtual">{(s) => <EngineerView session={s} />}</WithSession>;
}

const BLOCK_TAG: Record<AnswerBlock['kind'], Parameters<typeof KindTag>[0]['kind'] | null> = {
  measurement: 'measured',
  estimate: 'estimated',
  calculation: 'calculated',
  hypothesis: 'hypothesis',
  recommendation: 'recommendation',
  unavailable: 'unavailable',
  text: null,
};

interface Entry {
  a: EngineerAnswer;
  llm?: { status: 'loading' | 'ok' | 'error'; text: string };
}

function EngineerView({ session }: { session: Session }) {
  const analysis = useAnalysis(session);
  const { sessions, prefs } = useApp();
  const [q, setQ] = useState('');
  const [log, setLog] = useState<Entry[]>([]);
  const [tab, setTab] = useState<'chat' | 'diag'>('chat');
  const [provider, setProvider] = useState<ExplanationProvider>(disabledProvider);
  const [providerOk, setProviderOk] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => setLog([]), [session.id]);
  useEffect(() => {
    if (!prefs.llm.enabled || !prefs.llm.endpoint) {
      setProvider(disabledProvider);
      setProviderOk(false);
      return;
    }
    const p = openAICompatibleProvider(prefs.llm.endpoint, prefs.llm.model);
    setProvider(p);
    const ctl = new AbortController();
    p.status(ctl.signal).then((s) => setProviderOk(s.available)).catch(() => setProviderOk(false));
    return () => ctl.abort();
  }, [prefs.llm]);
  useEffect(() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), [log.length]);

  if (!analysis) return null;

  const ask = (text: string) => {
    const t = text.trim();
    if (!t) return;
    const a = answer(t, { session, traces: analysis.traces, diagnostics: analysis.diagnostics, history: sessions, speedUnit: prefs.speedUnit });
    setLog((l) => [...l, { a }]);
    setQ('');
  };

  const explain = async (i: number) => {
    setLog((l) => l.map((e, j) => (j === i ? { ...e, llm: { status: 'loading', text: '' } } : e)));
    try {
      const text = await provider.explain(log[i].a);
      setLog((l) => l.map((e, j) => (j === i ? { ...e, llm: { status: 'ok', text } } : e)));
    } catch (e) {
      setLog((l) => l.map((x, j) => (j === i ? { ...x, llm: { status: 'error', text: (e as Error).message } } : x)));
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Engenheiro virtual"
        title="Pergunte sobre a sessão"
        subtitle="Respostas geradas por regras determinísticas sobre os dados calculados desta sessão. Nenhuma API externa é usada."
        actions={
          <div className="inline-flex rounded-lg border border-ink-600 bg-ink-900 p-1">
            {(['chat', 'diag'] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={cn('rounded-md px-3 py-1.5 text-xs font-semibold', tab === t ? 'bg-ink-600 text-fg' : 'text-fg-muted')}>
                {t === 'chat' ? 'Perguntas' : `Diagnósticos (${analysis.diagnostics.length})`}
              </button>
            ))}
          </div>
        }
      />
      {tab === 'diag' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {analysis.diagnostics.map((d) => <DiagnosticCard key={d.id} d={d} />)}
          {!analysis.diagnostics.length && <Notice tone="info">Nenhum diagnóstico gerado. São necessárias ao menos duas voltas válidas.</Notice>}
          <Panel title="Regras do motor" className="lg:col-span-2">
            <ul className="grid gap-3 text-sm md:grid-cols-2">
              {Object.entries(RULES).map(([id, r]) => (
                <li key={id}>
                  <div className="font-semibold">{r.name}</div>
                  <div className="text-fg-muted">{r.condition}</div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
          <Panel bodyClass="flex min-h-[60vh] flex-col">
            <div className="flex-1 space-y-5">
              {!log.length && (
                <div className="flex flex-col items-center py-10 text-center text-fg-muted">
                  <Bot className="h-10 w-10 text-gain" />
                  <p className="mt-3 max-w-md text-sm">Escolha uma pergunta sugerida ou escreva a sua. Cada resposta separa medição, estimativa, hipótese, recomendação e dado indisponível.</p>
                </div>
              )}
              {log.map((e, i) => (
                <div key={i} className="space-y-2">
                  <div className="ml-auto w-fit max-w-[85%] rounded-lg bg-ink-700 px-3.5 py-2 text-sm">{e.a.question}</div>
                  <div className="rounded-lg border border-ink-600 bg-ink-900 p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <Bot className="h-4 w-4 text-gain" />
                      <h3 className="font-semibold">{e.a.title}</h3>
                    </div>
                    <ul className="space-y-2 text-sm">
                      {e.a.blocks.map((b, j) => (
                        <li key={j} className="flex gap-2.5">
                          {BLOCK_TAG[b.kind] ? <KindTag kind={BLOCK_TAG[b.kind]!} /> : <span className="w-[86px] shrink-0" />}
                          <span className={b.kind === 'text' ? 'text-fg-muted' : ''}>{b.text}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {e.a.segmentId && <Link to="/app/comparar" className="btn-ghost btn-sm">Ver nos gráficos</Link>}
                      {providerOk && !e.llm && (
                        <button className="btn-ghost btn-sm" onClick={() => explain(i)}><Sparkles className="h-3.5 w-3.5" /> Reescrever com o modelo da VPS</button>
                      )}
                    </div>
                    {e.llm && (
                      <div className="mt-3 rounded-md border border-data/30 bg-data/5 p-3 text-sm">
                        <div className="label mb-1 text-data">Texto do modelo de linguagem (os números vêm do motor local)</div>
                        {e.llm.status === 'loading' ? 'Gerando…' : e.llm.status === 'error' ? <span className="text-loss">{e.llm.text}</span> : <p className="whitespace-pre-wrap">{e.llm.text}</p>}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={endRef} />
            </div>
            <form className="mt-5 flex gap-2" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
              <input className="input" placeholder="Ex.: Onde perdi mais tempo?" value={q} maxLength={300} onChange={(e) => setQ(e.target.value)} aria-label="Pergunta" />
              <button className="btn-primary" disabled={!q.trim()} aria-label="Enviar"><Send className="h-4 w-4" /></button>
            </form>
          </Panel>
          <div className="space-y-4">
            <Panel title="Perguntas sugeridas">
              <div className="flex flex-col gap-1.5">
                {SUGGESTED_QUESTIONS.map((s) => (
                  <button key={s.intent} onClick={() => ask(s.text)} className="rounded-md border border-ink-600 px-3 py-2 text-left text-sm text-fg-muted hover:border-gain/50 hover:text-fg">{s.text}</button>
                ))}
              </div>
            </Panel>
            <Panel title="Modelo de linguagem">
              <p className="text-sm text-fg-muted">
                {prefs.llm.enabled && prefs.llm.endpoint
                  ? providerOk ? `Conectado: ${provider.label}. Usado apenas para reescrever explicações.` : 'Configurado, mas sem conexão confirmada. As respostas continuam vindo do motor local.'
                  : 'Nenhum modelo configurado. O engenheiro funciona integralmente com o motor determinístico local.'}
              </p>
              <Link to="/app/configuracoes" className="link mt-2 inline-block text-sm">Configurar</Link>
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}
