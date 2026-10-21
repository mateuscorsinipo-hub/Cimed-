import { useEffect, useState } from 'react';
import type { Session } from '@/lib/types';
import type { LapTrace } from '@/lib/telemetry-metrics';
import type { LapComparison } from '@/lib/lap-comparator';
import type { Diagnostic } from '@/lib/diagnostics-engine';

export interface DemoData {
  session: Session;
  ref: LapTrace;
  cmp: LapTrace;
  comparison: LapComparison;
  /** Diagnósticos reais do motor de regras sobre a sessão demonstrativa. */
  diagnostics: Diagnostic[];
}

let cache: Promise<DemoData> | null = null;

/** Gera (uma vez) a sessão demonstrativa sintética para a landing page. */
export function loadDemoData(): Promise<DemoData> {
  if (!cache) {
    cache = Promise.all([import('@/lib/demo'), import('@/lib/lap-comparator'), import('@/lib/analysis/context')]).then(([demo, cmpMod, ctxMod]) => {
      const session = demo.buildDemoSession();
      const traces = cmpMod.buildTraces(session, session.referenceLap);
      const ref = traces.get(session.referenceLap!)!;
      // Volta comparada: a de tempo mediano entre as demais válidas (representativa, não escolhida a dedo).
      const others = session.laps.filter((l) => l.included && l.number !== session.referenceLap).sort((a, b) => a.lapTime - b.lapTime);
      const cmp = traces.get(others[Math.floor(others.length / 2)].number)!;
      const { diagnostics } = ctxMod.analyseSession(session, { deltaThreshold: 0.05, speedUnit: 'kmh' });
      return { session, ref, cmp, comparison: cmpMod.compareLaps(ref, cmp, session.segments), diagnostics };
    });
  }
  return cache;
}

export function useDemoData(): DemoData | null {
  const [data, setData] = useState<DemoData | null>(null);
  useEffect(() => {
    let alive = true;
    const run = () => loadDemoData().then((d) => alive && setData(d));
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(run, { timeout: 600 });
    else setTimeout(run, 50);
    return () => {
      alive = false;
    };
  }, []);
  return data;
}
