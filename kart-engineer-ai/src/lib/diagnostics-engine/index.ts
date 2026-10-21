/**
 * Motor de diagnósticos determinístico.
 * Cada regra tem condições explícitas sobre grandezas calculadas. As regras
 * descrevem o que foi medido e sugerem hipóteses para teste; nunca afirmam a
 * causa de uma diferença sem dados que a sustentem.
 */
import type { DistanceSource, Lap, Segment } from '../types';
import { compareLaps, segmentStats, type LapComparison, type SegmentComparison } from '../lap-comparator';
import type { LapTrace } from '../telemetry-metrics';
import { mean, stdDev } from '../telemetry-metrics/signal';
import { fmtDelta, fmtLapTime, fmtSignedMeters, fmtSpeedDelta } from '../format';

export type EvidenceKind = 'measured' | 'estimated' | 'calculated';
export type Confidence = 'alta' | 'média' | 'baixa';

export interface Evidence {
  label: string;
  value: string;
  kind: EvidenceKind;
}

export interface Diagnostic {
  id: string;
  rule: RuleId;
  title: string;
  segmentId?: string;
  segmentName: string;
  /** Impacto mensurável (s) usado para ordenar; não é promessa de ganho. */
  relevance: number;
  tone: 'loss' | 'gain' | 'info';
  evidence: Evidence[];
  comparison: string;
  interpretation: string;
  hypothesis?: string;
  recommendation: string;
  confidence: Confidence;
  confidenceReason: string;
  limitations: string[];
  laps: number[];
}

export type RuleId =
  | 'segment-time-loss'
  | 'segment-inconsistency'
  | 'segment-consistent'
  | 'theoretical-best'
  | 'straight-speed'
  | 'data-quality';

export const RULES: Record<RuleId, { name: string; condition: string }> = {
  'segment-time-loss': {
    name: 'Perda de tempo em segmento',
    condition: 'Média da diferença de tempo do segmento (voltas comparadas − referência) acima do limiar configurado.',
  },
  'segment-inconsistency': {
    name: 'Segmento inconsistente',
    condition: 'Desvio-padrão do tempo do segmento entre voltas válidas ≥ 0,04 s e ≥ 1,5× a mediana dos desvios dos segmentos.',
  },
  'segment-consistent': {
    name: 'Segmento mais consistente',
    condition: 'Menor coeficiente de variação do tempo de segmento entre as voltas válidas.',
  },
  'theoretical-best': {
    name: 'Volta ideal teórica',
    condition: 'Diferença entre a melhor volta e a soma dos melhores tempos de cada segmento acima de 0,05 s.',
  },
  'straight-speed': {
    name: 'Velocidade em reta',
    condition: 'Velocidade máxima média menor que a referência em mais de 1,5 km/h num segmento de reta.',
  },
  'data-quality': {
    name: 'Qualidade dos dados',
    condition: 'Taxa de amostragem, origem da distância, número de voltas e canais disponíveis.',
  },
};

export interface DiagnosticContext {
  laps: Lap[];
  traces: Map<number, LapTrace>;
  segments: Segment[];
  referenceLap: number;
  /** Voltas a comparar com a referência; padrão: todas as voltas incluídas. */
  compareLaps?: number[];
  threshold: number;
  sampleRate: number;
  distanceSource: DistanceSource;
  hasGps: boolean;
  hasThrottle: boolean;
  hasBrake: boolean;
  speedOrigin: 'measured' | 'derived' | 'none';
  speedUnit?: 'kmh' | 'mph';
}

const LEVELS: Confidence[] = ['baixa', 'média', 'alta'];

function demote(c: Confidence, steps = 1): Confidence {
  return LEVELS[Math.max(0, LEVELS.indexOf(c) - steps)];
}

const BRAKE_ORIGIN: Record<string, string> = {
  'brake-channel': 'canal de freio (medido)',
  'accel-measured': 'aceleração longitudinal medida (estimativa do ponto)',
  'accel-derived': 'desaceleração derivada da velocidade (estimativa)',
};

export function dataLimitations(ctx: DiagnosticContext): string[] {
  const out: string[] = [];
  if (ctx.sampleRate < 10) out.push(`Taxa de amostragem de ${ctx.sampleRate.toFixed(1)} Hz: pontos de frenagem e ápice têm resolução de vários metros.`);
  if (ctx.distanceSource === 'gps') out.push('Distância calculada pelo GPS: o alinhamento entre voltas herda o erro de posição do receptor.');
  if (ctx.distanceSource === 'integrated-speed') out.push('Distância integrada da velocidade: erros de calibração deslocam o alinhamento ao longo da volta.');
  if (ctx.speedOrigin === 'derived') out.push('Velocidade derivada da posição/distância, não medida diretamente.');
  if (!ctx.hasThrottle) out.push('Sem canal de acelerador: o momento de aceleração não pode ser medido.');
  if (!ctx.hasBrake) out.push('Sem canal de freio: o início de frenagem é apenas estimado pela desaceleração.');
  if (!ctx.hasGps) out.push('Sem GPS: trajetórias e desvios laterais não estão disponíveis.');
  return out;
}

function baseConfidence(ctx: DiagnosticContext, n: number): { c: Confidence; reasons: string[] } {
  let c: Confidence = 'alta';
  const reasons: string[] = [];
  if (ctx.sampleRate < 10) {
    c = demote(c);
    reasons.push('amostragem abaixo de 10 Hz');
  }
  if (ctx.distanceSource === 'integrated-speed' || ctx.speedOrigin === 'derived') {
    c = demote(c);
    reasons.push('distância ou velocidade derivadas');
  }
  if (n < 3) {
    c = demote(c);
    reasons.push(`apenas ${n} volta(s) comparada(s)`);
  }
  return { c, reasons };
}

function analyseSegment(
  segIdx: number,
  comps: LapComparison[],
  ctx: DiagnosticContext,
): Diagnostic | null {
  const unit = ctx.speedUnit ?? 'kmh';
  const rows: SegmentComparison[] = comps.map((c) => c.segments[segIdx]);
  const seg = rows[0].segment;
  const deltas = rows.map((r) => r.timeDelta);
  const m = mean(deltas);
  if (!(m > ctx.threshold)) return null;
  const losing = deltas.filter((d) => d > ctx.threshold / 2).length;
  const share = losing / rows.length;
  const evidence: Evidence[] = [
    { label: 'Diferença média no segmento', value: fmtDelta(m), kind: 'calculated' },
    { label: 'Maior diferença', value: fmtDelta(Math.max(...deltas)), kind: 'calculated' },
    { label: 'Voltas mais lentas que a referência', value: `${losing} de ${rows.length}`, kind: 'calculated' },
  ];
  const exitD = mean(rows.map((r) => r.exitDelta));
  const minD = mean(rows.map((r) => r.minDelta));
  const entryD = mean(rows.map((r) => r.entryDelta));
  const exitShare = rows.filter((r) => r.exitDelta < -0.4).length / rows.length;
  const notes: string[] = [];
  const hyps: string[] = [];
  const checks: string[] = [];
  const speedKind: EvidenceKind = ctx.speedOrigin === 'derived' ? 'estimated' : 'measured';

  if (Number.isFinite(entryD)) evidence.push({ label: 'Velocidade de entrada (média vs. ref.)', value: fmtSpeedDelta(entryD, unit), kind: speedKind });
  if (Number.isFinite(minD) && seg.kind === 'corner') evidence.push({ label: 'Velocidade mínima (média vs. ref.)', value: fmtSpeedDelta(minD, unit), kind: speedKind });
  if (Number.isFinite(exitD)) evidence.push({ label: 'Velocidade de saída (média vs. ref.)', value: fmtSpeedDelta(exitD, unit), kind: speedKind });

  if (exitD < -0.5 && exitShare >= 0.6) {
    notes.push(`a velocidade de saída é consistentemente menor (${fmtSpeedDelta(exitD, unit)} em média)`);
    checks.push('a trajetória na saída', 'a velocidade de entrada');
    if (ctx.hasThrottle) checks.push('o momento de retomada do acelerador');
    else checks.push('o momento de aceleração (sem canal de acelerador, observe o vídeo onboard)');
  }
  if (seg.kind === 'corner' && minD < -0.5) notes.push(`a velocidade mínima na curva é menor (${fmtSpeedDelta(minD, unit)})`);
  if (seg.kind === 'corner' && entryD > 0.4 && minD < -0.4) {
    hyps.push('a entrada mais rápida não se converteu em velocidade mínima maior; é possível que a entrada esteja comprometendo o ápice — hipótese a confirmar pela trajetória e pelo vídeo');
  }

  const brakes = rows.map((r) => r.brakeDelta).filter((v): v is number => v !== null);
  const origin = rows.find((r) => r.ref.brakeOrigin)?.ref.brakeOrigin ?? null;
  if (seg.kind === 'corner' && brakes.length >= Math.ceil(rows.length * 0.6) && origin) {
    const b = mean(brakes);
    if (Math.abs(b) >= 3) {
      evidence.push({
        label: `Início de frenagem vs. ref. (${BRAKE_ORIGIN[origin]})`,
        value: fmtSignedMeters(b),
        kind: origin === 'brake-channel' ? 'measured' : 'estimated',
      });
      if (b < 0) hyps.push(`o início de frenagem ocorre em média ${Math.abs(b).toFixed(0)} m antes da referência`);
      else hyps.push(`o início de frenagem ocorre em média ${b.toFixed(0)} m depois da referência`);
      checks.push('o ponto de frenagem');
    }
  }
  const thr = rows.map((r) => r.throttleDelta).filter((v): v is number => v !== null);
  if (seg.kind === 'corner' && ctx.hasThrottle && thr.length >= Math.ceil(rows.length * 0.6)) {
    const t = mean(thr);
    if (Math.abs(t) >= 3) {
      evidence.push({ label: 'Acelerador ≥ 80% após o ápice vs. ref.', value: fmtSignedMeters(t), kind: 'measured' });
      if (t > 0) hyps.push(`a aceleração plena acontece em média ${t.toFixed(0)} m depois da referência`);
    }
  }

  const { c: c0, reasons } = baseConfidence(ctx, rows.length);
  let c = c0;
  if (share < 0.6) {
    c = demote(c);
    reasons.push('a perda não se repete na maioria das voltas');
  }
  const std = stdDev(deltas);
  if (Number.isFinite(std) && std > Math.abs(m)) {
    c = demote(c);
    reasons.push('variação entre voltas maior que a diferença média');
  }

  const interpretation = notes.length
    ? `Neste segmento, ${notes.join(' e ')}.`
    : 'A diferença de tempo existe, mas não há um padrão claro de velocidade de entrada, mínima ou saída que a explique isoladamente.';
  const uniqueChecks = [...new Set(checks)];
  const recommendation = uniqueChecks.length
    ? `Compare ${uniqueChecks.join(', ')} entre a volta de referência e as demais antes de alterar sua abordagem. Mude uma variável por vez, de forma gradual, e confirme o efeito numa nova sessão.`
    : 'Revise este segmento no vídeo onboard e no traçado, comparando com a volta de referência. Teste uma alteração por vez e confirme o efeito numa nova sessão.';

  return {
    id: `loss-${seg.id}`,
    rule: 'segment-time-loss',
    title: `${seg.name}: perda média de ${fmtDelta(m)}`,
    segmentId: seg.id,
    segmentName: seg.name,
    relevance: m,
    tone: 'loss',
    evidence,
    comparison: `Referência: volta ${ctx.referenceLap}. Comparadas: ${comps.map((c) => c.cmp.lapNumber).join(', ')}.`,
    interpretation,
    hypothesis: hyps.length ? `Hipótese: ${hyps.join('; ')}.` : undefined,
    recommendation,
    confidence: c,
    confidenceReason: reasons.length ? `Reduzida por: ${reasons.join(', ')}.` : 'Dados com boa amostragem e padrão repetido nas voltas comparadas.',
    limitations: [
      'Velocidade maior num ponto não garante tempo menor no segmento; a diferença de tempo é o critério principal.',
      ...(origin && origin !== 'brake-channel' ? ['Ponto de frenagem estimado pela desaceleração, não pelo pedal.'] : []),
    ],
    laps: comps.map((c) => c.cmp.lapNumber),
  };
}

export function diagnose(ctx: DiagnosticContext): Diagnostic[] {
  const ref = ctx.traces.get(ctx.referenceLap);
  if (!ref || !ctx.segments.length) return [];
  const pool = (ctx.compareLaps ?? ctx.laps.filter((l) => l.included).map((l) => l.number)).filter((n) => n !== ctx.referenceLap);
  const traces = pool.map((n) => ctx.traces.get(n)).filter((t): t is LapTrace => !!t);
  const out: Diagnostic[] = [];
  const unit = ctx.speedUnit ?? 'kmh';

  if (traces.length) {
    const comps = traces.map((t) => compareLaps(ref, t, ctx.segments));
    ctx.segments.forEach((_, i) => {
      const d = analyseSegment(i, comps, ctx);
      if (d) out.push(d);
    });

    // Velocidade em reta: separa diferença herdada da curva anterior.
    ctx.segments.forEach((seg, i) => {
      if (seg.kind !== 'straight') return;
      const rows = comps.map((c) => c.segments[i]);
      const maxD = mean(rows.map((r) => r.cmp.maxSpeed - r.ref.maxSpeed));
      if (!(maxD < -1.5 / 3.6)) return;
      const prevExit = mean(rows.map((r) => r.entryDelta));
      const inherited = prevExit < -0.4;
      const { c, reasons } = baseConfidence(ctx, rows.length);
      out.push({
        id: `straight-${seg.id}`,
        rule: 'straight-speed',
        title: `${seg.name}: velocidade máxima menor que a referência`,
        segmentId: seg.id,
        segmentName: seg.name,
        relevance: Math.max(0, mean(rows.map((r) => r.timeDelta))),
        tone: 'loss',
        evidence: [
          { label: 'Velocidade máxima (média vs. ref.)', value: fmtSpeedDelta(maxD, unit), kind: ctx.speedOrigin === 'derived' ? 'estimated' : 'measured' },
          { label: 'Velocidade no início da reta (média vs. ref.)', value: fmtSpeedDelta(prevExit, unit), kind: ctx.speedOrigin === 'derived' ? 'estimated' : 'measured' },
          { label: 'Diferença de tempo na reta', value: fmtDelta(mean(rows.map((r) => r.timeDelta))), kind: 'calculated' },
        ],
        comparison: `Referência: volta ${ctx.referenceLap}.`,
        interpretation: inherited
          ? 'A reta já começa mais lenta: a diferença parece herdada da saída da curva anterior.'
          : 'A reta começa com velocidade semelhante, mas atinge velocidade máxima menor. Os dados disponíveis não permitem identificar a causa.',
        hypothesis: inherited ? 'Hipótese: melhorar a saída da curva anterior tende a refletir na reta inteira.' : undefined,
        recommendation: inherited
          ? 'Priorize a análise da curva anterior a esta reta.'
          : 'Considere fatores fora da pilotagem (vácuo, vento, motor, relação, pressão de pneus) antes de mudar a técnica; compare com outras sessões.',
        confidence: inherited ? c : demote(c),
        confidenceReason: reasons.length ? `Reduzida por: ${reasons.join(', ')}.` : 'Padrão repetido nas voltas comparadas.',
        limitations: ['Fatores externos (tráfego, vento, motor) não estão nos dados.'],
        laps: pool,
      });
    });
  }

  // Consistência por segmento entre todas as voltas incluídas.
  const inc = ctx.laps.filter((l) => l.included).map((l) => ctx.traces.get(l.number)).filter((t): t is LapTrace => !!t);
  if (inc.length >= 3) {
    const stats = segmentStats(inc, ctx.segments);
    const stds = stats.map((s) => s.std).filter(Number.isFinite).sort((a, b) => a - b);
    const med = stds[stds.length >> 1] ?? 0;
    const { c, reasons } = baseConfidence(ctx, inc.length);
    for (const s of stats) {
      if (s.std >= 0.04 && s.std >= med * 1.5) {
        out.push({
          id: `incons-${s.segment.id}`,
          rule: 'segment-inconsistency',
          title: `${s.segment.name}: tempo pouco repetível`,
          segmentId: s.segment.id,
          segmentName: s.segment.name,
          relevance: s.std,
          tone: 'loss',
          evidence: [
            { label: 'Desvio-padrão do segmento', value: `${s.std.toFixed(3)} s`, kind: 'calculated' },
            { label: 'Melhor tempo do segmento', value: `${s.best.toFixed(3)} s (volta ${s.bestLap})`, kind: 'calculated' },
            { label: 'Média do segmento', value: `${s.mean.toFixed(3)} s`, kind: 'calculated' },
          ],
          comparison: `${inc.length} voltas válidas consideradas.`,
          interpretation: 'O tempo neste segmento varia mais que nos demais. A abordagem pode estar mudando de volta para volta.',
          recommendation: 'Escolha uma referência visual (ponto de frenagem, ápice) e busque repeti-la por várias voltas antes de tentar ir mais rápido.',
          confidence: c,
          confidenceReason: reasons.length ? `Reduzida por: ${reasons.join(', ')}.` : 'Baseado em todas as voltas válidas.',
          limitations: ['Tráfego e bandeiras não estão nos dados e também geram variação.'],
          laps: inc.map((t) => t.lapNumber),
        });
      }
    }
    const best = stats.filter((s) => Number.isFinite(s.std)).sort((a, b) => a.std / a.mean - b.std / b.mean)[0];
    if (best) {
      out.push({
        id: `consistent-${best.segment.id}`,
        rule: 'segment-consistent',
        title: `${best.segment.name}: segmento mais consistente`,
        segmentId: best.segment.id,
        segmentName: best.segment.name,
        relevance: 0,
        tone: 'gain',
        evidence: [
          { label: 'Desvio-padrão', value: `${best.std.toFixed(3)} s`, kind: 'calculated' },
          { label: 'Coeficiente de variação', value: `${((best.std / best.mean) * 100).toFixed(2)}%`, kind: 'calculated' },
        ],
        comparison: `${inc.length} voltas válidas consideradas.`,
        interpretation: 'Este é o trecho em que seu tempo menos variou entre as voltas.',
        recommendation: 'Use a forma como você aborda este trecho como modelo de repetibilidade para os demais.',
        confidence: c,
        confidenceReason: reasons.length ? `Reduzida por: ${reasons.join(', ')}.` : 'Baseado em todas as voltas válidas.',
        limitations: [],
        laps: inc.map((t) => t.lapNumber),
      });
    }

    const refLap = ctx.laps.find((l) => l.number === ctx.referenceLap);
    const theo = stats.reduce((a, s) => a + s.best, 0);
    if (refLap && refLap.lapTime - theo > 0.05) {
      const contributors = stats
        .map((s) => ({ s, gap: (s.times.find((t) => t.lap === ctx.referenceLap)?.time ?? s.best) - s.best }))
        .filter((x) => x.gap > 0.01)
        .sort((a, b) => b.gap - a.gap)
        .slice(0, 4);
      out.push({
        id: 'theoretical-best',
        rule: 'theoretical-best',
        title: `Volta ideal teórica: ${fmtLapTime(theo)}`,
        segmentName: 'Volta completa',
        relevance: refLap.lapTime - theo,
        tone: 'info',
        evidence: [
          { label: 'Melhor volta', value: fmtLapTime(refLap.lapTime), kind: 'measured' },
          { label: 'Soma dos melhores segmentos', value: fmtLapTime(theo), kind: 'calculated' },
          ...contributors.map((x) => ({
            label: `${x.s.segment.name}: melhor na volta ${x.s.bestLap}`,
            value: `${fmtDelta(-x.gap)} vs. ref.`,
            kind: 'calculated' as const,
          })),
        ],
        comparison: `Referência: volta ${ctx.referenceLap}.`,
        interpretation: 'Você já percorreu cada segmento mais rápido em alguma volta desta sessão. A soma desses melhores trechos é um cálculo, não uma previsão.',
        hypothesis: 'Juntar os melhores segmentos numa mesma volta nem sempre é possível: a saída de um trecho altera a entrada do seguinte.',
        recommendation: 'Estude primeiro os segmentos com maior diferença entre a melhor volta e o melhor trecho registrado.',
        confidence: baseConfidence(ctx, inc.length).c,
        confidenceReason: 'Cálculo direto sobre tempos de segmento; depende do alinhamento entre voltas.',
        limitations: ['Os limites dos segmentos influenciam o resultado.'],
        laps: inc.map((t) => t.lapNumber),
      });
    }
  }

  const lim = dataLimitations(ctx);
  if (lim.length) {
    out.push({
      id: 'data-quality',
      rule: 'data-quality',
      title: 'Limitações dos dados desta sessão',
      segmentName: 'Sessão',
      relevance: -1,
      tone: 'info',
      evidence: [
        { label: 'Taxa de amostragem', value: `${ctx.sampleRate.toFixed(1)} Hz`, kind: 'measured' },
        { label: 'Voltas válidas', value: String(inc.length), kind: 'calculated' },
      ],
      comparison: '—',
      interpretation: 'Estas condições limitam a precisão de algumas análises.',
      recommendation: 'Quando possível, registre com GPS de 10 Hz ou mais e canais de acelerador e freio.',
      confidence: 'alta',
      confidenceReason: 'Descrição direta do arquivo importado.',
      limitations: lim,
      laps: [],
    });
  }

  const order: Record<Diagnostic['tone'], number> = { loss: 0, info: 1, gain: 2 };
  return out.sort((a, b) => (a.rule === 'data-quality' ? 1 : b.rule === 'data-quality' ? -1 : 0) || b.relevance - a.relevance || order[a.tone] - order[b.tone]);
}
