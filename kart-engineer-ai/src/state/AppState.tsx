import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_PREFERENCES, type Preferences, type Session, type SessionMeta } from '@/lib/types';
import * as store from '@/lib/session-storage';
import { analyseSession, diagnosticContext } from '@/lib/analysis/context';
import { rebuildAnalysis } from '@/lib/analysis/pipeline';
import type { LapTrace } from '@/lib/telemetry-metrics';
import type { Diagnostic, DiagnosticContext } from '@/lib/diagnostics-engine';

interface AppState {
  ready: boolean;
  storageError: string | null;
  prefs: Preferences;
  sessions: SessionMeta[];
  active: Session | null;
  activeLoading: boolean;
  setPrefs: (p: Partial<Preferences>) => Promise<void>;
  refresh: () => Promise<void>;
  openSession: (id: string | null) => Promise<void>;
  /** Persiste a sessão; com rebuild, recalcula referência, segmentos e resumo. */
  updateSession: (s: Session, opts?: { rebuild?: boolean; keepSegments?: boolean }) => Promise<Session>;
  addSession: (s: Session) => Promise<void>;
  removeSession: (id: string) => Promise<void>;
  loadDemo: () => Promise<Session>;
}

const Ctx = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [prefs, setPrefsState] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [active, setActive] = useState<Session | null>(null);
  const [activeLoading, setActiveLoading] = useState(false);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const refresh = useCallback(async () => {
    try {
      setSessions(await store.listSessions());
    } catch (e) {
      setStorageError((e as Error).message);
    }
  }, []);

  const setPrefs = useCallback(async (p: Partial<Preferences>) => {
    const next = { ...prefsRef.current, ...p };
    setPrefsState(next);
    try {
      await store.savePrefs(next);
    } catch (e) {
      setStorageError((e as Error).message);
    }
  }, []);

  const openSession = useCallback(
    async (id: string | null) => {
      if (!id) {
        setActive(null);
        await setPrefs({ activeSessionId: null });
        return;
      }
      setActiveLoading(true);
      try {
        const s = await store.getSession(id);
        setActive(s);
        await setPrefs({ activeSessionId: s ? id : null });
      } finally {
        setActiveLoading(false);
      }
    },
    [setPrefs],
  );

  useEffect(() => {
    (async () => {
      try {
        const p = await store.getPrefs();
        setPrefsState(p);
        const list = await store.listSessions();
        setSessions(list);
        const id = p.activeSessionId && list.some((m) => m.id === p.activeSessionId) ? p.activeSessionId : list[0]?.id;
        if (id) setActive(await store.getSession(id));
      } catch (e) {
        setStorageError((e as Error).message);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const updateSession = useCallback(
    async (s: Session, opts: { rebuild?: boolean; keepSegments?: boolean } = {}) => {
      const next = opts.rebuild ? rebuildAnalysis(s, { keepSegments: opts.keepSegments }) : { ...s, updatedAt: Date.now() };
      await store.saveSession(next);
      setActive((cur) => (cur && cur.id === next.id ? next : cur));
      await refresh();
      return next;
    },
    [refresh],
  );

  const addSession = useCallback(
    async (s: Session) => {
      await store.saveSession(s);
      setActive(s);
      await setPrefs({ activeSessionId: s.id });
      await refresh();
    },
    [refresh, setPrefs],
  );

  const removeSession = useCallback(
    async (id: string) => {
      await store.deleteSession(id);
      const list = await store.listSessions();
      setSessions(list);
      setActive((cur) => (cur?.id === id ? null : cur));
      if (prefsRef.current.activeSessionId === id) {
        const nextId = list[0]?.id ?? null;
        await setPrefs({ activeSessionId: nextId });
        if (nextId) setActive(await store.getSession(nextId));
      }
    },
    [setPrefs],
  );

  const loadDemo = useCallback(async () => {
    const existing = (await store.listSessions()).find((m) => m.isDemo);
    if (existing) {
      const s = await store.getSession(existing.id);
      if (s) {
        setActive(s);
        await setPrefs({ activeSessionId: s.id });
        return s;
      }
    }
    const { buildDemoSession } = await import('@/lib/demo');
    const s = buildDemoSession();
    await addSession(s);
    return s;
  }, [addSession, setPrefs]);

  const value = useMemo<AppState>(
    () => ({ ready, storageError, prefs, sessions, active, activeLoading, setPrefs, refresh, openSession, updateSession, addSession, removeSession, loadDemo }),
    [ready, storageError, prefs, sessions, active, activeLoading, setPrefs, refresh, openSession, updateSession, addSession, removeSession, loadDemo],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp fora do AppStateProvider');
  return c;
}

export interface Analysis {
  traces: Map<number, LapTrace>;
  diagnostics: Diagnostic[];
  ctx: DiagnosticContext | null;
}

/** Traços reamostrados e diagnósticos da sessão ativa (memorizados). */
export function useAnalysis(session: Session | null): Analysis | null {
  const { prefs } = useApp();
  const { deltaThreshold, speedUnit } = prefs;
  return useMemo(() => {
    if (!session) return null;
    const p = { deltaThreshold, speedUnit };
    const { traces, diagnostics } = analyseSession(session, p);
    return { traces, diagnostics, ctx: diagnosticContext(session, traces, p) };
  }, [session, deltaThreshold, speedUnit]);
}
