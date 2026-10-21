import { describe, expect, it } from 'vitest';
import { generateDemoCsv } from '../demo/demo-data';
import { autoMapColumns, normalizeTable, parseCsv } from '../telemetry-parser';
import { detectLaps, buildSession, prepareFromNormalized } from '../analysis/pipeline';
import { buildTraces, compareLaps } from '../lap-comparator';

describe('pipeline com dados demonstrativos', () => {
  it('importa, detecta voltas e segmentos', () => {
    const csv = generateDemoCsv();
    const table = parseCsv(csv);
    expect(table.delimiter).toBe(';');
    expect(table.decimalComma).toBe(true);
    const mapping = autoMapColumns(table);
    expect(Object.keys(mapping).sort()).toEqual(
      ['accelLat', 'accelLong', 'brake', 'lat', 'lon', 'rpm', 'speed', 'steering', 'throttle', 'time'].sort(),
    );
    expect(mapping.speed?.unit).toBe('kmh');
    const norm = normalizeTable(table, mapping);
    expect(norm.report.errors).toEqual([]);
    expect(Math.round(norm.report.sampleRate)).toBe(20);
    const prep = prepareFromNormalized(norm);
    const det = detectLaps(prep, { method: 'auto' });
    expect(det.source).toBe('gps-gate');
    expect(det.laps.length).toBeGreaterThanOrEqual(7);
    const s = buildSession({
      name: 'x', trackName: 'y', fileName: 'demo.csv', fileSize: csv.length, format: 'demo',
      normalized: norm, prepared: prep, laps: det.laps, lapSource: det.source!, gate: det.gate,
    });
    const traces = buildTraces(s, s.referenceLap);
    const others = s.laps.filter((l) => l.included && l.number !== s.referenceLap);
    const cmp = compareLaps(traces.get(s.referenceLap!)!, traces.get(others[0].number)!, s.segments);
    expect(Math.abs(cmp.delta[cmp.delta.length - 1] - cmp.totalDelta)).toBeLessThan(1e-6);
  });
});
