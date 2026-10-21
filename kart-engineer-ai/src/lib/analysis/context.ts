import type { Preferences, Session } from '../types';
import { buildTraces } from '../lap-comparator';
import { diagnose, type DiagnosticContext } from '../diagnostics-engine';
import type { LapTrace } from '../telemetry-metrics';

export function diagnosticContext(
  session: Session,
  traces: Map<number, LapTrace>,
  prefs: Pick<Preferences, 'deltaThreshold' | 'speedUnit'>,
  compare?: number[],
): DiagnosticContext | null {
  if (session.referenceLap === null) return null;
  return {
    laps: session.laps,
    traces,
    segments: session.segments,
    referenceLap: session.referenceLap,
    compareLaps: compare,
    threshold: prefs.deltaThreshold,
    sampleRate: session.sampleRate,
    distanceSource: session.distanceSource,
    hasGps: !!session.xy,
    hasThrottle: !!session.channels.throttle,
    hasBrake: !!session.channels.brake,
    speedOrigin: session.channels.speed ? session.origins.speed ?? 'measured' : 'none',
    speedUnit: prefs.speedUnit,
  };
}

export function analyseSession(session: Session, prefs: Pick<Preferences, 'deltaThreshold' | 'speedUnit'>) {
  const traces = buildTraces(session, session.referenceLap);
  const ctx = diagnosticContext(session, traces, prefs);
  return { traces, diagnostics: ctx ? diagnose(ctx) : [] };
}
