import type { Lap, LapSource, StartFinishGate } from '../types';
import { interp } from '../telemetry-metrics/signal';
import { median } from '../telemetry-parser/normalize';

interface Boundary {
  time: number;
}

/** Converte instantes de passagem em voltas. Índices referem-se às amostras dentro da volta. */
export function lapsFromBoundaries(bounds: Boundary[], time: number[], distanceCum: number[] | null): Lap[] {
  const laps: Lap[] = [];
  for (let k = 0; k < bounds.length - 1; k++) {
    const st = bounds[k].time;
    const et = bounds[k + 1].time;
    let startIdx = time.findIndex((x) => x >= st);
    if (startIdx < 0) continue;
    let endIdx = startIdx;
    while (endIdx + 1 < time.length && time[endIdx + 1] <= et) endIdx++;
    if (endIdx <= startIdx) continue;
    const dist = distanceCum ? interp(time, distanceCum, et) - interp(time, distanceCum, st) : NaN;
    laps.push({
      number: laps.length + 1,
      startIdx,
      endIdx,
      startTime: st,
      endTime: et,
      lapTime: et - st,
      distance: dist,
      flagged: false,
      included: true,
    });
  }
  return flagLaps(laps);
}

/** Voltas a partir de uma coluna de identificação de volta. */
export function lapsFromColumn(lapIds: number[], time: number[], distanceCum: number[] | null): Lap[] {
  const bounds: Boundary[] = [];
  let prev = NaN;
  for (let i = 0; i < lapIds.length; i++) {
    const id = lapIds[i];
    if (!Number.isFinite(id)) continue;
    if (id !== prev) {
      // Instante de troca: ponto médio entre a última amostra da volta anterior e a primeira da nova.
      bounds.push({ time: i > 0 ? (time[i - 1] + time[i]) / 2 : time[i] });
      prev = id;
    }
  }
  bounds.push({ time: time[time.length - 1] });
  const laps = lapsFromBoundaries(bounds, time, distanceCum);
  // Primeira e última "voltas" do arquivo costumam ser parciais quando o registrador as marca.
  return laps;
}

/** Cruzamentos da linha de chegada com interpolação linear do instante de passagem. */
export function gateCrossings(x: number[], y: number[], t: number[], gate: StartFinishGate, minInterval = 12): number[] {
  const times: number[] = [];
  const nx = -gate.hy;
  const ny = gate.hx;
  let prevS = NaN;
  for (let i = 0; i < x.length; i++) {
    const s = (x[i] - gate.x) * gate.hx + (y[i] - gate.y) * gate.hy;
    if (i > 0 && Number.isFinite(prevS) && prevS < 0 && s >= 0) {
      const k = -prevS / (s - prevS);
      const cx = x[i - 1] + (x[i] - x[i - 1]) * k;
      const cy = y[i - 1] + (y[i] - y[i - 1]) * k;
      const lateral = Math.abs((cx - gate.x) * nx + (cy - gate.y) * ny);
      if (lateral <= gate.width / 2) {
        const ct = t[i - 1] + (t[i] - t[i - 1]) * k;
        if (!times.length || ct - times[times.length - 1] >= minInterval) times.push(ct);
      }
    }
    prevS = s;
  }
  return times;
}

/** Constrói uma linha de chegada perpendicular à trajetória no índice i. */
export function gateAt(x: number[], y: number[], i: number, span: number, width = 20): StartFinishGate | null {
  const a = Math.max(0, i - span);
  const b = Math.min(x.length - 1, i + span);
  const hx = x[b] - x[a];
  const hy = y[b] - y[a];
  const L = Math.hypot(hx, hy);
  if (!(L > 1)) return null;
  return { x: x[i], y: y[i], hx: hx / L, hy: hy / L, width };
}

/**
 * Escolhe automaticamente a linha de chegada testando candidatos em trechos
 * rápidos e mantendo o que produz mais voltas com tempos coerentes entre si.
 */
export function autoGate(x: number[], y: number[], t: number[], speed: number[] | undefined, sampleRate: number): StartFinishGate | null {
  const n = x.length;
  if (n < 50) return null;
  const span = Math.max(2, Math.round(sampleRate * 0.4));
  const vMed = speed ? median(speed) : 0;
  const cands: { gate: StartFinishGate; laps: number; quality: number }[] = [];
  const tries = 48;
  for (let k = 1; k < tries; k++) {
    const i = Math.floor((n * k) / tries);
    if (speed && !(speed[i] >= vMed)) continue;
    const g = gateAt(x, y, i, span);
    if (!g) continue;
    const c = gateCrossings(x, y, t, g);
    if (c.length < 3) continue;
    const lt = c.slice(1).map((v, j) => v - c[j]);
    const m = median(lt);
    const coherent = lt.filter((v) => Math.abs(v - m) / m < 0.12).length;
    if (coherent < lt.length * 0.6) continue;
    // Prefere trechos retos e rápidos (meio da reta), longe de zonas de frenagem.
    const far = Math.max(span, Math.round(sampleRate * 2));
    const a = Math.max(0, i - far);
    const b = Math.min(n - 1, i + far);
    const h1 = Math.atan2(y[i] - y[a], x[i] - x[a]);
    const h2 = Math.atan2(y[b] - y[i], x[b] - x[i]);
    let turn = Math.abs(h2 - h1);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    cands.push({ gate: g, laps: lt.length, quality: (speed ? speed[i] / 10 : 0) - turn * 6 });
  }
  if (!cands.length) return null;
  const maxLaps = Math.max(...cands.map((c) => c.laps));
  const best = cands.filter((c) => c.laps >= maxLaps - 1).sort((p, q) => q.quality - p.quality)[0];
  return best.gate;
}

export function lapsFromGate(x: number[], y: number[], t: number[], gate: StartFinishGate, distanceCum: number[] | null): Lap[] {
  return lapsFromBoundaries(gateCrossings(x, y, t, gate).map((time) => ({ time })), t, distanceCum);
}

export function lapsFromDistanceResets(resets: number[], t: number[], distanceCum: number[] | null): Lap[] {
  const bounds = resets.map((i) => ({ time: (t[i - 1] + t[i]) / 2 }));
  return lapsFromBoundaries(bounds, t, distanceCum);
}

/** Divide a distância acumulada a cada `length` metros, a partir de `offset`. */
export function lapsFromTrackLength(distanceCum: number[], t: number[], length: number, offset = 0): Lap[] {
  if (!(length > 50)) return [];
  const total = distanceCum[distanceCum.length - 1];
  const bounds: Boundary[] = [];
  for (let d = offset; d <= total; d += length) bounds.push({ time: interp(distanceCum, t, d) });
  return lapsFromBoundaries(bounds, t, distanceCum);
}

/** Voltas a partir de instantes de passagem informados manualmente (s, relativos ao início). */
export function lapsFromManualTimes(times: number[], t: number[], distanceCum: number[] | null): Lap[] {
  const sorted = [...times].filter(Number.isFinite).sort((a, b) => a - b);
  return lapsFromBoundaries(sorted.map((time) => ({ time })), t, distanceCum);
}

/**
 * Marca voltas incoerentes (volta de saída, box, bandeira, interrupção).
 * Elas continuam visíveis, mas ficam fora das estatísticas até o usuário incluí-las.
 */
export function flagLaps(laps: Lap[]): Lap[] {
  if (laps.length < 2) return laps;
  const mt = median(laps.map((l) => l.lapTime));
  const md = median(laps.map((l) => l.distance));
  return laps.map((l) => {
    let reason: string | undefined;
    if (l.lapTime > mt * 1.07) reason = 'Tempo muito acima da mediana (volta de saída, box ou interrupção).';
    else if (l.lapTime < mt * 0.93) reason = 'Tempo muito abaixo da mediana (volta incompleta ou atalho).';
    else if (Number.isFinite(md) && Number.isFinite(l.distance) && Math.abs(l.distance - md) / md > 0.12) {
      reason = 'Distância incoerente com as demais voltas.';
    }
    return { ...l, flagged: !!reason, flagReason: reason, included: !reason };
  });
}

export const LAP_SOURCE_LABEL: Record<LapSource, string> = {
  column: 'Coluna de volta do arquivo',
  'gps-gate': 'Linha de chegada no GPS',
  'distance-reset': 'Reinício da distância do registrador',
  'track-length': 'Comprimento da pista informado',
  manual: 'Tempos de passagem manuais',
};
