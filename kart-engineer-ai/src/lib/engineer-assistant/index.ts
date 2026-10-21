/**
 * Engenheiro virtual determinístico: interpreta perguntas por palavras-chave
 * e responde apenas com grandezas calculadas pelo motor de telemetria.
 * Cada bloco declara se é medição, estimativa, hipótese, recomendação ou dado indisponível.
 */
import type { Lap, Session, SessionMeta } from '../types';
import type { Diagnostic } from '../diagnostics-engine';
import { compareLaps, segmentStats } from '../lap-comparator';
import { consistency, type LapTrace } from '../telemetry-metrics';
import { fmtDelta, fmtLapTime, fmtPct, fmtSpeed, fmtSpeedDelta, fmtDate } from '../format';

export type BlockKind = 'measurement' | 'estimate' | 'calculation' | 'hypothesis' | 'recommendation' | 'unavailable' | 'text';

export interface AnswerBlock {
  kind: BlockKind;
  text: string;
}

export type IntentId =
  | 'time-loss'
  | 'priority'
  | 'best-lap'
  | 'compare-top-two'
  | 'speed-loss'
  | 'consistency'
  | 'next-session'
  | 'evolution'
  | 'summary'
  | 'help';

export interface EngineerAnswer {
  question: string;
  intent: IntentId;
  title: string;
  blocks: AnswerBlock[];
  segmentId?: string;
}

export interface EngineerContext {
  session: Session;
  traces: Map<number, LapTrace>;
  diagnostics: Diagnostic[];
  history: SessionMeta[];
  speedUnit: 'kmh' | 'mph';
}

export const SUGGESTED_QUESTIONS: { intent: IntentId; text: string }[] = [
  { intent: 'time-loss', text: 'Onde perdi mais tempo?' },
  { intent: 'priority', text: 'Qual curva merece atenção primeiro?' },
  { intent: 'best-lap', text: 'Qual foi minha melhor volta?' },
  { intent: 'compare-top-two', text: 'Compare minhas duas melhores voltas.' },
  { intent: 'speed-loss', text: 'Onde perdi velocidade?' },
  { intent: 'consistency', text: 'Em qual segmento fui mais consistente?' },
  { intent: 'next-session', text: 'O que devo testar na próxima sessão?' },
  { intent: 'evolution', text: 'Como evoluiu minha performance?' },
];

const KEYWORDS: Record<IntentId, string[]> = {
  'time-loss': ['perdi mais tempo', 'perco tempo', 'perdendo tempo', 'onde perdi', 'perda de tempo', 'mais lento', 'perdi tempo'],
  priority: ['atencao primeiro', 'prioridade', 'priorizar', 'qual curva', 'focar', 'concentrar', 'primeiro'],
  'best-lap': ['melhor volta', 'volta mais rapida', 'mais rapida', 'recorde pessoal'],
  'compare-top-two': ['duas melhores', 'compare', 'comparar', 'comparacao'],
  'speed-loss': ['perdi velocidade', 'velocidade', 'mais devagar', 'lento na saida', 'saida'],
  consistency: ['consistente', 'consistencia', 'regular', 'repetivel', 'variacao'],
  'next-session': ['testar', 'proxima sessao', 'proximo treino', 'o que fazer', 'treinar', 'melhorar'],
  evolution: ['evoluiu', 'evolucao', 'progresso', 'historico', 'ao longo', 'sessoes anteriores', 'tendencia'],
  summary: ['resumo', 'como foi', 'visao geral', 'geral'],
  help: ['ajuda', 'o que voce', 'como funciona', 'perguntas'],
};

export function normalizeText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Classifica a pergunta pela maior soma de palavras-chave (frases mais longas pesam mais). */
export function matchIntent(question: string): IntentId {
  const q = normalizeText(question);
  let best: IntentId = 'help';
  let bestScore = 0;
  (Object.keys(KEYWORDS) as IntentId[]).forEach((id) => {
    const score = KEYWORDS[id].reduce((acc, k) => acc + (q.includes(k) ? k.split(' ').length + 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  });
  return best;
}

function included(session: Session): Lap[] {
  return session.laps.filter((l) => l.included);
}

function evidenceBlocks(d: Diagnostic): AnswerBlock[] {
  const blocks: AnswerBlock[] = d.evidence.map((e) => ({
    kind: e.kind === 'measured' ? 'measurement' : e.kind === 'estimated' ? 'estimate' : 'calculation',
    text: `${e.label}: ${e.value}`,
  }));
  blocks.push({ kind: 'text', text: d.interpretation });
  if (d.hypothesis) blocks.push({ kind: 'hypothesis', text: d.hypothesis });
  blocks.push({ kind: 'recommendation', text: d.recommendation });
  blocks.push({ kind: 'text', text: `Confiança ${d.confidence}. ${d.confidenceReason}` });
  return blocks;
}

function noData(question: string, intent: IntentId, msg: string): EngineerAnswer {
  return { question, intent, title: 'Dados insuficientes', blocks: [{ kind: 'unavailable', text: msg }] };
}

export function answer(question: string, ctx: EngineerContext, forced?: IntentId): EngineerAnswer {
  const intent = forced ?? matchIntent(question);
  const { session, diagnostics, traces, speedUnit } = ctx;
  const inc = included(session);
  const ref = session.referenceLap;
  const losses = diagnostics.filter((d) => d.rule === 'segment-time-loss');

  switch (intent) {
    case 'time-loss': {
      if (inc.length < 2) return noData(question, intent, 'É preciso ao menos duas voltas válidas para comparar tempos por segmento.');
      if (!losses.length) {
        return {
          question,
          intent,
          title: 'Nenhuma perda acima do limiar',
          blocks: [
            { kind: 'calculation', text: `Nenhum segmento apresenta perda média acima do limiar configurado em relação à volta ${ref}.` },
            { kind: 'recommendation', text: 'Reduza o limiar em Configurações para ver diferenças menores, ou compare voltas específicas em "Comparar voltas".' },
          ],
        };
      }
      const top = losses.slice(0, 3);
      return {
        question,
        intent,
        title: `Maior perda: ${top[0].segmentName}`,
        segmentId: top[0].segmentId,
        blocks: [
          { kind: 'calculation', text: `Ranking pela diferença média de tempo em relação à volta ${ref}: ${top.map((d, i) => `${i + 1}º ${d.segmentName} (${fmtDelta(d.relevance)})`).join('; ')}.` },
          ...evidenceBlocks(top[0]),
        ],
      };
    }
    case 'priority': {
      const cornerLoss = losses.find((d) => session.segments.find((s) => s.id === d.segmentId)?.kind === 'corner');
      const incons = diagnostics.find((d) => d.rule === 'segment-inconsistency');
      if (!cornerLoss && !incons) return noData(question, intent, 'Nenhuma curva se destaca pelos critérios atuais (perda média ou inconsistência).');
      const pick = cornerLoss ?? incons!;
      return {
        question,
        intent,
        title: `Prioridade sugerida: ${pick.segmentName}`,
        segmentId: pick.segmentId,
        blocks: [
          {
            kind: 'text',
            text: cornerLoss
              ? 'Critério: curva com maior diferença média de tempo em relação à referência. A ordem é por relevância mensurável, não por garantia de ganho.'
              : 'Critério: nenhuma curva tem perda média acima do limiar; destacada a de tempo menos repetível.',
          },
          ...evidenceBlocks(pick),
        ],
      };
    }
    case 'best-lap': {
      const best = inc.reduce<Lap | null>((a, b) => (!a || b.lapTime < a.lapTime ? b : a), null);
      if (!best) return noData(question, intent, 'Não há voltas válidas nesta sessão.');
      const tr = traces.get(best.number);
      const c = consistency(inc.map((l) => l.lapTime));
      const blocks: AnswerBlock[] = [
        { kind: 'measurement', text: `Volta ${best.number}: ${fmtLapTime(best.lapTime)}.` },
        { kind: 'calculation', text: `Média das ${inc.length} voltas válidas: ${fmtLapTime(session.summary.meanLapTime)} (desvio-padrão ${Number.isFinite(c.std) ? c.std.toFixed(3) + ' s' : '—'}).` },
      ];
      if (tr) {
        const max = Math.max(...tr.speed.filter(Number.isFinite));
        blocks.push({ kind: session.origins.speed === 'derived' ? 'estimate' : 'measurement', text: `Velocidade máxima nesta volta: ${fmtSpeed(max, speedUnit)}.` });
      }
      if (session.summary.theoreticalBest) {
        blocks.push({ kind: 'calculation', text: `Soma dos melhores segmentos da sessão: ${fmtLapTime(session.summary.theoreticalBest)}. É um cálculo de referência, não uma previsão.` });
      }
      return { question, intent, title: `Melhor volta: ${fmtLapTime(best.lapTime)}`, blocks };
    }
    case 'compare-top-two': {
      const sorted = [...inc].sort((a, b) => a.lapTime - b.lapTime);
      if (sorted.length < 2) return noData(question, intent, 'É preciso ao menos duas voltas válidas.');
      const [a, b] = sorted;
      const ta = traces.get(a.number);
      const tb = traces.get(b.number);
      if (!ta || !tb) return noData(question, intent, 'Não foi possível reamostrar as voltas (distância indisponível).');
      const cmp = compareLaps(ta, tb, session.segments);
      const ranked = [...cmp.segments].sort((x, y) => Math.abs(y.timeDelta) - Math.abs(x.timeDelta)).slice(0, 4);
      return {
        question,
        intent,
        title: `Volta ${a.number} × volta ${b.number}: ${fmtDelta(cmp.totalDelta)}`,
        segmentId: ranked[0]?.segment.id,
        blocks: [
          { kind: 'measurement', text: `Volta ${a.number}: ${fmtLapTime(a.lapTime)} · Volta ${b.number}: ${fmtLapTime(b.lapTime)}.` },
          ...ranked.map<AnswerBlock>((r) => ({
            kind: 'calculation',
            text: `${r.segment.name}: volta ${b.number} ${r.timeDelta > 0 ? 'perde' : 'ganha'} ${fmtDelta(Math.abs(r.timeDelta))}; saída ${fmtSpeedDelta(r.exitDelta, speedUnit)}.`,
          })),
          { kind: 'text', text: 'Velocidade maior em um ponto não significa necessariamente tempo menor no trecho; use a diferença de tempo como critério.' },
          { kind: 'recommendation', text: 'Abra "Comparar voltas" para ver os gráficos sincronizados destes segmentos.' },
        ],
      };
    }
    case 'speed-loss': {
      if (!session.channels.speed) return noData(question, intent, 'Esta sessão não tem canal de velocidade nem dados para derivá-la.');
      const rows = losses
        .map((d) => ({ d, exit: d.evidence.find((e) => e.label.startsWith('Velocidade de saída')) }))
        .filter((x) => x.exit && x.exit.value.startsWith('−'));
      if (!rows.length) {
        return {
          question,
          intent,
          title: 'Sem perda de velocidade relevante',
          blocks: [{ kind: 'calculation', text: 'Nos segmentos com perda de tempo, a velocidade de saída não ficou sistematicamente abaixo da referência.' }],
        };
      }
      return {
        question,
        intent,
        title: `Velocidade de saída menor em ${rows.length} segmento(s)`,
        segmentId: rows[0].d.segmentId,
        blocks: [
          ...rows.slice(0, 4).map<AnswerBlock>((r) => ({
            kind: session.origins.speed === 'derived' ? 'estimate' : 'measurement',
            text: `${r.d.segmentName}: saída ${r.exit!.value} em média vs. volta ${ref}; tempo ${fmtDelta(r.d.relevance)}.`,
          })),
          { kind: 'recommendation', text: rows[0].d.recommendation },
        ],
      };
    }
    case 'consistency': {
      const incT = inc.map((l) => traces.get(l.number)).filter((t): t is LapTrace => !!t);
      if (incT.length < 3) return noData(question, intent, 'São necessárias ao menos três voltas válidas para avaliar consistência por segmento.');
      const stats = segmentStats(incT, session.segments).filter((s) => Number.isFinite(s.std));
      const byCv = [...stats].sort((a, b) => a.std / a.mean - b.std / b.mean);
      const c = consistency(inc.map((l) => l.lapTime));
      return {
        question,
        intent,
        title: `Mais consistente: ${byCv[0].segment.name}`,
        segmentId: byCv[0].segment.id,
        blocks: [
          { kind: 'calculation', text: `${byCv[0].segment.name}: desvio-padrão ${byCv[0].std.toFixed(3)} s (CV ${fmtPct(byCv[0].std / byCv[0].mean)}).` },
          { kind: 'calculation', text: `Menos consistente: ${byCv[byCv.length - 1].segment.name}, desvio-padrão ${byCv[byCv.length - 1].std.toFixed(3)} s.` },
          { kind: 'calculation', text: `Volta completa: desvio-padrão ${c.std.toFixed(3)} s entre ${c.count} voltas (CV ${fmtPct(c.cv)}).` },
        ],
      };
    }
    case 'next-session': {
      const items = diagnostics.filter((d) => d.rule === 'segment-time-loss' || d.rule === 'segment-inconsistency').slice(0, 3);
      if (!items.length) return noData(question, intent, 'Nenhum segmento atende aos critérios de perda ou inconsistência. Grave mais voltas ou reduza o limiar em Configurações.');
      return {
        question,
        intent,
        title: 'Plano de testes para a próxima sessão',
        segmentId: items[0].segmentId,
        blocks: [
          { kind: 'text', text: 'Teste uma alteração por vez, de forma gradual e dentro dos limites de segurança da pista. Compare a nova sessão com esta.' },
          ...items.map<AnswerBlock>((d, i) => ({ kind: 'recommendation', text: `${i + 1}. ${d.segmentName}: ${d.recommendation} (confiança ${d.confidence})` })),
          { kind: 'text', text: 'Registre no mesmo formato e com o mesmo equipamento para manter as sessões comparáveis.' },
        ],
      };
    }
    case 'evolution': {
      const hist = ctx.history.filter((h) => h.summary.bestLapTime && (!ctx.session.trackName || h.trackName === ctx.session.trackName));
      if (hist.length < 2) {
        return noData(question, intent, `Há ${hist.length} sessão(ões) salva(s) nesta pista. São necessárias ao menos duas para avaliar evolução.`);
      }
      const sorted = [...hist].sort((a, b) => a.createdAt - b.createdAt);
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const d = (last.summary.bestLapTime ?? 0) - (first.summary.bestLapTime ?? 0);
      return {
        question,
        intent,
        title: `Melhor volta ${d < 0 ? 'melhorou' : 'piorou'} ${fmtDelta(Math.abs(d))} entre a primeira e a última sessão`,
        blocks: [
          ...sorted.map<AnswerBlock>((h) => ({
            kind: 'measurement',
            text: `${fmtDate(h.createdAt)} · ${h.name}: melhor ${fmtLapTime(h.summary.bestLapTime)}, média ${fmtLapTime(h.summary.meanLapTime)}, desvio ${h.summary.consistencyStd?.toFixed(3) ?? '—'} s.`,
          })),
          { kind: 'text', text: 'Condições de pista, clima, pneus e equipamento não estão registrados e também afetam os tempos.' },
        ],
      };
    }
    case 'summary': {
      const s = session.summary;
      return {
        question,
        intent,
        title: `Resumo: ${session.name}`,
        blocks: [
          { kind: 'measurement', text: `Melhor volta ${fmtLapTime(s.bestLapTime)} (volta ${s.bestLapNumber ?? '—'}), ${s.validLapCount} de ${s.lapCount} voltas válidas.` },
          { kind: 'calculation', text: `Média ${fmtLapTime(s.meanLapTime)}, desvio-padrão ${s.consistencyStd?.toFixed(3) ?? '—'} s.` },
          ...(losses[0] ? [{ kind: 'calculation' as const, text: `Maior perda média: ${losses[0].segmentName} (${fmtDelta(losses[0].relevance)}).` }] : []),
          ...(session.channels.throttle ? [] : [{ kind: 'unavailable' as const, text: 'Acelerador: não registrado nesta sessão.' }]),
          ...(session.channels.brake ? [] : [{ kind: 'unavailable' as const, text: 'Freio: não registrado nesta sessão.' }]),
        ],
      };
    }
    default:
      return {
        question,
        intent: 'help',
        title: 'Como posso ajudar',
        blocks: [
          { kind: 'text', text: 'Respondo com base nos cálculos desta sessão: tempos por segmento, velocidades, consistência e diagnósticos por regras. Experimente uma das perguntas sugeridas.' },
          { kind: 'unavailable', text: 'Não interpreto perguntas abertas como um modelo de linguagem. A integração opcional com um modelo open source na sua VPS pode reescrever as explicações, mas os números sempre vêm do motor local.' },
        ],
      };
  }
}

