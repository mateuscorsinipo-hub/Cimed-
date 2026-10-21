import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { cn } from '../ui';

export interface Series {
  id: string;
  label: string;
  color: string;
  x: number[];
  y: number[];
  dashed?: boolean;
  width?: number;
}

export interface Band {
  x0: number;
  x1: number;
  color: string;
  label?: string;
}

export interface ChartMarker {
  x: number;
  label: string;
  color: string;
}

interface Props {
  series: Series[];
  height?: number;
  title?: string;
  unit?: string;
  format?: (v: number) => string;
  xDomain?: [number, number];
  onZoom?: (d: [number, number] | null) => void;
  cursorX?: number | null;
  onCursor?: (x: number | null) => void;
  bands?: Band[];
  markers?: ChartMarker[];
  zeroLine?: boolean;
  /** Colore a primeira série por sinal: acima de zero = perda (vermelho), abaixo = ganho (verde). */
  signColored?: boolean;
  yDomain?: [number, number];
  xLabel?: string;
  className?: string;
  emptyText?: string;
}

const PAD = { l: 44, r: 10, t: 8, b: 22 };

function niceTicks(min: number, max: number, count: number): number[] {
  const span = max - min;
  if (!(span > 0)) return [min];
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

function nearestIndex(x: number[], q: number): number {
  let lo = 0;
  let hi = x.length - 1;
  if (hi < 0) return -1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (x[m] <= q) lo = m;
    else hi = m;
  }
  return Math.abs(x[lo] - q) <= Math.abs(x[hi] - q) ? lo : hi;
}

/** Gráfico de linhas SVG com cursor sincronizável, faixas de segmento e zoom por arraste. */
export function LineChart({
  series, height = 200, title, unit, format = (v) => v.toFixed(1), xDomain, onZoom, cursorX, onCursor, bands, markers,
  zeroLine, signColored, yDomain, xLabel = 'm', className, emptyText = 'Sem dados para este canal.',
}: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null);
  const clipId = useId().replace(/:/g, '');

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const valid = series.filter((s) => s.y.some(Number.isFinite));
  const allX = valid.flatMap((s) => [s.x[0], s.x[s.x.length - 1]]).filter(Number.isFinite);
  const [x0, x1] = xDomain ?? [Math.min(...allX), Math.max(...allX)];
  const innerW = width - PAD.l - PAD.r;
  const innerH = height - PAD.t - PAD.b;

  const [y0, y1] = useMemo(() => {
    if (yDomain) return yDomain;
    let mn = Infinity;
    let mx = -Infinity;
    for (const s of valid) for (let i = 0; i < s.x.length; i++) {
      if (s.x[i] < x0 || s.x[i] > x1) continue;
      const v = s.y[i];
      if (!Number.isFinite(v)) continue;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    if (!Number.isFinite(mn)) return [0, 1];
    if (zeroLine) {
      const m = Math.max(Math.abs(mn), Math.abs(mx), 1e-3);
      return [-m * 1.1, m * 1.1];
    }
    const pad = (mx - mn) * 0.08 || 1;
    return [mn - pad, mx + pad];
  }, [valid, x0, x1, yDomain, zeroLine]);

  const sx = (x: number) => PAD.l + ((x - x0) / (x1 - x0 || 1)) * innerW;
  const sy = (y: number) => PAD.t + (1 - (y - y0) / (y1 - y0 || 1)) * innerH;
  const invX = (px: number) => x0 + ((px - PAD.l) / innerW) * (x1 - x0);

  const paths = useMemo(
    () =>
      valid.map((s) => {
        // Decimação: mantém mínimo e máximo por coluna de pixel.
        let d = '';
        let col = -1;
        let colMin = 0;
        let colMax = 0;
        let pen = false;
        const flush = (px: number) => {
          if (col < 0) return;
          d += `${pen ? 'L' : 'M'}${px.toFixed(1)},${sy(colMin).toFixed(1)}L${px.toFixed(1)},${sy(colMax).toFixed(1)}`;
          pen = true;
        };
        for (let i = 0; i < s.x.length; i++) {
          const x = s.x[i];
          if (x < x0 || x > x1) continue;
          const v = s.y[i];
          if (!Number.isFinite(v)) {
            flush(sx(s.x[Math.max(0, i - 1)]));
            col = -1;
            pen = false;
            continue;
          }
          const c = Math.round(sx(x));
          if (c !== col) {
            if (col >= 0) flush(col);
            col = c;
            colMin = v;
            colMax = v;
          } else {
            colMin = Math.min(colMin, v);
            colMax = Math.max(colMax, v);
          }
        }
        if (col >= 0) flush(col);
        return { s, d };
      }),
    [valid, x0, x1, y0, y1, width, height],
  );

  const yt = niceTicks(y0, y1, Math.max(2, Math.floor(innerH / 36)));
  const xt = niceTicks(x0, x1, Math.max(2, Math.floor(innerW / 90)));

  const pxFromEvent = (e: RPointerEvent) => {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    return Math.min(PAD.l + innerW, Math.max(PAD.l, e.clientX - r.left));
  };

  const cursorValues = cursorX !== null && cursorX !== undefined
    ? valid.map((s) => {
        const i = nearestIndex(s.x, cursorX);
        return { s, v: i >= 0 ? s.y[i] : NaN };
      })
    : null;

  if (!valid.length) {
    return (
      <div ref={wrap} className={cn('flex items-center justify-center rounded-lg border border-dashed border-ink-600 text-sm text-fg-dim', className)} style={{ height }}>
        {emptyText}
      </div>
    );
  }

  return (
    <div ref={wrap} className={cn('relative select-none', className)}>
      <div className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
        {title && <span className="font-semibold uppercase tracking-[0.1em] text-fg-muted">{title}{unit ? ` (${unit})` : ''}</span>}
        {valid.map((s, i) => (
          <span key={s.id} className="flex items-center gap-1.5 text-fg-muted">
            <span className="inline-block h-0.5 w-4 rounded" style={{ background: s.color, opacity: s.dashed ? 0.7 : 1 }} />
            {s.label}
            {cursorValues && <span className="num text-fg">{Number.isFinite(cursorValues[i].v) ? format(cursorValues[i].v) : '—'}</span>}
          </span>
        ))}
      </div>
      <svg
        width={width}
        height={height}
        className="block touch-pan-y"
        role="img"
        aria-label={title ?? 'Gráfico'}
        onPointerMove={(e) => {
          const px = pxFromEvent(e);
          onCursor?.(invX(px));
          if (drag) setDrag({ ...drag, b: px });
        }}
        onPointerLeave={() => {
          onCursor?.(null);
          setDrag(null);
        }}
        onPointerDown={(e) => {
          if (!onZoom || e.pointerType === 'touch') return;
          const px = pxFromEvent(e);
          setDrag({ a: px, b: px });
        }}
        onPointerUp={() => {
          if (drag && onZoom && Math.abs(drag.b - drag.a) > 12) {
            const a = invX(Math.min(drag.a, drag.b));
            const b = invX(Math.max(drag.a, drag.b));
            onZoom([a, b]);
          }
          setDrag(null);
        }}
        onDoubleClick={() => onZoom?.(null)}
      >
        <defs>
          <clipPath id={`${clipId}-plot`}>
            <rect x={PAD.l} y={PAD.t} width={innerW} height={innerH} />
          </clipPath>
          <clipPath id={`${clipId}-pos`}>
            <rect x={PAD.l} y={PAD.t} width={innerW} height={Math.max(0, sy(0) - PAD.t)} />
          </clipPath>
          <clipPath id={`${clipId}-neg`}>
            <rect x={PAD.l} y={sy(0)} width={innerW} height={Math.max(0, PAD.t + innerH - sy(0))} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId}-plot)`}>
          {bands?.map((b, i) => (
            <rect key={i} x={sx(b.x0)} y={PAD.t} width={Math.max(0, sx(b.x1) - sx(b.x0))} height={innerH} fill={b.color} />
          ))}
        </g>
        {yt.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={PAD.l + innerW} y1={sy(v)} y2={sy(v)} stroke="#252A33" strokeWidth={1} />
            <text x={PAD.l - 6} y={sy(v) + 3.5} textAnchor="end" className="fill-fg-dim font-mono text-[10px]">
              {format(v)}
            </text>
          </g>
        ))}
        {xt.map((v) => (
          <text key={v} x={sx(v)} y={height - 6} textAnchor="middle" className="fill-fg-dim font-mono text-[10px]">
            {Math.round(v)}
            {v === xt[xt.length - 1] ? ` ${xLabel}` : ''}
          </text>
        ))}
        {zeroLine && <line x1={PAD.l} x2={PAD.l + innerW} y1={sy(0)} y2={sy(0)} stroke="#6B7382" strokeWidth={1} />}
        <g clipPath={`url(#${clipId}-plot)`}>
          {paths.map(({ s, d }, i) =>
            signColored && i === 0 ? (
              <g key={s.id}>
                <path d={d} fill="none" stroke="#FF4F4F" strokeWidth={s.width ?? 1.6} clipPath={`url(#${clipId}-pos)`} />
                <path d={d} fill="none" stroke="#C6F432" strokeWidth={s.width ?? 1.6} clipPath={`url(#${clipId}-neg)`} />
              </g>
            ) : (
              <path key={s.id} d={d} fill="none" stroke={s.color} strokeWidth={s.width ?? 1.6} strokeDasharray={s.dashed ? '4 3' : undefined} strokeLinejoin="round" />
            ),
          )}
          {markers?.map((m, i) => (
            <g key={i}>
              <line x1={sx(m.x)} x2={sx(m.x)} y1={PAD.t} y2={PAD.t + innerH} stroke={m.color} strokeDasharray="2 3" />
              <text x={sx(m.x) + 3} y={PAD.t + 10} className="font-mono text-[9px]" fill={m.color}>
                {m.label}
              </text>
            </g>
          ))}
          {bands?.filter((b) => b.label).map((b, i) => (
            <text key={i} x={(sx(b.x0) + sx(b.x1)) / 2} y={PAD.t + innerH - 4} textAnchor="middle" className="fill-fg-dim text-[9px] font-semibold">
              {b.label}
            </text>
          ))}
        </g>
        {cursorX !== null && cursorX !== undefined && cursorX >= x0 && cursorX <= x1 && (
          <line x1={sx(cursorX)} x2={sx(cursorX)} y1={PAD.t} y2={PAD.t + innerH} stroke="#F2F4F7" strokeOpacity={0.7} strokeWidth={1} />
        )}
        {drag && <rect x={Math.min(drag.a, drag.b)} y={PAD.t} width={Math.abs(drag.b - drag.a)} height={innerH} fill="#4DA3FF" fillOpacity={0.15} />}
      </svg>
    </div>
  );
}
