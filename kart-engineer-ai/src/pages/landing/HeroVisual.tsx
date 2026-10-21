import { useMemo } from 'react';
import { fmtDelta, fmtLapTime } from '@/lib/format';
import { KartIllustration } from './KartIllustration';
import { useDemoData } from './useDemo';

function pathFrom(xs: number[], ys: number[], w: number, h: number, yMin: number, yMax: number, step = 3): string {
  let d = '';
  for (let i = 0; i < xs.length; i += step) {
    if (!Number.isFinite(ys[i])) continue;
    const x = xs[i] * w;
    const y = h - ((ys[i] - yMin) / (yMax - yMin || 1)) * h;
    d += `${d ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
  }
  return d;
}

/** Composição do hero: ilustração + traçado + velocidade + delta (dados demonstrativos). */
export function HeroVisual() {
  const demo = useDemoData();
  const geo = useMemo(() => {
    if (!demo) return null;
    const { ref, cmp, comparison, session } = demo;
    const xs = ref.x!;
    const ys = ref.y!;
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const sc = 200 / Math.max(maxX - minX, maxY - minY);
    const mapD = xs.map((x, i) => `${i ? 'L' : 'M'}${(10 + (x - minX) * sc).toFixed(1)},${(10 + (maxY - ys[i]) * sc).toFixed(1)}`).filter((_, i) => i % 2 === 0).join('');
    const vAll = [...ref.speed, ...cmp.speed].filter(Number.isFinite);
    const vMin = Math.min(...vAll);
    const vMax = Math.max(...vAll);
    const dMax = Math.max(0.05, ...comparison.delta.map(Math.abs));
    const corners = session.segments.filter((s) => s.kind === 'corner').map((s, i) => {
      const idx = Math.round((s.apex ?? s.start) * (xs.length - 1));
      return { n: i + 1, x: 10 + (xs[idx] - minX) * sc, y: 10 + (maxY - ys[idx]) * sc, f: s.apex ?? s.start };
    });
    return {
      mapD,
      w: (maxX - minX) * sc + 20,
      h: (maxY - minY) * sc + 20,
      refD: pathFrom(ref.frac, ref.speed, 400, 90, vMin, vMax),
      cmpD: pathFrom(cmp.frac, cmp.speed, 400, 90, vMin, vMax),
      deltaD: pathFrom(ref.frac, comparison.delta, 400, 50, -dMax, dMax),
      corners,
      total: comparison.totalDelta,
      refLap: ref.lapNumber,
      cmpLap: cmp.lapNumber,
      refTime: ref.lapTime,
    };
  }, [demo]);

  return (
    <div className="relative">
      <div className="panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-ink-600/70 px-4 py-2">
          <span className="label">Exemplo · dados demonstrativos sintéticos</span>
          <span className="flex items-center gap-1.5 text-[11px] text-fg-dim">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gain" /> pista fictícia
          </span>
        </div>
        <KartIllustration className="block h-auto w-full" />
        <div className="grid gap-px border-t border-ink-600/70 bg-ink-600/70 sm:grid-cols-[0.9fr_1.1fr]">
          <div className="bg-ink-850 p-3">
            <div className="label mb-2">Traçado 2D</div>
            {geo ? (
              <svg viewBox={`0 0 ${geo.w} ${geo.h}`} className="mx-auto block h-40 w-full" aria-label="Traçado do circuito demonstrativo com curvas numeradas">
                <path d={geo.mapD} fill="none" stroke="#252A33" strokeWidth="9" strokeLinejoin="round" />
                <path d={geo.mapD} pathLength={1} fill="none" stroke="#C6F432" strokeWidth="2.5" strokeLinejoin="round" style={{ strokeDasharray: 1, strokeDashoffset: 1, ['--len' as string]: 1 }} className="animate-draw" />
                {geo.corners.map((c) => (
                  <g key={c.n} className="animate-fadeUp" style={{ animationDelay: `${0.8 + c.n * 0.08}s` }}>
                    <circle cx={c.x} cy={c.y} r="7" fill="#14171C" stroke="#4DA3FF" />
                    <text x={c.x} y={c.y + 3} textAnchor="middle" fontSize="8" fontWeight="700" fill="#F2F4F7">
                      {c.n}
                    </text>
                  </g>
                ))}
              </svg>
            ) : (
              <div className="h-40 animate-pulse rounded bg-ink-800" />
            )}
          </div>
          <div className="bg-ink-850 p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="label">Velocidade × distância</span>
              {geo && (
                <span className="flex gap-3 text-[10px] text-fg-muted">
                  <span className="flex items-center gap-1"><i className="h-0.5 w-3 bg-gain" />V{geo.refLap}</span>
                  <span className="flex items-center gap-1"><i className="h-0.5 w-3 bg-data" />V{geo.cmpLap}</span>
                </span>
              )}
            </div>
            {geo ? (
              <svg viewBox="0 0 400 160" className="block h-auto w-full" aria-label="Gráfico de velocidade de duas voltas e diferença de tempo acumulada">
                {[0, 30, 60, 90].map((y) => (
                  <line key={y} x1="0" x2="400" y1={y} y2={y} stroke="#1B1F26" />
                ))}
                <path d={geo.cmpD} fill="none" stroke="#4DA3FF" strokeWidth="1.4" pathLength={1} style={{ strokeDasharray: 1, ['--len' as string]: 1 }} className="animate-draw" />
                <path d={geo.refD} fill="none" stroke="#C6F432" strokeWidth="1.6" pathLength={1} style={{ strokeDasharray: 1, ['--len' as string]: 1 }} className="animate-draw" />
                <g transform="translate(0 104)">
                  <line x1="0" x2="400" y1="25" y2="25" stroke="#323844" />
                  <path d={geo.deltaD} fill="none" stroke="#FF4F4F" strokeWidth="1.5" pathLength={1} style={{ strokeDasharray: 1, ['--len' as string]: 1, animationDelay: '0.4s' }} className="animate-draw" />
                  <text x="0" y="-4" fontSize="9" fill="#6B7382" fontFamily="JetBrains Mono, monospace">Δ TEMPO ACUMULADO</text>
                </g>
              </svg>
            ) : (
              <div className="h-40 animate-pulse rounded bg-ink-800" />
            )}
          </div>
        </div>
      </div>
      {geo && (
        <div className="absolute -bottom-5 left-4 flex flex-wrap gap-2 sm:-left-6">
          <div className="panel animate-fadeUp px-3 py-2 shadow-2xl" style={{ animationDelay: '1.2s' }}>
            <div className="label">Volta ref. (exemplo)</div>
            <div className="num text-lg font-semibold text-gain">{fmtLapTime(geo.refTime)}</div>
          </div>
          <div className="panel animate-fadeUp px-3 py-2 shadow-2xl" style={{ animationDelay: '1.4s' }}>
            <div className="label">Diferença V{geo.cmpLap}</div>
            <div className="num text-lg font-semibold text-loss">{fmtDelta(geo.total)}</div>
          </div>
        </div>
      )}
    </div>
  );
}
