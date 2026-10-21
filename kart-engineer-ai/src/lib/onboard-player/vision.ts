/**
 * Ponto de extensão para visão computacional (ex.: detecção de zebras, posição
 * na pista, sincronização automática por quadros). NÃO IMPLEMENTADO.
 *
 * Uma implementação futura deve rodar localmente (WebAssembly/WebGPU) ou na VPS
 * do proprietário, e só pode marcar `available: true` quando de fato processar quadros.
 */
export interface FrameAnalysisResult {
  time: number;
  labels: { name: string; score: number }[];
}

export interface FrameAnalyzer {
  id: string;
  available: boolean;
  reason: string;
  analyze?(frame: ImageBitmap, time: number): Promise<FrameAnalysisResult>;
}

export const frameAnalyzer: FrameAnalyzer = {
  id: 'none',
  available: false,
  reason: 'A análise automática de vídeo ainda não foi implementada. Marcadores e sincronização são manuais.',
};
