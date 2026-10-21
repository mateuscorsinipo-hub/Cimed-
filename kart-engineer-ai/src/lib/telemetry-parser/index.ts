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

/**
 * Extensões + tipos MIME. Alguns sistemas (iOS, Android, Windows com Excel)
 * rotulam CSV como text/plain, application/vnd.ms-excel ou octet-stream;
 * sem os MIME o seletor de arquivos deixa o CSV desabilitado.
 */
export const ACCEPT_ATTR = [
  ...FORMATS.flatMap((f) => f.extensions.map((e) => `.${e}`)),
  'text/csv',
  'text/plain',
  'text/tab-separated-values',
  'text/comma-separated-values',
  'application/csv',
  'application/vnd.ms-excel',
  'application/gpx+xml',
].join(',');

/**
 * Lê o arquivo detectando a codificação: BOM UTF-16 (Excel "Texto Unicode"),
 * UTF-8 e, se o UTF-8 for inválido, Windows-1252 (CSV salvo pelo Excel em português).
 */
export async function readTextFile(file: Blob): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf);
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf);
  // UTF-16 sem BOM: metade dos bytes iniciais é zero.
  const head = buf.subarray(0, 2000);
  let zeros = 0;
  for (let i = 1; i < head.length; i += 2) if (head[i] === 0) zeros++;
  if (head.length > 20 && zeros > head.length / 4) return new TextDecoder('utf-16le').decode(buf);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

export const MAX_FILE_BYTES = 150 * 1024 * 1024;

export function detectFormat(fileName: string, head: string): FormatParser {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const byExt = FORMATS.find((f) => f.extensions.includes(ext));
  if (byExt) return byExt;
  if (/<gpx[\s>]/i.test(head)) return FORMATS[1];
  if (/[,;\t]/.test(head)) return FORMATS[0];
  throw new ParseError(`Formato ".${ext}" não suportado. Use ${FORMATS.map((f) => f.extensions.join('/')).join(' ou ')}.`);
}
