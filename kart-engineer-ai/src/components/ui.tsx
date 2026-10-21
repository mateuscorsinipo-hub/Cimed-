import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Info, Loader2, X } from 'lucide-react';

export function cn(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(' ');
}

export function Panel({ title, actions, children, className, bodyClass, id }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string; id?: string }) {
  return (
    <section id={id} className={cn('panel', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-600/60 px-4 py-3 sm:px-5">
          {title && <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-fg-muted">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn('panel-pad', bodyClass)}>{children}</div>
    </section>
  );
}

export function Kpi({ label, value, sub, tone, hint }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'gain' | 'loss' | 'data'; hint?: string }) {
  return (
    <div className="panel px-4 py-3.5" title={hint}>
      <div className="label">{label}</div>
      <div className={cn('num mt-1.5 text-2xl font-semibold', tone === 'gain' && 'text-gain', tone === 'loss' && 'text-loss', tone === 'data' && 'text-data')}>{value}</div>
      {sub && <div className="mt-1 text-xs text-fg-muted">{sub}</div>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 text-sm text-fg-muted">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      {label ?? 'Carregando…'}
    </div>
  );
}

export function Notice({ tone = 'info', title, children }: { tone?: 'info' | 'warn' | 'error' | 'ok'; title?: string; children?: ReactNode }) {
  const Icon = tone === 'ok' ? CheckCircle2 : tone === 'info' ? Info : AlertTriangle;
  const color = { info: 'border-data/30 bg-data/5 text-data', warn: 'border-warn/30 bg-warn/5 text-warn', error: 'border-loss/40 bg-loss/5 text-loss', ok: 'border-gain/30 bg-gain/5 text-gain' }[tone];
  return (
    <div className={cn('flex gap-3 rounded-lg border px-3.5 py-3 text-sm', color)} role={tone === 'error' ? 'alert' : undefined}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="text-fg-muted">
        {title && <div className="mb-0.5 font-semibold text-fg">{title}</div>}
        {children}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, children, actions }: { icon?: ReactNode; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="panel grid-bg flex flex-col items-center px-6 py-12 text-center">
      {icon && <div className="mb-4 rounded-xl border border-ink-500 bg-ink-800 p-3 text-gain">{icon}</div>}
      <h2 className="text-xl font-semibold">{title}</h2>
      {children && <div className="mt-2 max-w-lg text-sm text-fg-muted">{children}</div>}
      {actions && <div className="mt-6 flex flex-wrap justify-center gap-3">{actions}</div>}
    </div>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-semibold text-fg-muted">
        {label}
      </label>
      {children(id)}
      {error ? <p className="mt-1 text-xs text-loss">{error}</p> : hint ? <p className="mt-1 text-xs text-fg-dim">{hint}</p> : null}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: { id: T; label: ReactNode }[]; className?: string }) {
  return (
    <div role="tablist" className={cn('inline-flex flex-wrap gap-1 rounded-lg border border-ink-600 bg-ink-900 p-1', className)}>
      {items.map((it) => (
        <button
          key={it.id}
          role="tab"
          aria-selected={value === it.id}
          onClick={() => onChange(it.id)}
          className={cn('rounded-md px-3 py-1.5 text-xs font-semibold transition-colors', value === it.id ? 'bg-ink-600 text-fg' : 'text-fg-muted hover:text-fg')}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function Accordion({ items }: { items: { q: string; a: ReactNode }[] }) {
  const [open, setOpen] = useState<number | null>(0);
  const base = useId();
  return (
    <div className="divide-y divide-ink-600 rounded-panel border border-ink-600 bg-ink-850">
      {items.map((it, i) => {
        const isOpen = open === i;
        return (
          <div key={it.q}>
            <h3>
              <button
                id={`${base}-h${i}`}
                aria-expanded={isOpen}
                aria-controls={`${base}-p${i}`}
                onClick={() => setOpen(isOpen ? null : i)}
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-base font-semibold hover:text-gain"
              >
                {it.q}
                <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', isOpen && 'rotate-180')} aria-hidden />
              </button>
            </h3>
            <div id={`${base}-p${i}`} role="region" aria-labelledby={`${base}-h${i}`} hidden={!isOpen} className="px-5 pb-5 text-sm leading-relaxed text-fg-muted">
              {it.a}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input,button,select,textarea')?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="panel w-full max-w-lg animate-fadeUp rounded-b-none sm:rounded-panel">
        <div className="flex items-center justify-between border-b border-ink-600 px-5 py-3.5">
          <h2 className="text-base font-semibold">{title}</h2>
          <button className="btn-ghost btn-sm" onClick={onClose} aria-label="Fechar">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4 text-sm text-fg-muted">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-ink-600 px-5 py-3.5">{footer}</div>}
      </div>
    </div>
  );
}

interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}

interface Toast {
  id: number;
  tone: 'ok' | 'error' | 'info';
  text: string;
}

interface UiCtx {
  toast: (text: string, tone?: Toast['tone']) => void;
  confirm: (o: ConfirmOptions) => Promise<boolean>;
}

const UiContext = createContext<UiCtx | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const toast = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  const confirm = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setDialog({ ...o, resolve })), []);
  const close = (v: boolean) => {
    dialog?.resolve(v);
    setDialog(null);
  };
  return (
    <UiContext.Provider value={{ toast, confirm }}>
      {children}
      <Modal
        open={!!dialog}
        onClose={() => close(false)}
        title={dialog?.title ?? ''}
        footer={
          <>
            <button className="btn-secondary" onClick={() => close(false)}>
              Cancelar
            </button>
            <button className={dialog?.danger ? 'btn-danger' : 'btn-primary'} onClick={() => close(true)}>
              {dialog?.confirmLabel ?? 'Confirmar'}
            </button>
          </>
        }
      >
        {dialog?.message}
      </Modal>
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,380px)] flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto animate-fadeUp rounded-lg border bg-ink-800 px-4 py-3 text-sm shadow-2xl',
              t.tone === 'ok' && 'border-gain/40',
              t.tone === 'error' && 'border-loss/50',
              t.tone === 'info' && 'border-data/40',
            )}
          >
            {t.text}
          </div>
        ))}
      </div>
    </UiContext.Provider>
  );
}

export function useUi(): UiCtx {
  const c = useContext(UiContext);
  if (!c) throw new Error('useUi fora do UiProvider');
  return c;
}

/** Etiqueta que declara a natureza de um dado. */
export function KindTag({ kind }: { kind: 'measured' | 'estimated' | 'calculated' | 'derived' | 'hypothesis' | 'recommendation' | 'unavailable' | 'demo' }) {
  const map = {
    measured: ['Medição', 'border-gain/40 text-gain'],
    derived: ['Derivado', 'border-data/40 text-data'],
    estimated: ['Estimativa', 'border-warn/40 text-warn'],
    calculated: ['Cálculo', 'border-data/40 text-data'],
    hypothesis: ['Hipótese', 'border-warn/40 text-warn'],
    recommendation: ['Recomendação', 'border-gain/40 text-gain'],
    unavailable: ['Indisponível', 'border-ink-500 text-fg-dim'],
    demo: ['Dados demonstrativos', 'border-warn/50 bg-warn/10 text-warn'],
  } as const;
  const [label, cls] = map[kind];
  return <span className={cn('chip h-fit shrink-0 self-start whitespace-nowrap', cls)}>{label}</span>;
}

export function useDocumentMeta(title: string, description?: string) {
  useEffect(() => {
    document.title = title;
    if (description) document.querySelector('meta[name="description"]')?.setAttribute('content', description);
  }, [title, description]);
}
