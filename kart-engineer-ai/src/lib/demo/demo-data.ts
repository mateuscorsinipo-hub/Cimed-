/**
 * DADOS DEMONSTRATIVOS SINTÉTICOS.
 * Pista fictícia ("Circuito Demonstrativo") e voltas geradas por um modelo
 * físico simplificado. Não representam nenhuma pista real, piloto ou resultado.
 */
import type { XY } from '../types';
import { catmullRomClosed, curvature, resamplePolyline } from '../track-map/geometry';
import { gaussian, movingAverage, seededRandom } from '../telemetry-metrics/signal';

export const DEMO_TRACK_NAME = 'Circuito Demonstrativo (fictício)';
export const DEMO_SESSION_NAME = 'Sessão demonstrativa';

const CONTROL: XY[] = [
  { x: 0, y: 0 }, { x: 170, y: 0 }, { x: 205, y: 8 }, { x: 215, y: 32 }, { x: 200, y: 52 },
  { x: 170, y: 55 }, { x: 120, y: 50 }, { x: 95, y: 62 }, { x: 100, y: 88 }, { x: 130, y: 105 },
  { x: 175, y: 110 }, { x: 215, y: 125 }, { x: 225, y: 155 }, { x: 205, y: 180 }, { x: 160, y: 182 },
  { x: 120, y: 165 }, { x: 85, y: 175 }, { x: 50, y: 195 }, { x: 10, y: 190 }, { x: -25, y: 165 },
  { x: -30, y: 120 }, { x: -10, y: 95 }, { x: -25, y: 60 }, { x: -30, y: 25 }, { x: -15, y: 5 },
];

const G = 9.80665;

export interface DemoTrack {
  points: XY[];
  kappa: number[];
  length: number;
  /** Zonas de curva (índices) usadas para variar o comportamento do piloto simulado. */
  corners: { start: number; end: number; apex: number }[];
}

export function demoTrack(): DemoTrack {
  const pts = resamplePolyline(catmullRomClosed(CONTROL, 24), 1);
  // Curvatura calculada com o traçado "enrolado" para não criar artefato na linha de chegada.
  const pad = 12;
  const loop = pts.slice(0, -1);
  const ext = [...loop.slice(-pad), ...loop, ...loop.slice(0, pad + 1)];
  const k = movingAverage(curvature(ext, 4), 7).slice(pad, pad + pts.length);
  const corners: DemoTrack['corners'] = [];
  let i = 0;
  while (i < k.length) {
    if (Math.abs(k[i]) < 1 / 60) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < k.length && Math.abs(k[j + 1]) >= 1 / 60) j++;
    if (j - i > 5) {
      let apex = i;
      for (let q = i; q <= j; q++) if (Math.abs(k[q]) > Math.abs(k[apex])) apex = q;
      corners.push({ start: i, end: j, apex });
    }
    i = j + 1;
  }
  return { points: pts, kappa: k, length: pts.length - 1, corners };
}

interface DriverLap {
  grip: number[];
  brakeFactor: number[];
  throttleDelay: number[];
  lineOffset: number[];
  global: number;
  /** Volta de retorno: o ritmo cai gradualmente ao longo da volta, não desde a largada. */
  ramp?: boolean;
}

/** Perfil de velocidade periódico (m/s) com limites de aderência, tração e frenagem. */
function speedProfile(track: DemoTrack, d: DriverLap): { v: number[]; mode: number[] } {
  const n = track.points.length;
  const factor = (i: number) => (d.ramp ? 1 - (1 - d.global) * Math.min(1, (i % n) / (0.5 * n)) : d.global);
  const vTop = 30.5;
  const cornerOf = new Array<number>(n).fill(-1);
  track.corners.forEach((c, ci) => {
    for (let i = Math.max(0, c.start - 40); i <= Math.min(n - 1, c.end + 30); i++) cornerOf[i] = ci;
  });
  const vLim = track.kappa.map((k, i) => {
    const ci = cornerOf[i];
    const g = ci >= 0 ? d.grip[ci] : 1;
    return Math.min(vTop, Math.sqrt((1.85 * G * factor(i) * g) / Math.max(Math.abs(k), 1e-4)));
  });
  // Atraso de aceleração: o piloto segura a velocidade por alguns metros após o ápice.
  const hold = new Array<boolean>(n).fill(false);
  track.corners.forEach((c, ci) => {
    for (let i = c.apex; i < Math.min(n, c.apex + d.throttleDelay[ci]); i++) hold[i] = true;
  });
  const v = new Array<number>(2 * n);
  const mode = new Array<number>(2 * n).fill(0);
  v[0] = 18;
  for (let i = 1; i < 2 * n; i++) {
    const p = v[i - 1];
    const lim = vLim[i % n];
    const acc = 0.62 * G * factor(i) * (1 - (p / (vTop + 1.5)) ** 2);
    const next = hold[i % n] ? p : Math.sqrt(p * p + 2 * acc * 1);
    v[i] = Math.min(lim, next);
    mode[i] = hold[i % n] ? 2 : next <= lim ? 1 : 2;
  }
  for (let i = 2 * n - 2; i >= 0; i--) {
    const ci = cornerOf[(i + 1) % n];
    const bf = ci >= 0 ? d.brakeFactor[ci] : 1;
    const brk = 1.3 * G * bf;
    const lim = Math.sqrt(v[i + 1] ** 2 + 2 * brk * 1);
    if (v[i] > lim) {
      v[i] = lim;
      mode[i] = -1;
    }
  }
  return { v: v.slice(n), mode: mode.slice(n) };
}

function driverLaps(track: DemoTrack, seed: number): DriverLap[] {
  const rand = seededRandom(seed);
  const nc = track.corners.length;
  const laps: DriverLap[] = [];
  const total = 9;
  for (let l = 0; l < total; l++) {
    const grip = Array.from({ length: nc }, () => 0.955 + rand() * 0.04);
    const brakeFactor = Array.from({ length: nc }, () => 0.93 + rand() * 0.07);
    const throttleDelay = Array.from({ length: nc }, () => Math.round(rand() * 3));
    const lineOffset = Array.from({ length: nc }, () => gaussian(rand) * 0.4);
    let global = 0.995 + rand() * 0.01;
    let ramp = false;
    if (l === 0) global = 0.62; // volta de saída
    if (l === total - 1) {
      global = 0.6; // volta de retorno ao box
      ramp = true;
    }
    if (l === 4) {
      // Volta mais limpa da sessão.
      for (let c = 0; c < nc; c++) {
        grip[c] = 0.99 + rand() * 0.01;
        brakeFactor[c] = 0.99;
        throttleDelay[c] = 0;
      }
    }
    if (nc > 2 && (l === 2 || l === 5)) {
      // Curva 3: freia antes e demora a acelerar, com entrada mais fechada.
      brakeFactor[2] = 0.72;
      throttleDelay[2] = 9;
      grip[2] = 0.93;
      lineOffset[2] = -2.4;
    }
    if (nc > 4) grip[4] = 0.9 + rand() * 0.1; // Curva 5 inconsistente
    laps.push({ grip, brakeFactor, throttleDelay, lineOffset, global, ramp });
  }
  return laps;
}

const LAT0 = -10.0;
const LON0 = -30.0;

/** Gera o CSV demonstrativo completo (20 Hz) no mesmo formato aceito pela importação. */
export function generateDemoCsv(seed = 7): string {
  const track = demoTrack();
  const n = track.points.length;
  const rand = seededRandom(seed * 31 + 1);
  const laps = driverLaps(track, seed);
  const kx = Math.cos((LAT0 * Math.PI) / 180) * 6371008.8 * (Math.PI / 180);
  const ky = 6371008.8 * (Math.PI / 180);

  // Normal à esquerda de cada ponto, para deslocar a trajetória (linha do piloto).
  const normals = track.points.map((_, i) => {
    const a = track.points[Math.max(0, i - 2)];
    const b = track.points[Math.min(n - 1, i + 2)];
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: -(b.y - a.y) / L, y: (b.x - a.x) / L };
  });

  const header = 'Time [s];Latitude;Longitude;GPS Speed [km/h];LonAcc [g];LatAcc [g];RPM;Throttle [%];Brake Pressure [bar];Steering [deg]';
  const lines: string[] = [
    'Format;Kart Engineer AI demo CSV',
    'Session;DADOS SINTÉTICOS - pista fictícia, não representa pista real',
    'Sample Rate;20 Hz',
    '',
    header,
  ];
  const fmt = (v: number, d: number) => v.toFixed(d).replace('.', ',');
  let tGlobal = 0;
  let nextSample = 0;
  const dt = 0.05;

  for (const dl of laps) {
    const { v, mode } = speedProfile(track, dl);
    const offset = new Array<number>(n).fill(0);
    track.corners.forEach((c, ci) => {
      const span = Math.max(20, c.end - c.start + 30);
      for (let i = c.start - 30; i <= c.end + 20; i++) {
        const idx = (i + n) % n;
        const w = Math.exp(-(((i - c.apex) / (span / 2)) ** 2));
        offset[idx] += dl.lineOffset[ci] * w;
      }
    });
    const tLap = new Array<number>(n);
    tLap[0] = 0;
    for (let i = 1; i < n; i++) tLap[i] = tLap[i - 1] + 2 / (v[i] + v[i - 1]);
    const lapDur = tLap[n - 1] + 2 / (v[0] + v[n - 1]);
    let j = 0;
    while (nextSample < tGlobal + lapDur) {
      const tl = nextSample - tGlobal;
      while (j < n - 2 && tLap[j + 1] < tl) j++;
      const k = Math.min(1, Math.max(0, (tl - tLap[j]) / ((tLap[j + 1] ?? lapDur) - tLap[j] || 1)));
      const i2 = Math.min(n - 1, j + 1);
      const sp = v[j] + (v[i2] - v[j]) * k;
      const px = track.points[j].x + (track.points[i2].x - track.points[j].x) * k + normals[j].x * offset[j];
      const py = track.points[j].y + (track.points[i2].y - track.points[j].y) * k + normals[j].y * offset[j];
      const gx = px + gaussian(rand) * 0.35;
      const gy = py + gaussian(rand) * 0.35;
      const lat = LAT0 + gy / ky;
      const lon = LON0 + gx / kx;
      const kap = track.kappa[j];
      const dv = (v[i2] - v[Math.max(0, j - 1)]) / 2;
      const aLong = (sp * dv) / G; // dv/dt = v·dv/ds
      const aLat = (sp * sp * kap) / G;
      const m = mode[j];
      const throttle = m === 1 && !(dv <= 0) ? 100 : m === -1 ? 0 : 45 + rand() * 10;
      const brake = m === -1 ? Math.max(0, -aLong) * 22 + rand() * 0.5 : 0;
      const rpm = (sp / (Math.PI * 0.28)) * 60 * 6.4 + gaussian(rand) * 40;
      const steer = Math.atan(kap * 1.05) * (180 / Math.PI) * 12 + gaussian(rand) * 0.6;
      lines.push(
        [
          fmt(nextSample, 3),
          lat.toFixed(8).replace('.', ','),
          lon.toFixed(8).replace('.', ','),
          fmt(sp * 3.6 + gaussian(rand) * 0.15, 2),
          fmt(aLong + gaussian(rand) * 0.03, 3),
          fmt(aLat + gaussian(rand) * 0.04, 3),
          Math.round(Math.max(rpm, 3000)),
          fmt(throttle, 1),
          fmt(brake, 2),
          fmt(steer, 1),
        ].join(';'),
      );
      nextSample = +(nextSample + dt).toFixed(3);
    }
    tGlobal += lapDur;
  }
  return lines.join('\n');
}
