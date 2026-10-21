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
/** Detecta UTF-16 sem BOM pela posição dos bytes nulos (LE: ímpares; BE: pares). */
function utf16WithoutBom(head: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  if (head.length < 20) return null;
  let odd = 0;
  let even = 0;
  for (let i = 0; i < head.length; i++) if (head[i] === 0) (i % 2 ? odd++ : even++);
  const half = head.length / 2;
  if (odd > half * 0.6 && even < half * 0.1) return 'utf-16le';
  if (even > half * 0.6 && odd < half * 0.1) return 'utf-16be';
  return null;
}

/**
 * Lê o arquivo detectando a codificação: BOM UTF-16 (Excel "Texto Unicode"),
 * UTF-16 sem BOM, UTF-8 e, se o UTF-8 for inválido, Windows-1252 (Excel em português).
 * Bytes nulos isolados (preenchimento deixado por alguns registradores) são removidos.
 */
export async function readTextFile(file: Blob): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let text: string;
  if (buf[0] === 0xff && buf[1] === 0xfe) text = new TextDecoder('utf-16le').decode(buf);
  else if (buf[0] === 0xfe && buf[1] === 0xff) text = new TextDecoder('utf-16be').decode(buf);
  else {
    const enc = utf16WithoutBom(buf.subarray(0, 4000));
    if (enc) text = new TextDecoder(enc).decode(buf);
    else {
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
      } catch {
        text = new TextDecoder('windows-1252').decode(buf);
      }
    }
  }
  return text.replace(/\u0000/g, '');
}

/** Formatos nativos (binários) de equipamentos comuns e como exportar texto a partir deles. */
const NATIVE_FORMATS: { ext: string[]; name: string; how: string }[] = [
  { ext: ['xrk', 'xrz', 'drk', 'gpk'], name: 'AiM (MyChron / Race Studio)', how: 'abra a sessão no Race Studio Analysis e use Arquivo → Exportar → CSV' },
  { ext: ['rcz', 'rcp'], name: 'RaceChrono', how: 'no aplicativo, abra a sessão → Compartilhar/Exportar → CSV (formato v3)' },
  { ext: ['fit'], name: 'Garmin FIT', how: 'exporte a atividade como GPX no Garmin Connect' },
  { ext: ['ld', 'ldx'], name: 'MoTeC', how: 'no MoTeC i2, use Arquivo → Exportar → CSV' },
  { ext: ['vbo', 'dbn'], name: 'Racelogic VBOX', how: 'no Circuit Tools, exporte a sessão em CSV' },
  { ext: ['alf', 'alf2'], name: 'Alfano', how: 'no Alfano Vision, exporte a sessão em CSV' },
  { ext: ['lap', 'tkd'], name: 'equipamento de telemetria', how: 'use a função de exportar CSV do software do fabricante' },
];

/**
 * Identifica arquivos que não são texto, para explicar o que fazer em vez de
 * apenas recusar. Retorna null quando o conteúdo parece texto.
 */
export async function sniffBinary(file: File | Blob, fileName = (file as File).name ?? ''): Promise<string | null> {
  const head = new Uint8Array(await file.slice(0, 4000).arrayBuffer());
  const b = head;
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) {
    return 'Este arquivo é uma planilha do Excel (.xlsx), do Numbers ou um arquivo compactado (.zip), não um CSV. No Excel, use Arquivo → Salvar como → "CSV (separado por vírgulas)"; no Numbers, Arquivo → Exportar para → CSV. Se for .zip, extraia antes.';
  }
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) {
    return 'Este arquivo é uma planilha do Excel antigo (.xls), não um CSV. No Excel, use Salvar como → "CSV (separado por vírgulas)".';
  }
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'Este arquivo é um PDF. Exporte os dados do seu equipamento em CSV ou GPX.';
  if (b[0] === 0x1f && b[1] === 0x8b) return 'Este arquivo está compactado (gzip). Descompacte-o e envie o CSV de dentro.';
  if ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff) || utf16WithoutBom(head)) return null;

  // Texto real quase não tem bytes nulos nem de controle; formatos nativos têm muitos.
  let nul = 0;
  let ctrl = 0;
  for (const x of head) {
    if (x === 0) nul++;
    else if (x < 9 || (x > 13 && x < 32)) ctrl++;
  }
  if ((nul + ctrl) / Math.max(1, head.length) < 0.02) return null;

  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const known = NATIVE_FORMATS.find((f) => f.ext.includes(ext));
  const hex = Array.from(b.subarray(0, 8)).map((x) => x.toString(16).padStart(2, '0')).join(' ');
  const base = known
    ? `"${fileName}" está no formato nativo do ${known.name}, que é binário. Para importar, ${known.how}.`
    : `"${fileName}" não é um arquivo de texto: parece ser o formato nativo (binário) do equipamento ou aplicativo que o gerou. Exporte a sessão em CSV ou GPX pelo software do fabricante.`;
  return `${base} Se o arquivo veio de um aplicativo no celular, procure a opção “Exportar”/“Compartilhar” como CSV — o arquivo “salvo” costuma ser o formato próprio do app. (Identificação: .${ext || 'sem extensão'}, início ${hex}.)`;
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
