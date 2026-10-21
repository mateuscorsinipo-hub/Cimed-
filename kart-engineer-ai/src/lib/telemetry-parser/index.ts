import type { RawTable } from '../types';
import { ParseError, parseCsv } from './csv';
import { parseGpx } from './gpx';

export * from './csv';
export * from './gpx';
export * from './columns';
export * from './normalize';
export * from './units';

export interface FormatParser {
  id: 'csv' | 'gpx';
  label: string;
  extensions: string[];
  parse(text: string): RawTable;
}

/**
 * Registro de formatos. Para adicionar um novo formato (ex.: exportações
 * binárias de registradores), implemente FormatParser e inclua aqui.
 */
export const FORMATS: FormatParser[] = [
  { id: 'csv', label: 'CSV / TXT delimitado', extensions: ['csv', 'txt', 'tsv'], parse: parseCsv },
  { id: 'gpx', label: 'GPX (GPS Exchange)', extensions: ['gpx'], parse: parseGpx },
];

export const ACCEPT_ATTR = FORMATS.flatMap((f) => f.extensions.map((e) => `.${e}`)).join(',');

export const MAX_FILE_BYTES = 150 * 1024 * 1024;

export function detectFormat(fileName: string, head: string): FormatParser {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const byExt = FORMATS.find((f) => f.extensions.includes(ext));
  if (byExt) return byExt;
  if (/<gpx[\s>]/i.test(head)) return FORMATS[1];
  if (/[,;\t]/.test(head)) return FORMATS[0];
  throw new ParseError(`Formato ".${ext}" não suportado. Use ${FORMATS.map((f) => f.extensions.join('/')).join(' ou ')}.`);
}
