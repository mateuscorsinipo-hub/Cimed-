import { describe, expect, it } from 'vitest';
import { autoMapColumns, normalizeTable, parseCsv, parseGpx, ParseError, detectDelimiter, toInternal, parseClock } from '../telemetry-parser';

describe('parseCsv', () => {
  it('lê CSV com vírgula e cabeçalho simples', () => {
    const t = parseCsv('time,speed\n0,10\n0.1,11\n0.2,12\n');
    expect(t.headers).toEqual(['time', 'speed']);
    expect(t.rows).toHaveLength(3);
    expect(t.decimalComma).toBe(false);
  });

  it('detecta ponto e vírgula, vírgula decimal, metadados e linha de unidades', () => {
    const text = 'Format;AiM CSV\nVenue;Teste\n\nTime;Speed;Lap\ns;km/h;#\n0,00;10,5;1\n0,10;11,5;1\n0,20;12,5;1\n0,30;13,5;1';
    const t = parseCsv(text);
    expect(t.delimiter).toBe(';');
    expect(t.decimalComma).toBe(true);
    expect(t.headers).toEqual(['Time', 'Speed', 'Lap']);
    expect(t.units).toEqual(['s', 'km/h', '#']);
    expect(t.preamble.length).toBe(2);
    const m = autoMapColumns(t);
    expect(m.speed?.unit).toBe('kmh');
    expect(m.speed?.unitInferred).toBe(false);
  });

  it('respeita aspas com delimitador interno', () => {
    const t = parseCsv('"name, x",time,speed\n"a, b",0,1\n"c",1,2\n"d",2,3');
    expect(t.rows[0][0]).toBe('a, b');
  });

  it('rejeita arquivo vazio e sem dados numéricos', () => {
    expect(() => parseCsv('')).toThrow(ParseError);
    expect(() => parseCsv('a,b\nx,y\nz,w')).toThrow(ParseError);
  });

  it('detecta tabulação', () => {
    expect(detectDelimiter('a\tb\tc\n1\t2\t3\n4\t5\t6')).toBe('\t');
  });
});

describe('unidades', () => {
  it('converte velocidade, tempo, distância e aceleração', () => {
    expect(toInternal('speed', 'kmh', 36)).toBeCloseTo(10);
    expect(toInternal('speed', 'mph', 10)).toBeCloseTo(4.4704);
    expect(toInternal('time', 'ms', 1500)).toBeCloseTo(1.5);
    expect(toInternal('distance', 'km', 1.2)).toBeCloseTo(1200);
    expect(toInternal('accelLat', 'ms2', 9.80665)).toBeCloseTo(1);
    expect(toInternal('throttle', 'frac', 0.5)).toBe(50);
    expect(parseClock('1:02.500')).toBeCloseTo(62.5);
    expect(parseClock('01:00:01')).toBe(3601);
  });

  it('infere m/s quando os valores são baixos e km/h quando altos', () => {
    const ms = autoMapColumns(parseCsv('time,speed\n0,5\n1,20\n2,28'));
    expect(ms.speed?.unit).toBe('ms');
    expect(ms.speed?.unitInferred).toBe(true);
    const kmh = autoMapColumns(parseCsv('time,speed\n0,50\n1,90\n2,100'));
    expect(kmh.speed?.unit).toBe('kmh');
  });
});

describe('normalizeTable', () => {
  it('descarta timestamps duplicados e regressivos e relata no resumo', () => {
    const rows = ['time,speed', '0,10', '0.1,10', '0.1,11', '0.2,12', '0.15,99', ...Array.from({ length: 20 }, (_, i) => `${0.3 + i * 0.1},${12 + i}`)];
    const t = parseCsv(rows.join('\n'));
    const n = normalizeTable(t, autoMapColumns(t));
    expect(n.report.duplicateTimestamps).toBe(1);
    expect(n.report.backwardTimestamps).toBe(1);
    expect(n.channels.time[0]).toBe(0);
    expect(n.channels.speed!.every(Number.isFinite)).toBe(true);
    expect(Math.round(n.report.sampleRate)).toBe(10);
  });

  it('marca valores fora da faixa física como ausentes', () => {
    const t = parseCsv(['time,speed', ...Array.from({ length: 20 }, (_, i) => `${i * 0.1},${i === 5 ? 900 : 20}`)].join('\n'));
    const m = autoMapColumns(t);
    m.speed = { column: 1, unit: 'ms', unitInferred: false };
    const n = normalizeTable(t, m);
    expect(Number.isNaN(n.channels.speed![5])).toBe(true);
    expect(n.report.channels.find((c) => c.channel === 'speed')!.outOfRange).toBe(1);
  });

  it('exige coluna de tempo', () => {
    const t = parseCsv('a,speed\n0,1\n1,2');
    expect(() => normalizeTable(t, { speed: { column: 1, unit: 'ms', unitInferred: false } })).toThrow(/timestamp/);
  });

  it('não cria canais de acelerador, freio ou direção que não existem', () => {
    const t = parseCsv(['time,speed', ...Array.from({ length: 30 }, (_, i) => `${i * 0.1},20`)].join('\n'));
    const n = normalizeTable(t, autoMapColumns(t));
    expect(n.channels.throttle).toBeUndefined();
    expect(n.channels.brake).toBeUndefined();
    expect(n.channels.steering).toBeUndefined();
  });

  it('converte tempo que reinicia a cada volta em tempo acumulado', () => {
    const lines = ['time,lap,speed'];
    for (let lap = 1; lap <= 3; lap++) for (let i = 0; i < 10; i++) lines.push(`${i},${lap},20`);
    const t = parseCsv(lines.join('\n'));
    const n = normalizeTable(t, autoMapColumns(t));
    const time = n.channels.time;
    for (let i = 1; i < time.length; i++) expect(time[i]).toBeGreaterThan(time[i - 1]);
  });
});

describe('parseGpx', () => {
  const gpx = `<?xml version="1.0"?><gpx version="1.1"><trk><trkseg>
    <trkpt lat="-23.5" lon="-46.6"><time>2024-01-01T10:00:00.000Z</time><extensions><gpxtpx:speed>10</gpxtpx:speed></extensions></trkpt>
    <trkpt lat="-23.5001" lon="-46.6"><time>2024-01-01T10:00:00.500Z</time><extensions><gpxtpx:speed>11</gpxtpx:speed></extensions></trkpt>
  </trkseg></trk></gpx>`;
  it('extrai tempo, coordenadas e velocidade', () => {
    const t = parseGpx(gpx);
    expect(t.headers).toEqual(['time', 'lat', 'lon', 'speed']);
    const m = autoMapColumns(t);
    expect(m.time?.unit).toBe('iso');
    expect(m.speed?.unit).toBe('ms');
  });
  it('rejeita GPX sem tempo', () => {
    expect(() => parseGpx('<gpx><trk><trkseg><trkpt lat="1" lon="2"></trkpt></trkseg></trk></gpx>')).toThrow(/tempo/);
  });
  it('rejeita arquivo que não é GPX', () => {
    expect(() => parseGpx('hello')).toThrow(ParseError);
  });
});

describe('codificação e formatos de número', () => {
  it('lê CSV em UTF-16 (Excel "Texto Unicode") e Windows-1252', async () => {
    const { readTextFile } = await import('../telemetry-parser');
    const text = 'Tempo;Velocidade\n0;10\n';
    const u16 = new Uint8Array(2 + text.length * 2);
    u16[0] = 0xff;
    u16[1] = 0xfe;
    for (let i = 0; i < text.length; i++) u16[2 + i * 2] = text.charCodeAt(i);
    expect(await readTextFile(new Blob([u16]))).toBe(text);
    const latin = new Uint8Array([0x44, 0x69, 0x73, 0x74, 0xe2, 0x6e, 0x63, 0x69, 0x61]); // "Distância" em 1252
    expect(await readTextFile(new Blob([latin]))).toBe('Distância');
  });

  it('aceita milhar com ponto quando o decimal é vírgula', async () => {
    const { parseNumber } = await import('../telemetry-parser');
    expect(parseNumber('1.234,5', true)).toBeCloseTo(1234.5);
    expect(parseNumber('12,5', true)).toBeCloseTo(12.5);
  });

  it('aceita CSV com BOM, CRLF e separador por tabulação', () => {
    const t = parseCsv('﻿Time\tSpeed\r\n0\t10\r\n0.1\t11\r\n0.2\t12\r\n');
    expect(t.headers).toEqual(['Time', 'Speed']);
    expect(t.rows).toHaveLength(3);
  });
});

describe('arquivos binários', () => {
  it('reconhece formato nativo e explica como exportar', async () => {
    const { sniffBinary } = await import('../telemetry-parser');
    const bytes = new Uint8Array(500).map((_, i) => (i % 3 === 0 ? 0 : (i * 37) % 256));
    const msg = await sniffBinary(new Blob([bytes]), 'sessao.xrk');
    expect(msg).toMatch(/AiM/);
    expect(msg).toMatch(/Exportar/);
    expect(await sniffBinary(new Blob(['time,speed\n0,1\n']), 'a.csv')).toBeNull();
  });

  it('lê UTF-16 big-endian sem BOM e remove bytes nulos soltos', async () => {
    const { readTextFile, sniffBinary } = await import('../telemetry-parser');
    const text = 'time;speed\n0;10\n0.1;11\n';
    const be = new Uint8Array(text.length * 2);
    for (let i = 0; i < text.length; i++) be[i * 2 + 1] = text.charCodeAt(i);
    expect(await sniffBinary(new Blob([be]), 'x.csv')).toBeNull();
    expect(await readTextFile(new Blob([be]))).toBe(text);
    expect(await readTextFile(new Blob(['a,b\n1,2\n\u0000\u0000']))).toBe('a,b\n1,2\n');
  });
});
