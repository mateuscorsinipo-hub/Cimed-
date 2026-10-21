import type { RawTable } from '../types';
import { ParseError } from './csv';

/**
 * Converte GPX (trkpt) em tabela bruta. Implementado sem DOMParser para
 * funcionar também dentro de Web Workers. A velocidade só é incluída quando
 * existe no arquivo (extensões <speed>, em m/s pelo padrão GPX/Garmin).
 */
export function parseGpx(text: string): RawTable {
  if (!/<gpx[\s>]/i.test(text)) throw new ParseError('O arquivo não parece ser um GPX válido (elemento <gpx> ausente).');
  const pts = text.match(/<trkpt\b[^>]*>[\s\S]*?<\/trkpt>|<trkpt\b[^>]*\/>/gi) ?? [];
  if (!pts.length) throw new ParseError('Nenhum ponto de trajeto (<trkpt>) foi encontrado no GPX.');

  const rows: string[][] = [];
  let hasSpeed = false;
  let hasEle = false;
  for (const p of pts) {
    const lat = p.match(/\blat\s*=\s*["']([^"']+)["']/i)?.[1] ?? '';
    const lon = p.match(/\blon\s*=\s*["']([^"']+)["']/i)?.[1] ?? '';
    const time = p.match(/<time>\s*([^<]+?)\s*<\/time>/i)?.[1] ?? '';
    const ele = p.match(/<ele>\s*([^<]+?)\s*<\/ele>/i)?.[1] ?? '';
    const speed = p.match(/<(?:\w+:)?speed>\s*([^<]+?)\s*<\/(?:\w+:)?speed>/i)?.[1] ?? '';
    if (speed) hasSpeed = true;
    if (ele) hasEle = true;
    rows.push([time, lat, lon, speed, ele]);
  }
  if (!rows.some((r) => r[0])) {
    throw new ParseError('O GPX não contém marcações de tempo (<time>). Sem tempo não é possível calcular voltas.');
  }
  const headers = ['time', 'lat', 'lon', 'speed', 'ele'];
  const units: (string | null)[] = [null, 'deg', 'deg', 'm/s', 'm'];
  const keepCols = [0, 1, 2, ...(hasSpeed ? [3] : []), ...(hasEle ? [4] : [])];
  return {
    headers: keepCols.map((i) => headers[i]),
    units: keepCols.map((i) => units[i]),
    rows: rows.map((r) => keepCols.map((i) => r[i])),
    delimiter: ',',
    decimalComma: false,
    headerLine: 0,
    preamble: [],
  };
}
