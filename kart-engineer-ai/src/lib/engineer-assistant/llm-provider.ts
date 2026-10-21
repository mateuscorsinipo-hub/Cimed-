/**
 * Interface opcional para um modelo de linguagem open source hospedado pelo
 * proprietário (ex.: llama.cpp server, Ollama, vLLM) com API compatível com
 * /v1/chat/completions. Desativada por padrão.
 *
 * Regras:
 *  - o modelo só reescreve explicações de respostas já calculadas;
 *  - nenhum dado bruto de telemetria é enviado, apenas o texto estruturado da resposta;
 *  - o status só é "disponível" após um teste de conexão bem-sucedido.
 */
import type { EngineerAnswer } from './index';

export interface ProviderStatus {
  available: boolean;
  detail: string;
}

export interface ExplanationProvider {
  id: string;
  label: string;
  status(signal?: AbortSignal): Promise<ProviderStatus>;
  explain(answer: EngineerAnswer, signal?: AbortSignal): Promise<string>;
}

export const disabledProvider: ExplanationProvider = {
  id: 'disabled',
  label: 'Desativado',
  async status() {
    return { available: false, detail: 'Nenhum modelo configurado. As respostas usam apenas o motor determinístico local.' };
  },
  async explain() {
    throw new Error('Nenhum modelo de linguagem configurado.');
  },
};

const SYSTEM_PROMPT = [
  'Você é um assistente que reescreve, em português claro, análises de telemetria de kart já calculadas.',
  'Use SOMENTE os números e fatos fornecidos. Não invente valores, causas, recordes nem promessas de ganho.',
  'Mantenha explícita a diferença entre medição, estimativa, hipótese e recomendação.',
  'Não recomende manobras que aumentem o risco; sugira mudanças graduais e uma variável por vez.',
].join(' ');

export function serializeAnswer(a: EngineerAnswer): string {
  const label: Record<string, string> = {
    measurement: 'MEDIÇÃO',
    estimate: 'ESTIMATIVA',
    calculation: 'CÁLCULO',
    hypothesis: 'HIPÓTESE',
    recommendation: 'RECOMENDAÇÃO',
    unavailable: 'INDISPONÍVEL',
    text: 'NOTA',
  };
  return [`Pergunta: ${a.question}`, `Título: ${a.title}`, ...a.blocks.map((b) => `[${label[b.kind]}] ${b.text}`)].join('\n');
}

export function openAICompatibleProvider(endpoint: string, model: string): ExplanationProvider {
  const base = endpoint.replace(/\/+$/, '');
  return {
    id: 'vps',
    label: `Modelo na VPS (${model || 'sem modelo'})`,
    async status(signal) {
      if (!/^https?:\/\//.test(base)) return { available: false, detail: 'Endereço inválido. Use http(s)://host:porta.' };
      try {
        const r = await fetch(`${base}/v1/models`, { signal });
        if (!r.ok) return { available: false, detail: `O servidor respondeu ${r.status}.` };
        const j = (await r.json()) as { data?: { id: string }[] };
        const ids = j.data?.map((m) => m.id) ?? [];
        if (model && ids.length && !ids.includes(model)) {
          return { available: false, detail: `Servidor acessível, mas o modelo "${model}" não está carregado. Disponíveis: ${ids.join(', ')}.` };
        }
        return { available: true, detail: `Conectado. Modelos: ${ids.join(', ') || 'não informado'}.` };
      } catch (e) {
        return { available: false, detail: `Sem conexão: ${(e as Error).message}. Verifique endereço, HTTPS e CORS.` };
      }
    },
    async explain(answer, signal) {
      const r = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: 400,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: serializeAnswer(answer) },
          ],
        }),
      });
      if (!r.ok) throw new Error(`O modelo respondeu ${r.status}.`);
      const j = (await r.json()) as { choices?: { message?: { content?: string } }[] };
      const text = j.choices?.[0]?.message?.content?.trim();
      if (!text) throw new Error('Resposta vazia do modelo.');
      return text;
    },
  };
}
