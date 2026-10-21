/**
 * Armazenamento local em IndexedDB. Nada é enviado para servidores.
 * Os dados ficam no navegador deste dispositivo e podem ser perdidos se o
 * usuário limpar os dados do site ou usar outro navegador/dispositivo.
 */
import { DEFAULT_PREFERENCES, type Preferences, type Session, type SessionMeta, type TrackDef } from '../types';

const DB_NAME = 'kart-engineer-ai';
const DB_VERSION = 1;
const BACKUP_VERSION = 1;

type StoreName = 'sessions' | 'meta' | 'tracks' | 'prefs';

let dbPromise: Promise<IDBDatabase> | null = null;

export function storageAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  if (!storageAvailable()) return Promise.reject(new Error('IndexedDB indisponível neste navegador (modo privado ou bloqueado).'));
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of ['sessions', 'meta', 'tracks', 'prefs'] as StoreName[]) {
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: s === 'prefs' ? 'key' : 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error ?? new Error('Falha ao abrir o banco local.'));
      };
    });
  }
  return dbPromise;
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(stores: StoreName[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => Promise<T> | T): Promise<T> {
  const db = await openDb();
  const t = db.transaction(stores, mode);
  const done = new Promise<void>((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('Transação cancelada (espaço de armazenamento insuficiente?).'));
  });
  const result = await fn(t);
  await done;
  return result;
}

export function toMeta(s: Session): SessionMeta {
  return { id: s.id, name: s.name, trackName: s.trackName, createdAt: s.createdAt, updatedAt: s.updatedAt, isDemo: s.isDemo, summary: s.summary };
}

export async function listSessions(): Promise<SessionMeta[]> {
  const all = await tx(['meta'], 'readonly', (t) => promisify(t.objectStore('meta').getAll() as IDBRequest<SessionMeta[]>));
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getSession(id: string): Promise<Session | null> {
  const s = await tx(['sessions'], 'readonly', (t) => promisify(t.objectStore('sessions').get(id) as IDBRequest<Session | undefined>));
  return s ?? null;
}

export async function saveSession(s: Session): Promise<void> {
  await tx(['sessions', 'meta'], 'readwrite', (t) => {
    t.objectStore('sessions').put(s);
    t.objectStore('meta').put(toMeta(s));
  });
}

export async function renameSession(id: string, name: string): Promise<void> {
  const s = await getSession(id);
  if (!s) throw new Error('Sessão não encontrada.');
  const trimmed = name.trim();
  if (!trimmed) throw new Error('O nome não pode ficar vazio.');
  await saveSession({ ...s, name: trimmed.slice(0, 120), updatedAt: Date.now() });
}

export async function deleteSession(id: string): Promise<void> {
  await tx(['sessions', 'meta'], 'readwrite', (t) => {
    t.objectStore('sessions').delete(id);
    t.objectStore('meta').delete(id);
  });
}

export async function listTracks(): Promise<TrackDef[]> {
  const all = await tx(['tracks'], 'readonly', (t) => promisify(t.objectStore('tracks').getAll() as IDBRequest<TrackDef[]>));
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveTrack(track: TrackDef): Promise<void> {
  await tx(['tracks'], 'readwrite', (t) => {
    t.objectStore('tracks').put(track);
  });
}

export async function deleteTrack(id: string): Promise<void> {
  await tx(['tracks'], 'readwrite', (t) => {
    t.objectStore('tracks').delete(id);
  });
}

export async function getPrefs(): Promise<Preferences> {
  try {
    const row = await tx(['prefs'], 'readonly', (t) => promisify(t.objectStore('prefs').get('prefs') as IDBRequest<{ key: string; value: Preferences } | undefined>));
    return { ...DEFAULT_PREFERENCES, ...(row?.value ?? {}), llm: { ...DEFAULT_PREFERENCES.llm, ...(row?.value?.llm ?? {}) } };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export async function savePrefs(p: Preferences): Promise<void> {
  await tx(['prefs'], 'readwrite', (t) => {
    t.objectStore('prefs').put({ key: 'prefs', value: p });
  });
}

export async function clearAll(): Promise<void> {
  await tx(['sessions', 'meta', 'tracks', 'prefs'], 'readwrite', (t) => {
    for (const s of ['sessions', 'meta', 'tracks', 'prefs'] as StoreName[]) t.objectStore(s).clear();
  });
}

export interface Backup {
  app: 'kart-engineer-ai';
  version: number;
  exportedAt: string;
  sessions: Session[];
  tracks: TrackDef[];
}

export async function exportBackup(ids?: string[]): Promise<Backup> {
  const metas = await listSessions();
  const sessions: Session[] = [];
  for (const m of metas) {
    if (ids && !ids.includes(m.id)) continue;
    const s = await getSession(m.id);
    if (s) sessions.push(s);
  }
  return { app: 'kart-engineer-ai', version: BACKUP_VERSION, exportedAt: new Date().toISOString(), sessions, tracks: ids ? [] : await listTracks() };
}

/** Valida e importa um backup JSON. Sessões com o mesmo id são substituídas. */
export async function importBackup(json: unknown): Promise<{ sessions: number; tracks: number }> {
  const b = json as Partial<Backup>;
  if (!b || b.app !== 'kart-engineer-ai' || !Array.isArray(b.sessions)) {
    throw new Error('Arquivo não reconhecido como backup do Kart Engineer AI.');
  }
  if ((b.version ?? 0) > BACKUP_VERSION) throw new Error('Backup criado por uma versão mais nova do aplicativo.');
  let n = 0;
  for (const s of b.sessions) {
    if (!s || typeof s.id !== 'string' || !s.channels || !Array.isArray(s.channels.time) || !Array.isArray(s.laps)) {
      throw new Error('Backup corrompido: sessão sem estrutura válida.');
    }
    await saveSession(s);
    n++;
  }
  let t = 0;
  for (const tr of b.tracks ?? []) {
    if (tr && typeof tr.id === 'string' && Array.isArray(tr.points)) {
      await saveTrack(tr);
      t++;
    }
  }
  return { sessions: n, tracks: t };
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  const e = await navigator.storage.estimate();
  return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
}

export async function requestPersistence(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  return navigator.storage.persist();
}
