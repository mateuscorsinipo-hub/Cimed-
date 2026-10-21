import { useEffect, useRef, useState } from 'react';
import { Download, HardDrive, Trash2, Upload } from 'lucide-react';
import { PageHeader } from '@/components/app/shared';
import { Field, Notice, Panel, useUi } from '@/components/ui';
import { useApp } from '@/state/AppState';
import { clearAll, exportBackup, importBackup, requestPersistence, storageEstimate } from '@/lib/session-storage';
import { openAICompatibleProvider } from '@/lib/engineer-assistant/llm-provider';
import { downloadBlob } from '@/lib/report-generator';
import { fmtBytes } from '@/lib/format';

export default function Settings() {
  const { prefs, setPrefs, refresh, openSession } = useApp();
  const { toast, confirm } = useUi();
  const [est, setEst] = useState<{ usage: number; quota: number } | null>(null);
  const [endpoint, setEndpoint] = useState(prefs.llm.endpoint);
  const [model, setModel] = useState(prefs.llm.model);
  const [llmStatus, setLlmStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [threshold, setThreshold] = useState(String(prefs.deltaThreshold));
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    storageEstimate().then(setEst).catch(() => setEst(null));
  }, []);
  useEffect(() => {
    setEndpoint(prefs.llm.endpoint);
    setModel(prefs.llm.model);
    setThreshold(String(prefs.deltaThreshold));
  }, [prefs.llm.endpoint, prefs.llm.model, prefs.deltaThreshold]);

  const exportAll = async () => {
    const b = await exportBackup();
    downloadBlob(new Blob([JSON.stringify(b)], { type: 'application/json' }), `kart-engineer-backup-${new Date().toISOString().slice(0, 10)}.json`);
    toast(`${b.sessions.length} sessão(ões) exportada(s).`);
  };

  const wipe = async () => {
    const ok = await confirm({
      title: 'Apagar todos os dados locais?',
      message: 'Todas as sessões, traçados, marcadores e preferências deste navegador serão removidos permanentemente. Exporte um backup antes se quiser guardá-los.',
      confirmLabel: 'Apagar tudo',
      danger: true,
    });
    if (!ok) return;
    await clearAll();
    await openSession(null);
    await refresh();
    toast('Dados locais apagados.');
  };

  const testLlm = async () => {
    setLlmStatus(null);
    const s = await openAICompatibleProvider(endpoint, model).status();
    setLlmStatus({ ok: s.available, text: s.detail });
  };

  const saveThreshold = () => {
    const v = Number(threshold.replace(',', '.'));
    if (!(v >= 0.005 && v <= 1)) {
      toast('O limiar deve estar entre 0,005 e 1 segundo.', 'error');
      return;
    }
    setPrefs({ deltaThreshold: v });
    toast('Limiar atualizado.');
  };

  return (
    <>
      <PageHeader eyebrow="Configurações" title="Preferências e dados" />
      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Análise">
          <div className="space-y-4">
            <Field label="Unidade de velocidade">
              {(id) => (
                <select id={id} className="input !w-auto" value={prefs.speedUnit} onChange={(e) => setPrefs({ speedUnit: e.target.value as 'kmh' | 'mph' })}>
                  <option value="kmh">km/h</option>
                  <option value="mph">mph</option>
                </select>
              )}
            </Field>
            <Field label="Limiar de perda por segmento (s)" hint="Diferença média mínima para o motor de regras apontar um segmento. Padrão: 0,05 s.">
              {(id) => (
                <div className="flex gap-2">
                  <input id={id} className="input w-32" inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
                  <button className="btn-secondary" onClick={saveThreshold}>Aplicar</button>
                </div>
              )}
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-[#C6F432]" checked={!prefs.onboardingDismissed} onChange={(e) => setPrefs({ onboardingDismissed: !e.target.checked })} />
              Mostrar “Primeiros passos” na visão geral
            </label>
          </div>
        </Panel>

        <Panel title="Armazenamento local">
          <p className="text-sm text-fg-muted">Seus dados ficam no IndexedDB deste navegador. Eles podem ser perdidos se você limpar os dados do site, usar modo privado ou outro dispositivo.</p>
          {est && (
            <p className="mt-3 flex items-center gap-2 text-sm"><HardDrive className="h-4 w-4 text-data" /> Em uso: {fmtBytes(est.usage)} de {fmtBytes(est.quota)} disponíveis para este site.</p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn-secondary" onClick={exportAll}><Download className="h-4 w-4" /> Exportar backup (JSON)</button>
            <button className="btn-secondary" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" /> Restaurar backup</button>
            <button className="btn-secondary" onClick={async () => toast((await requestPersistence()) ? 'O navegador concedeu armazenamento persistente.' : 'O navegador não concedeu armazenamento persistente.', 'info')}>Pedir armazenamento persistente</button>
            <button className="btn-danger" onClick={wipe}><Trash2 className="h-4 w-4" /> Apagar todos os dados</button>
            <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const r = await importBackup(JSON.parse(await f.text()));
                await refresh();
                toast(`${r.sessions} sessão(ões) restaurada(s).`);
              } catch (err) {
                toast(err instanceof SyntaxError ? 'Arquivo JSON inválido.' : (err as Error).message, 'error');
              }
              e.target.value = '';
            }} />
          </div>
        </Panel>

        <Panel title="Modelo de linguagem open source (opcional)" className="xl:col-span-2">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-3 text-sm text-fg-muted">
              <p>O engenheiro virtual funciona sem modelo de linguagem. Opcionalmente, um modelo open source na sua própria VPS pode reescrever as explicações em linguagem mais natural. Os cálculos continuam sempre no navegador.</p>
              <p>Compatível com servidores que expõem <code className="text-fg">/v1/chat/completions</code> (llama.cpp server, Ollama, vLLM). Apenas o texto da resposta é enviado — nunca os arquivos de telemetria.</p>
              <p>O servidor precisa de HTTPS (o app é servido em HTTPS) e CORS liberado para este domínio. Veja <code className="text-fg">docs/VPS-LLM.md</code> no repositório.</p>
            </div>
            <div className="space-y-3">
              <Field label="Endereço do servidor" hint="Ex.: https://llm.seudominio.com">
                {(id) => <input id={id} className="input" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://" />}
              </Field>
              <Field label="Modelo" hint="Nome exato do modelo carregado no servidor.">
                {(id) => <input id={id} className="input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="ex.: qwen2.5-7b-instruct" />}
              </Field>
              <div className="flex flex-wrap gap-2">
                <button className="btn-secondary" onClick={testLlm} disabled={!endpoint}>Testar conexão</button>
                <button className="btn-primary" disabled={!endpoint} onClick={() => { setPrefs({ llm: { enabled: true, endpoint: endpoint.trim(), model: model.trim() } }); toast('Configuração salva.'); }}>Salvar e ativar</button>
                {prefs.llm.enabled && <button className="btn-ghost" onClick={() => setPrefs({ llm: { ...prefs.llm, enabled: false } })}>Desativar</button>}
              </div>
              {llmStatus && <Notice tone={llmStatus.ok ? 'ok' : 'warn'}>{llmStatus.text}</Notice>}
              <p className="text-xs text-fg-dim">Status atual: {prefs.llm.enabled ? `ativado (${prefs.llm.endpoint})` : 'desativado'}. O app só indica “conectado” após um teste bem-sucedido.</p>
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}
