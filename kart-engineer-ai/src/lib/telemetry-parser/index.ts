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

/**
 * Identifica arquivos que não são texto pelo cabeçalho binário, para explicar
 * o que fazer em vez de apenas recusar. Retorna null quando parece texto.
 */
export async function sniffBinary(file: Blob): Promise<string | null> {
  const b = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) {
    return 'Este arquivo é uma planilha do Excel (.xlsx) ou um arquivo compactado, não um CSV. No Excel, use Arquivo → Salvar como → "CSV (separado por vírgulas)" e envie o arquivo gerado. Se for .zip, extraia antes.';
  }
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) {
    return 'Este arquivo é uma planilha do Excel antigo (.xls), não um CSV. No Excel, use Salvar como → "CSV (separado por vírgulas)".';
  }
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'Este arquivo é um PDF. Exporte os dados do seu equipamento em CSV ou GPX.';
  return null;
}

export const MAX_FILE_BYTES = 150 * 1024 * 1024;

export function detectFormat(fileName: string, head: string): FormatParser {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const byExt = FORMATS.find((f) => f.extensions.includes(ext));
  if (byExt) return byExt;
  if (/<gpx[\s>]/i.test(head)) return FORMATS[1];
  // Extensão desconhecida (ou ausente): decide pelo conteúdo.
  if (/[,;\t|]/.test(head)) return FORMATS[0];
  throw new ParseError(`Não foi possível reconhecer o conteúdo de "${fileName}" como CSV ou GPX: não há colunas separadas por vírgula, ponto e vírgula ou tabulação.`);
}
