import { describe, expect, it } from 'vitest';
import { buildDemoSession } from '../demo';
import { analyseSession } from '../analysis/context';
import { answer, SUGGESTED_QUESTIONS } from '../engineer-assistant';
import { pdfText, lapsCsv } from '../report-generator';

describe('diagnósticos sobre a sessão demonstrativa', () => {
  const session = buildDemoSession();
  const { traces, diagnostics } = analyseSession(session, { deltaThreshold: 0.05, speedUnit: 'kmh' });

  it('cada diagnóstico tem evidência, recomendação, confiança e é ordenado por relevância', () => {
    expect(diagnostics.length).toBeGreaterThan(0);
    for (const d of diagnostics) {
      expect(d.evidence.length).toBeGreaterThan(0);
      expect(d.recommendation.length).toBeGreaterThan(10);
      expect(['alta', 'média', 'baixa']).toContain(d.confidence);
    }
    const losses = diagnostics.filter((d) => d.rule === 'segment-time-loss');
    for (let i = 1; i < losses.length; i++) expect(losses[i - 1].relevance).toBeGreaterThanOrEqual(losses[i].relevance);
    expect(diagnostics[diagnostics.length - 1].rule).toBe('data-quality');
  });

  it('nunca afirma ganho garantido', () => {
    const text = JSON.stringify(diagnostics).toLowerCase();
    expect(text).not.toMatch(/ganho garantido|garantimos|certamente|vai ganhar/);
  });

  it('o engenheiro responde todas as perguntas sugeridas com blocos tipados', () => {
    for (const q of SUGGESTED_QUESTIONS) {
      const a = answer(q.text, { session, traces, diagnostics, history: [session], speedUnit: 'kmh' });
      expect(a.intent).toBe(q.intent);
      expect(a.blocks.length).toBeGreaterThan(0);
    }
  });

  it('exportações', () => {
    expect(lapsCsv(session).split('\n')).toHaveLength(session.laps.length + 1);
    expect(pdfText('−0,1 s → C2 ≥ 3')).toBe('-0,1 s -> C2 >= 3');
  });
});
