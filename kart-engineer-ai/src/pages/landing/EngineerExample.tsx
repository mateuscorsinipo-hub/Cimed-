import { DiagnosticCard } from '@/components/app/shared';
import { KindTag, Spinner } from '@/components/ui';
import { useDemoData } from './useDemo';

/** Diagnóstico de verdade, gerado pelo motor de regras sobre a sessão demonstrativa sintética. */
export function EngineerExample() {
  const demo = useDemoData();
  if (!demo) {
    return (
      <div className="panel flex h-72 items-center justify-center">
        <Spinner label="Executando o motor de diagnósticos…" />
      </div>
    );
  }
  const d = demo.diagnostics.find((x) => x.rule === 'segment-time-loss') ?? demo.diagnostics[0];
  if (!d) return null;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="label">Saída real do motor · sessão demonstrativa</span>
        <KindTag kind="demo" />
      </div>
      <DiagnosticCard d={d} />
      <p className="mt-2 text-[11px] text-fg-dim">Gerado agora, no seu navegador, pelo mesmo código que analisa seus arquivos. Os dados de entrada são sintéticos (pista fictícia).</p>
    </div>
  );
}
