import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { LineChart } from '@/components/charts/LineChart';
import { TrackMap } from '@/components/charts/TrackMap';
import { cn, KindTag, Spinner } from '@/components/ui';
import { fmtDelta, fmtLapTime, fmtSpeed, fmtSpeedDelta } from '@/lib/format';
import { useDemoData } from './useDemo';

/** Demonstração interativa da landing (dados sintéticos, pista fictícia). */
export function InteractiveDemo() {
  const demo = useDemoData();
  const [segId, setSegId] = useState<string | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);

  const view = useMemo(() => {
    if (!demo) return null;
    const { ref, cmp, comparison } = demo;
    const L = comparison.scale;
    const x = ref.frac.map((f) => f * L);
    const worst = [...comparison.segments].sort((a, b) => b.timeDelta - a.timeDelta)[0];
    return { ref, cmp, comparison, L, x, worst };
  }, [demo]);

  if (!demo || !view) {
    return (
      <div className="panel flex h-80 items-center justify-center">
        <Spinner label="Gerando dados demonstrativos…" />
      </div>
    );
  }

  const { ref, cmp, comparison, L, x } = view;
  const selected = comparison.segments.find((s) => s.segment.id === (segId ?? view.worst.segment.id))!;
  const seg = selected.segment;
  const pts = ref.x!.map((px, i) => ({ x: px, y: ref.y![i] }));
  const cmpPts = cmp.x!.map((px, i) => ({ x: px, y: cmp.y![i] }));
  const corners = demo.session.segments.filter((s) => s.kind === 'corner');
  const gain = selected.timeDelta < 0;

  return (
    <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
      <div className="panel p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <KindTag kind="demo" />
            <span className="text-xs text-fg-muted">
              V{ref.lapNumber} (ref., {fmtLapTime(ref.lapTime)}) × V{cmp.lapNumber} ({fmtLapTime(cmp.lapTime)})
            </span>
          </div>
          <span className={cn('num text-sm font-semibold', comparison.totalDelta > 0 ? 'text-loss' : 'text-gain')}>Total {fmtDelta(comparison.totalDelta)}</span>
        </div>
        <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Selecionar segmento">
          {comparison.segments.map((s) => (
            <button
              key={s.segment.id}
              onClick={() => setSegId(s.segment.id)}
              aria-pressed={s.segment.id === seg.id}
              className={cn(
                'rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors',
                s.segment.id === seg.id ? 'border-fg bg-fg text-ink-950' : 'border-ink-600 text-fg-muted hover:border-ink-500 hover:text-fg',
              )}
            >
              {s.segment.kind === 'corner' ? s.segment.name.replace('Curva ', 'C') : 'Reta'}
              <span className={cn('ml-1 num', s.segment.id === seg.id ? '' : s.timeDelta > 0.005 ? 'text-loss' : s.timeDelta < -0.005 ? 'text-gain' : '')}>
                {s.timeDelta > 0 ? '+' : ''}
                {s.timeDelta.toFixed(2)}
              </span>
            </button>
          ))}
        </div>
        <LineChart
          height={190}
          title="Velocidade"
          unit="km/h"
          format={(v) => v.toFixed(0)}
          cursorX={cursor}
          onCursor={setCursor}
          bands={[{ x0: seg.start * L, x1: seg.end * L, color: 'rgba(242,244,247,0.06)' }]}
          series={[
            { id: 'r', label: `V${ref.lapNumber}`, color: '#C6F432', x, y: ref.speed.map((v) => v * 3.6) },
            // Mesma grade de fração da referência: índices alinhados por distância equivalente.
            { id: 'c', label: `V${cmp.lapNumber}`, color: '#4DA3FF', x, y: cmp.speed.map((v) => v * 3.6) },
          ]}
        />
        <LineChart
          className="mt-3"
          height={120}
          title={`Diferença acumulada V${cmp.lapNumber} − V${ref.lapNumber}`}
          unit="s"
          format={(v) => v.toFixed(2)}
          cursorX={cursor}
          onCursor={setCursor}
          zeroLine
          signColored
          bands={[{ x0: seg.start * L, x1: seg.end * L, color: 'rgba(242,244,247,0.06)' }]}
          series={[{ id: 'd', label: 'Δ tempo', color: '#FF4F4F', x, y: comparison.delta }]}
        />
        <p className="mt-2 text-[11px] text-fg-dim">Acima de zero: a volta comparada está atrás da referência. Passe o cursor para sincronizar gráficos e mapa.</p>
      </div>

      <div className="flex flex-col gap-4">
        <TrackMap
          points={pts}
          colorValues={ref.speed}
          overlays={[{ id: 'c', points: cmpPts, color: '#4DA3FF', label: 'comparada', width: 1, dashed: true }]}
          labels={corners.map((c, i) => ({ fraction: c.apex ?? c.start, text: String(i + 1) }))}
          highlight={{ start: seg.start, end: seg.end }}
          cursorFraction={cursor !== null ? cursor / L : null}
          onHover={(f) => setCursor(f !== null ? f * L : null)}
          onPick={(f) => {
            const s = demo.session.segments.find((g) => f >= g.start && f <= g.end);
            if (s) setSegId(s.id);
          }}
          height={260}
        />
        <div className="panel flex-1 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">{seg.name}</h3>
            <span className={cn('chip', gain ? 'border-gain/40 text-gain' : 'border-loss/40 text-loss')}>
              {gain ? 'Ganho' : 'Perda'} {fmtDelta(selected.timeDelta)}
            </span>
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
            {[
              ['Entrada', selected.entryDelta, selected.ref.entrySpeed],
              ['Mínima', selected.minDelta, selected.ref.minSpeed],
              ['Saída', selected.exitDelta, selected.ref.exitSpeed],
            ].map(([k, d, v]) => (
              <div key={k as string} className="rounded-lg border border-ink-600 bg-ink-900 px-2 py-2">
                <dt className="label">{k}</dt>
                <dd className={cn('num mt-1 text-sm font-semibold', (d as number) < -0.15 ? 'text-loss' : (d as number) > 0.15 ? 'text-gain' : '')}>{fmtSpeedDelta(d as number)}</dd>
                <dd className="num text-[10px] text-fg-dim">ref. {fmtSpeed(v as number, 'kmh', 0)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-sm leading-relaxed text-fg-muted">
            {Math.abs(selected.timeDelta) < 0.01
              ? 'As duas voltas são praticamente equivalentes neste segmento.'
              : `A volta ${cmp.lapNumber} ${gain ? 'ganha' : 'perde'} ${Math.abs(selected.timeDelta).toFixed(3)} s neste trecho. `}
            {selected.exitDelta < -0.4 && 'A velocidade de saída é menor que a da referência; compare trajetória, velocidade de entrada e momento de aceleração. '}
            {selected.brakeDelta !== null && Math.abs(selected.brakeDelta) >= 3 &&
              `A frenagem começa cerca de ${Math.abs(selected.brakeDelta).toFixed(0)} m ${selected.brakeDelta < 0 ? 'antes' : 'depois'} (estimativa). `}
            {Math.abs(selected.timeDelta) >= 0.01 && selected.exitDelta >= -0.4 && 'Use o vídeo e o traçado para investigar a origem da diferença.'}
          </p>
          <p className="mt-2 text-[11px] text-fg-dim">Velocidade maior em um ponto não significa, por si só, tempo menor no trecho.</p>
          <Link to="/app" className="btn-primary btn-sm mt-4">
            Analisar minhas voltas <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
