/// <reference lib="webworker" />
/**
 * Processamento pesado fora da thread de interface: leitura do arquivo,
 * normalização, filtragem do GPS e detecção de voltas.
 */
import { autoMapColumns, detectFormat, normalizeTable, type ColumnMapping } from '../lib/telemetry-parser';
import { detectLaps, prepareFromNormalized, type LapOptions } from '../lib/analysis/pipeline';
import type { RawTable } from '../lib/types';

export type WorkerRequest =
  | { id: number; type: 'parse'; fileName: string; text: string }
  | { id: number; type: 'process'; table: RawTable; mapping: ColumnMapping; lapOptions: LapOptions };

export type WorkerResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'parse') {
      const fmt = detectFormat(msg.fileName, msg.text.slice(0, 2000));
      const table = fmt.parse(msg.text);
      const mapping = autoMapColumns(table);
      post({ id: msg.id, ok: true, result: { format: fmt.id, table, mapping } });
    } else if (msg.type === 'process') {
      const normalized = normalizeTable(msg.table, msg.mapping);
      const prepared = prepareFromNormalized(normalized);
      const detection = detectLaps(prepared, msg.lapOptions);
      post({ id: msg.id, ok: true, result: { normalized, prepared, detection } });
    }
  } catch (e) {
    post({ id: msg.id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
};

function post(r: WorkerResponse) {
  (self as unknown as Worker).postMessage(r);
}
