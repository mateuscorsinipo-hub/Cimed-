import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, FileUp, FolderOpen, Pencil, Trash2, Upload } from 'lucide-react';
import { PageHeader } from '@/components/app/shared';
import { EmptyState, Modal, Panel, Spinner, useUi, cn } from '@/components/ui';
import { useApp } from '@/state/AppState';
import { exportBackup, importBackup, renameSession } from '@/lib/session-storage';
import { downloadBlob, safeFileName } from '@/lib/report-generator';
import { fmtDate, fmtLapTime } from '@/lib/format';
import type { SessionMeta } from '@/lib/types';

export default function Sessions() {
  const { ready, sessions, active, openSession, removeSession, refresh, updateSession } = useApp();
  const { confirm, toast } = useUi();
  const [renaming, setRenaming] = useState<SessionMeta | null>(null);
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!ready) return <Spinner />;

  const doRename = async () => {
    if (!renaming) return;
    if (!name.trim()) {
      setErr('O nome não pode ficar vazio.');
      return;
    }
    try {
      await renameSession(renaming.id, name);
      if (active?.id === renaming.id) await updateSession({ ...active, name: name.trim() });
      await refresh();
      toast('Sessão renomeada.');
      setRenaming(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const doDelete = async (m: SessionMeta) => {
    const ok = await confirm({
      title: 'Excluir sessão?',
      message: (
        <>
          A sessão <strong className="text-fg">{m.name}</strong> e suas marcações serão removidas deste dispositivo. Esta ação não pode ser desfeita. Exporte um backup antes, se quiser guardar uma cópia.
        </>
      ),
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    await removeSession(m.id);
    toast('Sessão excluída.');
  };

  const exportOne = async (m: SessionMeta) => {
    const b = await exportBackup([m.id]);
    downloadBlob(new Blob([JSON.stringify(b)], { type: 'application/json' }), `${safeFileName(m.name)}.kart.json`);
  };

  const onImport = async (f?: File) => {
    if (!f) return;
    try {
      const json = JSON.parse(await f.text());
      const r = await importBackup(json);
      await refresh();
      toast(`${r.sessions} sessão(ões) e ${r.tracks} traçado(s) importados.`);
    } catch (e) {
      toast(e instanceof SyntaxError ? 'O arquivo não é um JSON válido.' : (e as Error).message, 'error');
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Sessões"
        title="Sessões salvas"
        subtitle="Armazenadas localmente neste navegador (IndexedDB). Exporte backups para não perdê-las."
        actions={
          <>
            <button className="btn-secondary" onClick={() => fileRef.current?.click()}>
              <Upload className="h-4 w-4" /> Importar backup
            </button>
            <Link to="/app/analise" className="btn-primary">
              <FileUp className="h-4 w-4" /> Nova análise
            </Link>
            <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => onImport(e.target.files?.[0])} />
          </>
        }
      />
      {!sessions.length ? (
        <EmptyState icon={<FolderOpen className="h-6 w-6" />} title="Nenhuma sessão salva" actions={<Link to="/app/analise" className="btn-primary">Importar telemetria</Link>}>
          Importe um arquivo CSV ou GPX, ou restaure um backup JSON exportado anteriormente.
        </EmptyState>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {sessions.map((m) => (
            <Panel key={m.id} className={cn(m.id === active?.id && '!border-gain/50')}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-semibold">{m.name}</h2>
                  <p className="truncate text-sm text-fg-muted">{m.trackName || 'Pista não informada'} · {fmtDate(m.createdAt)}</p>
                </div>
                {m.isDemo && <span className="chip border-warn/40 text-warn">demo</span>}
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-ink-900 p-2"><dt className="label">Melhor</dt><dd className="num mt-0.5 font-semibold text-gain">{fmtLapTime(m.summary.bestLapTime)}</dd></div>
                <div className="rounded-lg bg-ink-900 p-2"><dt className="label">Média</dt><dd className="num mt-0.5 font-semibold">{fmtLapTime(m.summary.meanLapTime)}</dd></div>
                <div className="rounded-lg bg-ink-900 p-2"><dt className="label">Voltas</dt><dd className="num mt-0.5 font-semibold">{m.summary.validLapCount}/{m.summary.lapCount}</dd></div>
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link to={`/app/sessoes/${m.id}`} className="btn-primary btn-sm" onClick={() => openSession(m.id)}>Abrir</Link>
                <button className="btn-secondary btn-sm" onClick={() => { setRenaming(m); setName(m.name); setErr(null); }}><Pencil className="h-3.5 w-3.5" /> Renomear</button>
                <button className="btn-secondary btn-sm" onClick={() => exportOne(m)}><Download className="h-3.5 w-3.5" /> Exportar</button>
                <button className="btn-danger btn-sm" onClick={() => doDelete(m)}><Trash2 className="h-3.5 w-3.5" /> Excluir</button>
              </div>
            </Panel>
          ))}
        </div>
      )}
      <Modal
        open={!!renaming}
        onClose={() => setRenaming(null)}
        title="Renomear sessão"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setRenaming(null)}>Cancelar</button>
            <button className="btn-primary" onClick={doRename}>Salvar</button>
          </>
        }
      >
        <form onSubmit={(e) => { e.preventDefault(); doRename(); }}>
          <label htmlFor="rename" className="mb-1.5 block text-xs font-semibold">Nome</label>
          <input id="rename" className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          {err && <p className="mt-1 text-xs text-loss">{err}</p>}
        </form>
      </Modal>
    </>
  );
}
