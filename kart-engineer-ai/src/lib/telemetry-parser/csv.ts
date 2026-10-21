import type { RawTable } from '../types';

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

const DELIMITERS = [',', ';', '\t', '|'];

/** Separa o texto em linhas de células, respeitando aspas (RFC 4180). */
export function tokenize(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
    } else if (c === delimiter) {
      row.push(cell.trim());
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows;
}

/** Escolhe o delimitador com contagem mais consistente nas primeiras linhas. */
export function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 60);
  let best = ',';
  let bestScore = -1;
  for (const d of DELIMITERS) {
    const counts = lines.map((l) => l.split(d).length - 1).filter((n) => n > 0);
    if (!counts.length) continue;
    const freq = new Map<number, number>();
    for (const n of counts) freq.set(n, (freq.get(n) ?? 0) + 1);
    const [mode, modeCount] = [...freq.entries()].sort((a, b) => b[1] - a[1])[0];
    const score = modeCount * Math.log2(mode + 1);
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

const NUM_DOT = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
const NUM_COMMA = /^[-+]?\d+(,\d+)?([eE][-+]?\d+)?$/;
const CLOCK = /^\d{1,2}:\d{2}(:\d{2})?([.,]\d+)?$/;
const ISO = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

export function looksNumeric(s: string, decimalComma = false): boolean {
  if (!s) return false;
  return NUM_DOT.test(s) || (decimalComma && NUM_COMMA.test(s)) || CLOCK.test(s) || ISO.test(s);
}

export function parseNumber(s: string, decimalComma: boolean): number {
  if (s === undefined || s === null) return NaN;
  const t = s.trim();
  if (!t) return NaN;
  if (decimalComma) {
    // "1.234,56" (milhar com ponto) e "12,5" (decimal com vírgula).
    const v = /^[-+]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) ? t.replace(/\./g, '') : t;
    return Number(v.replace(',', '.'));
  }
  return NUM_DOT.test(t) ? Number(t) : NaN;
}

function numericRatio(row: string[], decimalComma: boolean): number {
  const filled = row.filter((c) => c !== '');
  if (!filled.length) return 0;
  return filled.filter((c) => looksNumeric(c, decimalComma)).length / filled.length;
}

const UNIT_TOKEN = /^(\[.*\]|\(.*\)|[a-zA-Z°%/²µ#._\-\s]{0,12}|)$/;

/**
 * Lê CSV de telemetria. Suporta delimitadores , ; tab |, vírgula decimal,
 * linhas de metadados antes do cabeçalho (exportações tipo RaceStudio) e
 * uma linha opcional de unidades logo após o cabeçalho.
 */
export function parseCsv(input: string): RawTable {
  const text = input.replace(/^﻿/, '');
  if (!text.trim()) throw new ParseError('O arquivo está vazio.');
  if (/\u0000/.test(text.slice(0, 2000))) throw new ParseError('O arquivo parece ser binário, não um CSV de texto.');

  const delimiter = detectDelimiter(text);
  const all = tokenize(text, delimiter);
  const rows = all.filter((r) => r.some((c) => c !== ''));
  if (rows.length < 2) throw new ParseError('O arquivo precisa ter um cabeçalho e ao menos uma linha de dados.');

  const decimalComma =
    delimiter !== ',' &&
    rows.slice(0, 200).some((r) => r.some((c) => /^[-+]?\d+,\d+$/.test(c)));

  // Cabeçalho: primeira linha com maioria de texto seguida (após possível
  // linha de unidades) por linhas majoritariamente numéricas e de largura compatível.
  let headerIdx = -1;
  let unitsIdx = -1;
  for (let i = 0; i < Math.min(rows.length - 1, 80); i++) {
    const r = rows[i];
    if (r.length < 2 || numericRatio(r, decimalComma) > 0.34) continue;
    let j = i + 1;
    let maybeUnits = -1;
    const next = rows[j];
    if (
      next &&
      numericRatio(next, decimalComma) < 0.34 &&
      next.filter((c) => c !== '').every((c) => UNIT_TOKEN.test(c))
    ) {
      maybeUnits = j;
      j++;
    }
    const probe = rows.slice(j, j + 8);
    if (!probe.length || numericRatio(probe[0], decimalComma) < 0.6) continue;
    const ok = probe.filter(
      (p) => numericRatio(p, decimalComma) >= 0.6 && Math.abs(p.length - r.length) <= 1,
    ).length;
    if (ok >= Math.ceil(probe.length * 0.6)) {
      headerIdx = i;
      unitsIdx = maybeUnits;
      break;
    }
  }
  if (headerIdx < 0) {
    throw new ParseError(
      'Não foi possível identificar a linha de cabeçalho. Verifique se a primeira linha contém nomes de colunas e as seguintes contêm valores numéricos.',
    );
  }

  const headers = rows[headerIdx].map((h, i) => h || `Coluna ${i + 1}`);
  const units = headers.map((_, i) => (unitsIdx >= 0 ? rows[unitsIdx][i] || null : null));
  const dataStart = (unitsIdx >= 0 ? unitsIdx : headerIdx) + 1;
  const data = rows.slice(dataStart).filter((r) => numericRatio(r, decimalComma) > 0);
  if (!data.length) throw new ParseError('Nenhuma linha de dados numéricos foi encontrada após o cabeçalho.');

  return {
    headers,
    units,
    rows: data,
    delimiter,
    decimalComma,
    headerLine: headerIdx,
    preamble: rows.slice(0, headerIdx).map((r) => r.filter(Boolean).join(' ')),
  };
}
