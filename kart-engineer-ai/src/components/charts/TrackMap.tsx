import { useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode, type WheelEvent } from 'react';
import { Maximize2, Minus, Plus } from 'lucide-react';
import type { XY } from '@/lib/types';
import { bounds, cumulativeLengths, nearestOnPolyline, pointAtFraction } from '@/lib/track-map/geometry';
import { cn } from '../ui';

export interface MapOverlay {
  id: string;
  points: XY[];
  color: string;
  label: string;
  dashed?: boolean;
  width?: number;
}

export interface MapMarker {
  id: string;
  fraction: number;
  color: string;
  label?: string;
  shape?: 'dot' | 'bar' | 'diamond';
}

interface Props {
  /** Trajetória principal (referência). Frações referem-se a esta polilinha. */
  points: XY[];
  /** Valores (ex.: velocidade) para colorir a trajetória principal. */
  colorValues?: number[];
  overlays?: MapOverlay[];
  labels?: { fraction: number; text: string }[];
  markers?: MapMarker[];
  highlight?: { start: number; end: number } | null;
  cursorFraction?: number | null;
  onHover?: (fraction: number | null) => void;
  onPick?: (fraction: number, point: XY) => void;
  height?: number;
  schematic?: boolean;
  showDirection?: boolean;
  className?: string;
  footer?: ReactNode;
}

function speedColor(k: number): string {
  // vermelho (lento) → âmbar → verde-limão (rápido)
  const t = Math.min(1, Math.max(0, k));
  const r = t < 0.5 ? 255 : Math.round(255 - (t - 0.5) * 2 * (255 - 198));
  const g = t < 0.5 ? Math.round(79 + t * 2 * (181 - 79)) : Math.round(181 + (t - 0.5) * 2 * (244 - 181));
  const b = t < 0.5 ? Math.round(79 - t * 2 * 8) : Math.round(71 - (t - 0.5) * 2 * 21);
  return `rgb(${r},${g},${b})`;
}

/** Mapa 2D em SVG com zoom (roda/botões), arraste, cursor e seleção por clique. */
export function TrackMap({
  points, colorValues, overlays = [], labels = [], markers = [], highlight, cursorFraction, onHover, onPick,
  height = 380, schematic, showDirection = true, className, footer,
}: Props) {
  const [view, setView] = useState({ k: 1, tx: 0, ty: 0 });
  const pan = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const valid = useMemo(() => points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)), [points]);
  const cum = useMemo(() => cumulativeLengths(valid), [valid]);
  const b = useMemo(() => bounds([...valid, ...overlays.flatMap((o) => o.points)]), [valid, overlays]);
  const W = 1000;
  const span = Math.max(b.maxX - b.minX, b.maxY - b.minY, 1);
  const pad = span * 0.08;
  const s = (W - 2 * 20) / (span + 2 * pad);
  const H = Math.round(((b.maxY - b.minY + 2 * pad) * s + 40) || 600);
  const ox = 20 + ((span + 2 * pad) * s - (b.maxX - b.minX) * s) / 2;
  const tx = (p: XY) => ox + (p.x - b.minX) * s;
  const ty = (p: XY) => H - 20 - (p.y - b.minY + pad) * s;

  const segs = useMemo(() => {
    if (!colorValues) return null;
    const v = colorValues.filter(Number.isFinite);
    const mn = Math.min(...v);
    const mx = Math.max(...v);
    const out: { d: string; c: string }[] = [];
    const step = Math.max(1, Math.floor(valid.length / 400));
    for (let i = 0; i < valid.length - 1; i += step) {
      const j = Math.min(valid.length - 1, i + step);
      const k = (colorValues[i] - mn) / (mx - mn || 1);
      out.push({ d: `M${tx(valid[i]).toFixed(1)},${ty(valid[i]).toFixed(1)}L${tx(valid[j]).toFixed(1)},${ty(valid[j]).toFixed(1)}`, c: speedColor(k) });
    }
    return out;
  }, [colorValues, valid, s, H]);

  const pathOf = (pts: XY[]) => pts.filter((p) => Number.isFinite(p.x)).map((p, i) => `${i ? 'L' : 'M'}${tx(p).toFixed(1)},${ty(p).toFixed(1)}`).join('');

  const toLocal = (e: { clientX: number; clientY: number }): XY | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * W;
    const vy = ((e.clientY - r.top) / r.height) * H;
    const gx = (vx - view.tx) / view.k;
    const gy = (vy - view.ty) / view.k;
    return { x: (gx - ox) / s + b.minX, y: (H - 20 - gy) / s + b.minY - pad };
  };

  const fractionAt = (q: XY) => {
    if (valid.length < 2) return null;
    const r = nearestOnPolyline(q, valid, cum);
    const L = cum[cum.length - 1];
    const dist = Math.abs(r.lateral);
    return { f: L > 0 ? r.along / L : 0, dist };
  };

  const onWheel = (e: WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey && !e.shiftKey) return;
    e.preventDefault();
    zoom(e.deltaY < 0 ? 1.25 : 0.8, e);
  };

  const zoom = (factor: number, at?: { clientX: number; clientY: number }) => {
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const cx = at ? ((at.clientX - r.left) / r.width) * W : W / 2;
    const cy = at ? ((at.clientY - r.top) / r.height) * H : H / 2;
    setView((v) => {
      const k = Math.min(12, Math.max(1, v.k * factor));
      const f = k / v.k;
      return k === 1 ? { k: 1, tx: 0, ty: 0 } : { k, tx: cx - (cx - v.tx) * f, ty: cy - (cy - v.ty) * f };
    });
  };

  const cursor = cursorFraction !== null && cursorFraction !== undefined && valid.length > 1 ? pointAtFraction(valid, cum, cursorFraction) : null;
  const hl = useMemo(() => {
    if (!highlight || valid.length < 2) return null;
    const n = valid.length - 1;
    return valid.slice(Math.floor(highlight.start * n), Math.ceil(highlight.end * n) + 1);
  }, [highlight, valid]);

  const start = valid[0];
  const dir = valid.length > 5 ? pointAtFraction(valid, cum, 0.012) : null;
  const sw = 1 / view.k;

  if (valid.length < 2) {
    return <div className={cn('flex items-center justify-center rounded-lg border border-dashed border-ink-600 text-sm text-fg-dim', className)} style={{ height }}>Sem trajetória disponível.</div>;
  }

  return (
    <div className={cn('relative overflow-hidden rounded-lg border border-ink-600 bg-ink-950', className)}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className={cn('block w-full touch-none', onPick && 'cursor-crosshair')}
        style={{ height, maxHeight: height }}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={schematic ? 'Traçado esquemático desenhado manualmente' : 'Mapa da trajetória registrada pelo GPS'}
        onWheel={onWheel}
        onPointerDown={(e: RPointerEvent) => {
          (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
          pan.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: false };
        }}
        onPointerMove={(e) => {
          const p = pan.current;
          if (p && view.k > 1) {
            const r = svgRef.current!.getBoundingClientRect();
            const dx = ((e.clientX - p.x) / r.width) * W;
            const dy = ((e.clientY - p.y) / r.height) * H;
            if (Math.abs(dx) + Math.abs(dy) > 4) p.moved = true;
            setView((v) => ({ ...v, tx: p.tx + dx, ty: p.ty + dy }));
            return;
          }
          if (!onHover) return;
          const q = toLocal(e);
          const r = q && fractionAt(q);
          onHover(r && r.dist < span * 0.06 ? r.f : null);
        }}
        onPointerUp={(e) => {
          const p = pan.current;
          pan.current = null;
          if (p?.moved || !onPick) return;
          const q = toLocal(e);
          const r = q && fractionAt(q);
          if (q && r) onPick(r.f, q);
        }}
        onPointerLeave={() => {
          pan.current = null;
          onHover?.(null);
        }}
      >
        <g transform={`translate(${view.tx} ${view.ty}) scale(${view.k})`}>
          <path d={pathOf(valid)} fill="none" stroke="#252A33" strokeWidth={schematic ? 22 * sw : 14 * sw} strokeLinecap="round" strokeLinejoin="round" />
          {overlays.map((o) => (
            <path key={o.id} d={pathOf(o.points)} fill="none" stroke={o.color} strokeWidth={(o.width ?? 2) * sw} strokeDasharray={o.dashed ? `${6 * sw} ${4 * sw}` : undefined} strokeLinejoin="round" opacity={0.95} />
          ))}
          {segs ? (
            segs.map((g, i) => <path key={i} d={g.d} stroke={g.c} strokeWidth={3.2 * sw} strokeLinecap="round" fill="none" />)
          ) : (
            <path d={pathOf(valid)} fill="none" stroke={schematic ? '#9AA3B2' : '#C6F432'} strokeWidth={3 * sw} strokeDasharray={schematic ? `${8 * sw} ${5 * sw}` : undefined} strokeLinejoin="round" />
          )}
          {hl && <path d={pathOf(hl)} fill="none" stroke="#F2F4F7" strokeOpacity={0.9} strokeWidth={7 * sw} strokeLinecap="round" />}
          {start && (
            <g>
              <circle cx={tx(start)} cy={ty(start)} r={7 * sw} fill="#0B0C0F" stroke="#F2F4F7" strokeWidth={2 * sw} />
              <text x={tx(start) + 10 * sw} y={ty(start) - 10 * sw} fill="#F2F4F7" fontSize={13 * sw} fontWeight={700}>
                S/C
              </text>
            </g>
          )}
          {showDirection && dir && start && (
            <path
              d={`M${tx(dir)},${ty(dir)} l${(-12 * Math.cos(-dir.angle - 0.5)) * sw},${(-12 * Math.sin(-dir.angle - 0.5)) * sw} M${tx(dir)},${ty(dir)} l${(-12 * Math.cos(-dir.angle + 0.5)) * sw},${(-12 * Math.sin(-dir.angle + 0.5)) * sw}`}
              stroke="#F2F4F7"
              strokeWidth={2.5 * sw}
              fill="none"
              strokeLinecap="round"
            />
          )}
          {markers.map((m) => {
            const p = pointAtFraction(valid, cum, m.fraction);
            const x = tx(p);
            const y = ty(p);
            return (
              <g key={m.id}>
                {m.shape === 'bar' ? (
                  <line x1={x - 9 * sw * Math.sin(-p.angle)} y1={y - 9 * sw * Math.cos(-p.angle)} x2={x + 9 * sw * Math.sin(-p.angle)} y2={y + 9 * sw * Math.cos(-p.angle)} stroke={m.color} strokeWidth={3 * sw} />
                ) : m.shape === 'diamond' ? (
                  <rect x={x - 5 * sw} y={y - 5 * sw} width={10 * sw} height={10 * sw} fill={m.color} transform={`rotate(45 ${x} ${y})`} />
                ) : (
                  <circle cx={x} cy={y} r={5 * sw} fill={m.color} stroke="#0B0C0F" strokeWidth={1.5 * sw} />
                )}
                {m.label && (
                  <text x={x + 8 * sw} y={y + 4 * sw} fill={m.color} fontSize={11 * sw} fontWeight={600}>
                    {m.label}
                  </text>
                )}
              </g>
            );
          })}
          {labels.map((l, i) => {
            const p = pointAtFraction(valid, cum, l.fraction);
            const nx = -Math.sin(p.angle);
            const ny = Math.cos(p.angle);
            const x = tx({ x: p.x + nx * span * 0.035, y: p.y + ny * span * 0.035 });
            const y = ty({ x: p.x + nx * span * 0.035, y: p.y + ny * span * 0.035 });
            return (
              <g key={i}>
                <circle cx={x} cy={y} r={11 * sw} fill="#14171C" stroke="#4DA3FF" strokeWidth={1.5 * sw} />
                <text x={x} y={y + 4 * sw} textAnchor="middle" fill="#F2F4F7" fontSize={11 * sw} fontWeight={700}>
                  {l.text}
                </text>
              </g>
            );
          })}
          {cursor && <circle cx={tx(cursor)} cy={ty(cursor)} r={8 * sw} fill="#F2F4F7" stroke="#0B0C0F" strokeWidth={3 * sw} />}
        </g>
      </svg>
      <div className="absolute right-2 top-2 flex flex-col gap-1">
        <button className="btn-secondary btn-sm !p-1.5" onClick={() => zoom(1.4)} aria-label="Aproximar">
          <Plus className="h-4 w-4" />
        </button>
        <button className="btn-secondary btn-sm !p-1.5" onClick={() => zoom(1 / 1.4)} aria-label="Afastar">
          <Minus className="h-4 w-4" />
        </button>
        <button className="btn-secondary btn-sm !p-1.5" onClick={() => setView({ k: 1, tx: 0, ty: 0 })} aria-label="Enquadrar traçado">
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>
      {colorValues && (
        <div className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-2 rounded-md bg-ink-900/80 px-2 py-1 text-[10px] text-fg-muted">
          lento
          <span className="h-1.5 w-16 rounded" style={{ background: `linear-gradient(90deg, ${speedColor(0)}, ${speedColor(0.5)}, ${speedColor(1)})` }} />
          rápido
        </div>
      )}
      {footer}
    </div>
  );
}
