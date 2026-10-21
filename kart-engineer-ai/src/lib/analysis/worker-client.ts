import type { ColumnMapping } from '../telemetry-parser';
import { autoMapColumns, detectFormat, normalizeTable } from '../telemetry-parser';
import type { RawTable } from '../types';
import type { NormalizedTelemetry } from '../telemetry-parser/normalize';
import type { PreparedTelemetry } from '../telemetry-metrics';
import { detectLaps, prepareFromNormalized, type LapDetectionResult, type LapOptions } from './pipeline';

export interface ParseResult {
  format: 'csv' | 'gpx';
  table: RawTable;
  mapping: ColumnMapping;
}

export interface ProcessResult {
  normalized: NormalizedTelemetry;
  prepared: PreparedTelemetry;
  detection: LapDetectionResult;
}

let worker: Worker | null = null;
let workerBroken = false;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (workerBroken || typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('../../workers/analysis.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev) => {
      const r = ev.data as { id: number; ok: boolean; result?: unknown; error?: string };
      const p = pending.get(r.id);
      if (!p) return;
      pending.delete(r.id);
      if (r.ok) p.resolve(r.result);
      else p.reject(new Error(r.error));
    };
    worker.onerror = () => {
      // Worker indisponível (ex.: ambiente embutido que bloqueia workers de módulo):
      // as chamadas pendentes passam a rodar na thread principal.
      workerBroken = true;
      for (const p of pending.values()) p.reject(new Error('no-worker'));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
    return worker;
  } catch {
    return null;
  }
}

function call<T>(msg: Record<string, unknown>): Promise<T> {
  const w = getWorker();
  if (!w) return Promise.reject(new Error('no-worker'));
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    w.postMessage({ ...msg, id });
  });
}

/** Executa no Web Worker; se indisponível, executa na thread principal. */
export async function parseFile(fileName: string, text: string): Promise<ParseResult> {
  try {
    return await call<ParseResult>({ type: 'parse', fileName, text });
  } catch (e) {
    if ((e as Error).message !== 'no-worker') throw e;
    const fmt = detectFormat(fileName, text.slice(0, 2000));
    const table = fmt.parse(text);
    return { format: fmt.id, table, mapping: autoMapColumns(table) };
  }
}

export async function processTable(table: RawTable, mapping: ColumnMapping, lapOptions: LapOptions): Promise<ProcessResult> {
  try {
    return await call<ProcessResult>({ type: 'process', table, mapping, lapOptions });
  } catch (e) {
    if ((e as Error).message !== 'no-worker') throw e;
    const normalized = normalizeTable(table, mapping);
    const prepared = prepareFromNormalized(normalized);
    return { normalized, prepared, detection: detectLaps(prepared, lapOptions) };
  }
}
