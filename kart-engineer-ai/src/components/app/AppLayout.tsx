import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Activity, BrainCircuit, FileText, FolderOpen, GitCompareArrows, LayoutDashboard, Menu, Route, Settings, Upload, Video, X,
} from 'lucide-react';
import { Logo } from '../brand/Logo';
import { cn, Notice } from '../ui';
import { useApp } from '@/state/AppState';
import { SessionPicker } from './SessionPicker';

export const NAV = [
  { to: '/app', label: 'Visão geral', icon: LayoutDashboard, end: true },
  { to: '/app/sessoes', label: 'Sessões', icon: FolderOpen },
  { to: '/app/analise', label: 'Nova análise', icon: Upload },
  { to: '/app/comparar', label: 'Comparar voltas', icon: GitCompareArrows },
  { to: '/app/onboard', label: 'Vídeos onboard', icon: Video },
  { to: '/app/tracado', label: 'Traçado', icon: Route },
  { to: '/app/engenheiro', label: 'Engenheiro virtual', icon: BrainCircuit },
  { to: '/app/relatorios', label: 'Relatórios', icon: FileText },
  { to: '/app/configuracoes', label: 'Configurações', icon: Settings },
];

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Navegação do aplicativo" className="flex flex-col gap-0.5">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
              isActive ? 'bg-ink-700 text-fg' : 'text-fg-muted hover:bg-ink-800 hover:text-fg',
            )
          }
        >
          {({ isActive }) => (
            <>
              {isActive && <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-gain" aria-hidden />}
              <Icon className={cn('h-4 w-4', isActive ? 'text-gain' : 'text-fg-dim group-hover:text-fg-muted')} aria-hidden />
              {label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

export function AppLayout() {
  const [open, setOpen] = useState(false);
  const { storageError, active } = useApp();
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    document.title = 'Kart Engineer AI — Aplicativo';
  }, []);

  return (
    <div className="min-h-screen bg-ink-900">
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-ink-700 bg-ink-950 px-3 py-4 lg:flex">
        <Logo to="/" className="px-2" />
        <div className="mt-6 flex-1 overflow-y-auto">
          <NavItems />
        </div>
        <div className="rounded-lg border border-ink-700 p-3 text-[11px] leading-relaxed text-fg-dim">
          <div className="mb-1 flex items-center gap-1.5 font-semibold text-fg-muted">
            <Activity className="h-3.5 w-3.5 text-gain" /> Processamento local
          </div>
          Seus arquivos são processados neste navegador e salvos apenas neste dispositivo.
        </div>
      </aside>

      {open && (
        <div className="no-print fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setOpen(false)}>
          <aside className="h-full w-72 max-w-[85vw] border-r border-ink-700 bg-ink-950 px-3 py-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-6 flex items-center justify-between px-2">
              <Logo to="/" />
              <button className="btn-ghost btn-sm" onClick={() => setOpen(false)} aria-label="Fechar menu">
                <X className="h-5 w-5" />
              </button>
            </div>
            <NavItems onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="lg:pl-60">
        <header className="no-print sticky top-0 z-20 flex items-center gap-3 border-b border-ink-700 bg-ink-900/90 px-4 py-2.5 backdrop-blur sm:px-6">
          <button className="btn-ghost btn-sm lg:hidden" onClick={() => setOpen(true)} aria-label="Abrir menu">
            <Menu className="h-5 w-5" />
          </button>
          <div className="lg:hidden">
            <Logo to="/" className="[&>span]:hidden sm:[&>span]:inline" />
          </div>
          <div className="ml-auto flex min-w-0 items-center gap-2">
            <SessionPicker />
          </div>
        </header>
        {active?.isDemo && (
          <div className="no-print border-b border-warn/30 bg-warn/10 px-4 py-1.5 text-center text-xs text-warn sm:px-6">
            Você está vendo <strong>dados demonstrativos sintéticos</strong> de uma pista fictícia. Importe seus arquivos em “Nova análise”.
          </div>
        )}
        <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:py-8">
          {storageError && (
            <div className="mb-4">
              <Notice tone="error" title="Armazenamento local indisponível">
                {storageError} As análises funcionam, mas não serão salvas.
              </Notice>
            </div>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
