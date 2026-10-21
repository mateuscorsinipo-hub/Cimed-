import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FileUp, FlaskConical, Gauge } from 'lucide-react';
import type { Lap, Session } from '@/lib/types';
import type { Diagnostic } from '@/lib/diagnostics-engine';
import { fmtDelta, fmtLapTime } from '@/lib/format';
import { cn, EmptyState, KindTag, Spinner } from '../ui';
import { useApp } from '@/state/AppState';

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: string; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="label mb-1.5 text-gain">{eyebrow}</div>}
        <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-3xl text-sm text-fg-muted">{subtitle}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Estado vazio padrão quando nenhuma sessão está aberta. */
export function NoSession({ what }: { what: string }) {
  const { loadDemo } = useApp();
  return (
    <EmptyState
      icon={<Gauge className="h-6 w-6" />}
      title="Nenhuma sessão aberta"
      actions={
        <>
          <Link to="/app/analise" className="btn-primary">
            <FileUp className="h-4 w-4" /> Importar telemetria
          </Link>
          <button className="btn-secondary" onClick={() => loadDemo()}>
            <FlaskConical className="h-4 w-4" /> Explorar demonstração
          </button>
        </>
      }
    >
      Para {what}, importe um arquivo CSV ou GPX, abra uma sessão salva ou explore a sessão demonstrativa (dados sintéticos).
    </EmptyState>
  );
}

/** Garante sessão ativa; renderiza estado vazio ou carregamento quando necessário. */
export function WithSession({ what, children }: { what: string; children: (s: Session) => ReactNode }) {
  const { active, ready, activeLoading } = useApp();
  if (!ready || activeLoading) return <Spinner label="Carregando sessão…" />;
  if (!active) return <NoSession what={what} />;
  return <>{children(active)}</>;
}

export function LapSelect({ laps, value, onChange, label, exclude, referenceLap, best, id }: { laps: Lap[]; value: number | null; onChange: (n: number) => void; label?: string; exclude?: number[]; referenceLap?: number | null; best?: number | null; id?: string }) {
  return (
    <select id={id} aria-label={label} className="input !w-auto min-w-[150px]" value={value ?? ''} onChange={(e) => onChange(Number(e.target.value))}>
      {laps
        .filter((l) => !exclude?.includes(l.number))
        .map((l) => (
          <option key={l.number} value={l.number}>
            V{l.number} · {fmtLapTime(l.lapTime)}
            {l.number === referenceLap ? ' · ref.' : ''}
            {best !== null && best !== undefined && l.included && l.number !== referenceLap ? ` (${fmtDelta(l.lapTime - best)})` : ''}
            {!l.included ? ' · excluída' : ''}
          </option>
        ))}
    </select>
  );
}

const CONF_COLOR = { alta: 'text-gain border-gain/40', média: 'text-warn border-warn/40', baixa: 'text-loss border-loss/40' } as const;

export function DiagnosticCard({ d, onSelect, selected, compact }: { d: Diagnostic; onSelect?: (d: Diagnostic) => void; selected?: boolean; compact?: boolean }) {
  return (
    <article
      className={cn(
        'panel overflow-hidden transition-colors',
        onSelect && 'cursor-pointer hover:border-ink-500',
        selected && '!border-gain/60',
      )}
      onClick={() => onSelect?.(d)}
    >
      <div className={cn('h-0.5', d.tone === 'loss' ? 'bg-loss' : d.tone === 'gain' ? 'bg-gain' : 'bg-data')} />
      <div className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="label">{d.segmentName}</div>
            <h3 className="mt-0.5 text-base font-semibold leading-snug">{d.title}</h3>
          </div>
          <span className={cn('chip', CONF_COLOR[d.confidence])} title={d.confidenceReason}>
            Confiança {d.confidence}
          </span>
        </div>
        <ul className="mt-3 space-y-1.5">
          {d.evidence.slice(0, compact ? 3 : undefined).map((e) => (
            <li key={e.label} className="flex items-start justify-between gap-3 text-sm">
              <span className="text-fg-muted">{e.label}</span>
              <span className="flex items-center gap-2">
                <span className="num whitespace-nowrap font-semibold">{e.value}</span>
                {!compact && <KindTag kind={e.kind} />}
              </span>
            </li>
          ))}
        </ul>
        {!compact && (
          <div className="mt-4 space-y-2.5 text-sm leading-relaxed">
            <p>
              <span className="label mr-2">Interpretação</span>
              <span className="text-fg-muted">{d.interpretation}</span>
            </p>
            {d.hypothesis && (
              <p className="flex gap-2">
                <KindTag kind="hypothesis" />
                <span className="text-fg-muted">{d.hypothesis.replace(/^Hipótese: /, '')}</span>
              </p>
            )}
            <p className="flex gap-2">
              <KindTag kind="recommendation" />
              <span>{d.recommendation}</span>
            </p>
            <p className="text-xs text-fg-dim">{d.comparison} {d.confidenceReason}</p>
            {d.limitations.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-4 text-xs text-fg-dim">
                {d.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

export const LAP_COLORS = ['#C6F432', '#4DA3FF', '#FFB547', '#E17CFF', '#4FE3C1', '#FF7A7A'];
