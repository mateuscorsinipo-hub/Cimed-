import { autoMapColumns, normalizeTable, parseCsv } from '../telemetry-parser';
import { buildSession, detectLaps, prepareFromNormalized } from '../analysis/pipeline';
import type { Session } from '../types';
import { DEMO_SESSION_NAME, DEMO_TRACK_NAME, generateDemoCsv } from './demo-data';

export * from './demo-data';

/** Constrói a sessão demonstrativa pelo mesmo pipeline usado na importação real. */
export function buildDemoSession(): Session {
  const csv = generateDemoCsv();
  const table = parseCsv(csv);
  const normalized = normalizeTable(table, autoMapColumns(table));
  const prepared = prepareFromNormalized(normalized);
  const det = detectLaps(prepared, { method: 'auto' });
  return buildSession({
    name: DEMO_SESSION_NAME,
    trackName: DEMO_TRACK_NAME,
    fileName: 'kart-engineer-demo.csv',
    fileSize: csv.length,
    format: 'demo',
    normalized,
    prepared,
    laps: det.laps,
    lapSource: det.source ?? 'gps-gate',
    gate: det.gate,
    isDemo: true,
  });
}
