/**
 * Relatórios: PDF vetorial gerado no navegador com jsPDF (biblioteca gratuita)
 * e exportações tabulares em CSV. Nada é enviado a servidores.
 */
import type { Session } from '../types';
import type { Diagnostic } from '../diagnostics-engine';
import { compareLaps, segmentStats, includedTraces } from '../lap-comparator';
import type { LapTrace } from '../telemetry-metrics';
import { fmtDate, fmtDelta, fmtLapTime, fmtSpeed } from '../format';
import { CHANNEL_LABELS } from '../telemetry-parser/columns';
import { speedToDisplay } from '../telemetry-parser/units';
import { LAP_SOURCE_LABEL } from '../lap-detector';
import { SEGMENT_SOURCE_LABEL } from '../track-map/corners';
import { dataLimitations, type DiagnosticContext } from '../diagnostics-engine';

export const DISCLAIMER =
  'As análises são auxiliares e baseadas exclusivamente nos dados importados. Não garantem ganho de desempenho. Pratique alterações de forma gradual e segura.';

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function safeFileName(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'sessao';
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v)) ? '' : String(v);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: unknown[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}

export function lapsCsv(session: Session): string {
  return toCsv([
    ['volta', 'tempo_s', 'distancia_m', 'incluida', 'suspeita', 'motivo', 'referencia'],
    ...session.laps.map((l) => [l.number, l.lapTime.toFixed(3), Number.isFinite(l.distance) ? l.distance.toFixed(1) : '', l.included ? 1 : 0, l.flagged ? 1 : 0, l.flagReason ?? '', l.number === session.referenceLap ? 1 : 0]),
  ]);
}

export function segmentsCsv(session: Session, traces: Map<number, LapTrace>): string {
  const inc = includedTraces(traces, session.laps);
  const header = ['segmento', 'tipo', 'inicio_frac', 'fim_frac', ...inc.map((t) => `volta_${t.lapNumber}_s`), 'melhor_s', 'media_s', 'desvio_s'];
  const stats = segmentStats(inc, session.segments);
  return toCsv([
    header,
    ...stats.map((s) => [
      s.segment.name,
      s.segment.kind === 'corner' ? 'curva' : 'reta',
      s.segment.start.toFixed(4),
      s.segment.end.toFixed(4),
      ...s.times.map((t) => t.time.toFixed(3)),
      s.best.toFixed(3),
      s.mean.toFixed(3),
      Number.isFinite(s.std) ? s.std.toFixed(4) : '',
    ]),
  ]);
}

/** Canais normalizados (unidades SI) com a volta de cada amostra. */
export function telemetryCsv(session: Session): string {
  const keys = (Object.keys(session.channels) as (keyof typeof session.channels)[]).filter((k) => Array.isArray(session.channels[k]));
  const unit: Record<string, string> = { time: 's', distance: 'm', lat: 'deg', lon: 'deg', speed: 'm/s', accelLong: 'g', accelLat: 'g', rpm: 'rpm', throttle: '%', brake: 'orig', steering: 'deg', lap: 'id' };
  const lapOf = new Array<number | ''>(session.channels.time.length).fill('');
  for (const l of session.laps) for (let i = l.startIdx; i <= l.endIdx; i++) lapOf[i] = l.number;
  const rows: unknown[][] = [[...keys.map((k) => `${k}_${unit[k] ?? ''}`), 'volta_detectada']];
  for (let i = 0; i < session.channels.time.length; i++) {
    rows.push([...keys.map((k) => {
      const v = session.channels[k]![i];
      return Number.isFinite(v) ? +v.toFixed(6) : '';
    }), lapOf[i]]);
  }
  return toCsv(rows);
}

/* ---------------------------------- PDF ---------------------------------- */

/** As fontes padrão do PDF usam WinAnsi; substitui símbolos fora desse conjunto. */
export function pdfText(s: string): string {
  return s
    .replace(/−/g, '-')
    .replace(/→/g, '->')
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/×/g, 'x')
    .replace(/[—–]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, '...')
    .replace(/±/g, '+/-')
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '');
}

interface ReportInput {
  session: Session;
  traces: Map<number, LapTrace>;
  diagnostics: Diagnostic[];
  ctx: DiagnosticContext | null;
  speedUnit: 'kmh' | 'mph';
}

export async function generatePdf({ session, traces, diagnostics, ctx, speedUnit }: ReportInput): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210;
  const M = 14;
  const CW = W - 2 * M;
  let y = M;
  const ink: [number, number, number] = [20, 22, 26];
  const muted: [number, number, number] = [100, 106, 118];
  const green: [number, number, number] = [110, 150, 10];
  const red: [number, number, number] = [210, 50, 50];
  const blue: [number, number, number] = [40, 120, 210];

  const ensure = (h: number) => {
    if (y + h > 285) {
      doc.addPage();
      y = M;
    }
  };
  const text = (s: string, size = 10, color = ink, style: 'normal' | 'bold' = 'normal', x = M, width = CW) => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(pdfText(s), width) as string[];
    const lh = size * 0.42;
    ensure(lines.length * lh);
    doc.text(lines, x, y + lh * 0.8);
    y += lines.length * lh + 1;
  };
  /** `need`: altura do conteúdo que segue, para não deixar o título sozinho no fim da página. */
  const heading = (s: string, need = 14) => {
    ensure(need);
    y += 3;
    doc.setDrawColor(200, 204, 210);
    doc.line(M, y, W - M, y);
    y += 3;
    text(s.toUpperCase(), 11, ink, 'bold');
    y += 1;
  };

  // Cabeçalho
  doc.setFillColor(11, 12, 15);
  doc.rect(0, 0, W, 30, 'F');
  doc.setTextColor(242, 244, 247);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('KART ENGINEER AI', M, 13);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(pdfText(`Relatório de sessão · gerado em ${fmtDate(Date.now())}`), M, 20);
  doc.setFillColor(198, 244, 50);
  doc.rect(M, 25, 30, 1.2, 'F');
  y = 38;
  text(session.name, 15, ink, 'bold');
  text(`${session.trackName || 'Pista não informada'} · ${fmtDate(session.createdAt)} · arquivo ${session.source.fileName}`, 9, muted);
  if (session.isDemo) text('DADOS DEMONSTRATIVOS SINTÉTICOS - pista fictícia; não representam piloto ou pista reais.', 9, red, 'bold');

  // Resumo
  heading('Resumo geral');
  const s = session.summary;
  const kpis: [string, string][] = [
    ['Melhor volta', `${fmtLapTime(s.bestLapTime)} (V${s.bestLapNumber ?? '-'})`],
    ['Média', fmtLapTime(s.meanLapTime)],
    ['Voltas válidas', `${s.validLapCount} de ${s.lapCount}`],
    ['Desvio-padrão', s.consistencyStd !== null ? `${s.consistencyStd.toFixed(3)} s` : '-'],
    ['Velocidade máxima', fmtSpeed(s.maxSpeed, speedUnit)],
    ['Soma melhores segmentos', fmtLapTime(s.theoreticalBest)],
  ];
  const colW = CW / 3;
  kpis.forEach(([k, v], i) => {
    const cx = M + (i % 3) * colW;
    const cy = y + Math.floor(i / 3) * 13;
    doc.setFontSize(8);
    doc.setTextColor(...muted);
    doc.setFont('helvetica', 'normal');
    doc.text(pdfText(k), cx, cy + 4);
    doc.setFontSize(12);
    doc.setTextColor(...ink);
    doc.setFont('helvetica', 'bold');
    doc.text(pdfText(v), cx, cy + 10);
  });
  y += 28;
  text(`Detecção de voltas: ${LAP_SOURCE_LABEL[session.lapSource]}. Segmentos: ${session.segments[0] ? SEGMENT_SOURCE_LABEL[session.segments[0].source] : '-'}. Amostragem: ${session.sampleRate.toFixed(1)} Hz.`, 8.5, muted);
  const chs = (Object.keys(session.channels) as (keyof typeof CHANNEL_LABELS)[]).filter((k) => session.channels[k]);
  text(`Canais: ${chs.map((k) => `${CHANNEL_LABELS[k]}${session.origins[k] === 'derived' ? ' (derivado)' : ''}`).join(', ')}.`, 8.5, muted);

  // Voltas
  heading('Voltas');
  const best = s.bestLapTime ?? 0;
  doc.setFontSize(8.5);
  const cols = [M, M + 18, M + 50, M + 82, M + 110];
  const head = ['Volta', 'Tempo', 'Dif. melhor', 'Distância', 'Status'];
  ensure(6);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...muted);
  head.forEach((h, i) => doc.text(h, cols[i], y + 3));
  y += 5;
  doc.setFont('helvetica', 'normal');
  for (const l of session.laps) {
    ensure(5);
    doc.setTextColor(...(l.number === session.referenceLap ? green : ink));
    const st = l.number === session.referenceLap ? 'Referência' : l.included ? 'Válida' : l.flagged ? 'Suspeita (excluída)' : 'Excluída';
    [String(l.number), fmtLapTime(l.lapTime), l.included ? fmtDelta(l.lapTime - best) : '-', Number.isFinite(l.distance) ? `${l.distance.toFixed(0)} m` : '-', st].forEach((v, i) =>
      doc.text(pdfText(v), cols[i], y + 3),
    );
    y += 4.6;
  }

  // Gráfico de velocidade e delta
  const ref = session.referenceLap !== null ? traces.get(session.referenceLap) : undefined;
  const second = [...session.laps].filter((l) => l.included && l.number !== session.referenceLap).sort((a, b) => a.lapTime - b.lapTime)[0];
  const cmpTrace = second ? traces.get(second.number) : undefined;
  if (ref) {
    heading('Velocidade x distância', 95);
    text(`Volta ${ref.lapNumber} (referência, verde)${cmpTrace ? ` x volta ${cmpTrace.lapNumber} (azul)` : ''}. Eixo x em metros pela distância da referência.`, 8.5, muted);
    const h = 52;
    ensure(h + 30);
    const x0 = M + 10;
    const w = CW - 10;
    const y0 = y;
    const all = [...ref.speed, ...(cmpTrace?.speed ?? [])].filter(Number.isFinite).map((v) => speedToDisplay(v, speedUnit));
    const vmin = Math.floor(Math.min(...all) / 10) * 10;
    const vmax = Math.ceil(Math.max(...all) / 10) * 10;
    doc.setDrawColor(225, 228, 232);
    doc.setFontSize(7);
    doc.setTextColor(...muted);
    for (let v = vmin; v <= vmax; v += 10) {
      const yy = y0 + h - ((v - vmin) / (vmax - vmin)) * h;
      doc.line(x0, yy, x0 + w, yy);
      doc.text(String(v), M, yy + 1);
    }
    const plot = (tr: LapTrace, color: [number, number, number]) => {
      doc.setDrawColor(...color);
      doc.setLineWidth(0.35);
      const n = tr.frac.length;
      const step = Math.max(1, Math.floor(n / 400));
      let prev: [number, number] | null = null;
      for (let i = 0; i < n; i += step) {
        const v = speedToDisplay(tr.speed[i], speedUnit);
        if (!Number.isFinite(v)) continue;
        const p: [number, number] = [x0 + tr.frac[i] * w, y0 + h - ((v - vmin) / (vmax - vmin)) * h];
        if (prev) doc.line(prev[0], prev[1], p[0], p[1]);
        prev = p;
      }
    };
    if (cmpTrace) plot(cmpTrace, blue);
    plot(ref, green);
    for (const seg of session.segments.filter((g) => g.kind === 'corner')) {
      doc.setTextColor(...muted);
      doc.text(pdfText(seg.name.replace('Curva ', 'C')), x0 + (seg.apex ?? seg.start) * w - 2, y0 + h + 4);
    }
    y = y0 + h + 7;
    if (cmpTrace) {
      const cmp = compareLaps(ref, cmpTrace, session.segments);
      const dh = 22;
      const md = Math.max(0.05, ...cmp.delta.map(Math.abs).filter(Number.isFinite));
      const yc = y + dh / 2;
      doc.setDrawColor(200, 204, 210);
      doc.setLineWidth(0.2);
      doc.line(x0, yc, x0 + w, yc);
      doc.setFontSize(7);
      doc.setTextColor(...muted);
      doc.text(pdfText(`Diferença acumulada (V${cmpTrace.lapNumber} - V${ref.lapNumber}), +/-${md.toFixed(2)} s`), x0, y + 1);
      doc.setLineWidth(0.35);
      let prev: [number, number] | null = null;
      const step = Math.max(1, Math.floor(cmp.delta.length / 400));
      for (let i = 0; i < cmp.delta.length; i += step) {
        const p: [number, number] = [x0 + ref.frac[i] * w, yc - (cmp.delta[i] / md) * (dh / 2)];
        if (prev) {
          doc.setDrawColor(...(cmp.delta[i] > 0 ? red : green));
          doc.line(prev[0], prev[1], p[0], p[1]);
        }
        prev = p;
      }
      y += dh + 4;
    }
  }

  // Mapa
  if (ref?.x && ref.y) {
    heading('Mapa do circuito (trajetória GPS da referência)', 90);
    const size = 70;
    ensure(size + 6);
    const xs = ref.x.filter(Number.isFinite);
    const ys = ref.y.filter(Number.isFinite);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const sc = size / Math.max(maxX - minX, maxY - minY);
    const ox = M + (CW - (maxX - minX) * sc) / 2;
    const oy = y + size;
    const vs = ref.speed.filter(Number.isFinite);
    const vmin = Math.min(...vs);
    const vmax = Math.max(...vs);
    doc.setLineWidth(0.9);
    for (let i = 1; i < ref.x.length; i += 2) {
      const k = (ref.speed[i] - vmin) / (vmax - vmin || 1);
      doc.setDrawColor(Math.round(220 - 120 * k), Math.round(60 + 170 * k), 50);
      doc.line(ox + (ref.x[i - 1] - minX) * sc, oy - (ref.y[i - 1] - minY) * sc, ox + (ref.x[i] - minX) * sc, oy - (ref.y[i] - minY) * sc);
    }
    doc.setFontSize(7);
    doc.setTextColor(...ink);
    for (const seg of session.segments.filter((g) => g.kind === 'corner')) {
      const i = Math.round((seg.apex ?? seg.start) * (ref.x.length - 1));
      doc.text(pdfText(seg.name.replace('Curva ', '')), ox + (ref.x[i] - minX) * sc + 1.5, oy - (ref.y[i] - minY) * sc - 1.5);
    }
    doc.setFillColor(...ink);
    doc.circle(ox + (ref.x[0] - minX) * sc, oy - (ref.y[0] - minY) * sc, 1.2, 'F');
    y += size + 4;
    text('Cor: vermelho = mais lento, verde = mais rápido. Ponto preto = linha de chegada. A precisão depende do receptor GPS.', 8, muted);
  }

  // Segmentos
  const inc = includedTraces(traces, session.laps);
  if (inc.length && session.segments.length) {
    heading('Segmentos');
    const st = segmentStats(inc, session.segments);
    const c2 = [M, M + 52, M + 80, M + 108, M + 136, M + 160];
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...muted);
    ['Segmento', 'Referência', 'Melhor', 'Média', 'Desvio', 'Melhor em'].forEach((h, i) => doc.text(h, c2[i], y + 3));
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...ink);
    for (const r of st) {
      ensure(5);
      const refT = r.times.find((t) => t.lap === session.referenceLap)?.time;
      [r.segment.name, refT !== undefined ? `${refT.toFixed(3)} s` : '-', `${r.best.toFixed(3)} s`, `${r.mean.toFixed(3)} s`, Number.isFinite(r.std) ? `${r.std.toFixed(3)} s` : '-', `V${r.bestLap}`].forEach((v, i) =>
        doc.text(pdfText(v), c2[i], y + 3),
      );
      y += 4.6;
    }
  }

  // Diagnósticos
  heading('Diagnósticos e recomendações prioritárias');
  const diags = diagnostics.filter((d) => d.rule !== 'data-quality');
  if (!diags.length) text('Nenhum diagnóstico atende aos critérios das regras para esta sessão.', 9, muted);
  diags.slice(0, 10).forEach((d, i) => {
    ensure(30);
    text(`${i + 1}. ${d.title}`, 10, d.tone === 'loss' ? red : d.tone === 'gain' ? green : ink, 'bold');
    for (const e of d.evidence) text(`• ${e.label}: ${e.value} [${e.kind === 'measured' ? 'medição' : e.kind === 'estimated' ? 'estimativa' : 'cálculo'}]`, 8.5, ink, 'normal', M + 3, CW - 3);
    text(`Interpretação: ${d.interpretation}`, 8.5, ink, 'normal', M + 3, CW - 3);
    if (d.hypothesis) text(d.hypothesis, 8.5, muted, 'normal', M + 3, CW - 3);
    text(`Teste recomendado: ${d.recommendation}`, 8.5, ink, 'normal', M + 3, CW - 3);
    text(`Confiança: ${d.confidence}. ${d.confidenceReason}`, 8, muted, 'normal', M + 3, CW - 3);
    if (d.limitations.length) text(`Limitações: ${d.limitations.join(' ')}`, 8, muted, 'normal', M + 3, CW - 3);
    y += 2;
  });

  heading('Limitações dos dados');
  const lim = [...(ctx ? dataLimitations(ctx) : []), ...session.warnings];
  if (!lim.length) text('Nenhuma limitação relevante identificada além das inerentes à medição.', 9, muted);
  lim.forEach((l) => text(`• ${l}`, 8.5, ink));

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(7);
    doc.setTextColor(...muted);
    doc.setFont('helvetica', 'normal');
    doc.text(pdfText(DISCLAIMER), M, 292, { maxWidth: CW - 20 });
    doc.text(`${p}/${pages}`, W - M, 292, { align: 'right' });
  }
  return doc.output('blob');
}
