import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useApp } from '@/state/AppState';
import { fmtLapTime } from '@/lib/format';

export function SessionPicker() {
  const { sessions, active, openSession } = useApp();
  if (!sessions.length) {
    return (
      <Link to="/app/analise" className="btn-primary btn-sm">
        <Plus className="h-4 w-4" /> Importar telemetria
      </Link>
    );
  }
  return (
    <div className="flex min-w-0 items-center gap-2">
      <label htmlFor="session-picker" className="label hidden sm:block">
        Sessão
      </label>
      <select
        id="session-picker"
        className="input max-w-[min(62vw,360px)] truncate !py-1.5"
        value={active?.id ?? ''}
        onChange={(e) => openSession(e.target.value || null)}
      >
        {!active && <option value="">Selecione uma sessão…</option>}
        {sessions.map((s) => (
          <option key={s.id} value={s.id}>
            {s.isDemo ? '[DEMO] ' : ''}
            {s.name} · {fmtLapTime(s.summary.bestLapTime)}
          </option>
        ))}
      </select>
      <Link to="/app/analise" className="btn-secondary btn-sm hidden sm:inline-flex" title="Nova análise">
        <Plus className="h-4 w-4" />
      </Link>
    </div>
  );
}
