/** Utilidades numéricas puras usadas pelos módulos de análise. */

/** Média móvel centrada que ignora NaN. Janela em amostras (forçada a ímpar). */
export function movingAverage(y: number[], window: number): number[] {
  const w = Math.max(1, Math.round(window) | 1);
  if (w === 1) return y.slice();
  const h = (w - 1) / 2;
  const n = y.length;
  const out = new Array<number>(n);
  let sum = 0;
  let cnt = 0;
  // Janela deslizante O(n).
  for (let i = 0; i < Math.min(h, n); i++) {
    if (Number.isFinite(y[i])) {
      sum += y[i];
      cnt++;
    }
  }
  for (let i = 0; i < n; i++) {
    const add = i + h;
    const rem = i - h - 1;
    if (add < n && Number.isFinite(y[add])) {
      sum += y[add];
      cnt++;
    }
    if (rem >= 0 && Number.isFinite(y[rem])) {
      sum -= y[rem];
      cnt--;
    }
    out[i] = cnt > 0 && Number.isFinite(y[i]) ? sum / cnt : NaN;
  }
  return out;
}

/** Preenche NaN internos por interpolação linear; extremidades recebem o valor válido mais próximo. */
export function fillGaps(y: number[]): number[] {
  const out = y.slice();
  const n = out.length;
  let prev = -1;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(out[i])) continue;
    if (prev === -1 && i > 0) for (let k = 0; k < i; k++) out[k] = out[i];
    else if (prev >= 0 && i - prev > 1) {
      for (let k = prev + 1; k < i; k++) out[k] = out[prev] + ((out[i] - out[prev]) * (k - prev)) / (i - prev);
    }
    prev = i;
  }
  if (prev >= 0) for (let k = prev + 1; k < n; k++) out[k] = out[prev];
  return out;
}

/** Interpolação linear de y(x) em xq, com x estritamente crescente. */
export function interp(x: number[], y: number[], xq: number): number {
  const n = x.length;
  if (!n) return NaN;
  if (xq <= x[0]) return y[0];
  if (xq >= x[n - 1]) return y[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (x[mid] <= xq) lo = mid;
    else hi = mid;
  }
  const span = x[hi] - x[lo];
  if (span <= 0) return y[lo];
  return y[lo] + ((y[hi] - y[lo]) * (xq - x[lo])) / span;
}

/** Interpola y(x) em vários pontos ordenados (varredura linear O(n+m)). */
export function interpMany(x: number[], y: number[], xq: number[]): number[] {
  const out = new Array<number>(xq.length);
  let j = 0;
  const n = x.length;
  for (let i = 0; i < xq.length; i++) {
    const q = xq[i];
    if (q <= x[0]) {
      out[i] = y[0];
      continue;
    }
    if (q >= x[n - 1]) {
      out[i] = y[n - 1];
      continue;
    }
    while (j < n - 2 && x[j + 1] < q) j++;
    const span = x[j + 1] - x[j];
    out[i] = span > 0 ? y[j] + ((y[j + 1] - y[j]) * (q - x[j])) / span : y[j];
  }
  return out;
}

/** Derivada dy/dx por diferenças centrais. */
export function derivative(y: number[], x: number[]): number[] {
  const n = y.length;
  const out = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    const dx = x[b] - x[a];
    if (dx > 0 && Number.isFinite(y[a]) && Number.isFinite(y[b])) out[i] = (y[b] - y[a]) / dx;
  }
  return out;
}

export function mean(v: number[]): number {
  let s = 0;
  let c = 0;
  for (const x of v) if (Number.isFinite(x)) {
    s += x;
    c++;
  }
  return c ? s / c : NaN;
}

export function stdDev(v: number[]): number {
  const f = v.filter(Number.isFinite);
  if (f.length < 2) return NaN;
  const m = mean(f);
  return Math.sqrt(f.reduce((a, x) => a + (x - m) ** 2, 0) / (f.length - 1));
}

export function minMax(v: number[]): { min: number; max: number; minIdx: number; maxIdx: number } {
  let min = Infinity;
  let max = -Infinity;
  let minIdx = -1;
  let maxIdx = -1;
  v.forEach((x, i) => {
    if (!Number.isFinite(x)) return;
    if (x < min) {
      min = x;
      minIdx = i;
    }
    if (x > max) {
      max = x;
      maxIdx = i;
    }
  });
  return { min, max, minIdx, maxIdx };
}

/** Gerador pseudoaleatório determinístico (mulberry32) para dados demonstrativos reprodutíveis. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
