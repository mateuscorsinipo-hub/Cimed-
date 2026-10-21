# Kart Engineer AI

Plataforma web de engenharia e telemetria para kart: landing page comercial (`/`) e aplicativo (`/app`) com importação de CSV/GPX, comparação de voltas com gráficos sincronizados, mapa do circuito, linha de referência, vídeo onboard sincronizado, engenheiro virtual por regras e relatórios em PDF.

**Sem APIs pagas de IA.** Todo o cálculo é feito no navegador, com código próprio e bibliotecas gratuitas. Os dados ficam no IndexedDB do dispositivo.

## Rodar

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # testes dos cálculos e da validação de arquivos (Vitest)
npm run build      # typecheck + build de produção em dist/
```

Defina `VITE_SITE_URL=https://seu-dominio` no build para gerar `sitemap.xml` (sem domínio configurado, o sitemap não é gerado para não publicar URLs inventadas). O SPA precisa de fallback para `index.html`: `public/_redirects` (Netlify) e `vercel.json` já estão incluídos.

## Arquitetura

```
src/lib/
  telemetry-parser/    leitura CSV/GPX, detecção de colunas e unidades, validação e normalização (SI)
  lap-detector/        voltas por coluna, linha de chegada no GPS (cruzamento interpolado), reinício de distância, comprimento da pista, tempos manuais
  telemetry-metrics/   filtros, derivação (distância/velocidade), reamostragem por distância, estatísticas, consistência
  lap-comparator/      delta acumulado, Δ velocidade, métricas por segmento (entrada/mínima/saída, frenagem, acelerador)
  track-map/           projeção local, limpeza do GPS, curvatura, detecção de curvas, desvio lateral
  onboard-player/      sincronização vídeo↔telemetria (1 ponto = offset; 2+ = ajuste linear), captura de quadro; vision.ts = ponto de extensão NÃO implementado
  diagnostics-engine/  regras determinísticas com evidência, interpretação, hipótese, recomendação, confiança e limitações
  engineer-assistant/  perguntas → intenções → respostas tipadas; llm-provider.ts = integração opcional com modelo na VPS
  session-storage/     IndexedDB (sessões, traçados, preferências), backup JSON
  report-generator/    PDF vetorial (jsPDF) e CSV
  analysis/            pipeline e cliente do Web Worker (src/workers/analysis.worker.ts)
  demo/                pista FICTÍCIA e voltas SINTÉTICAS geradas por modelo físico simples
```

Camadas separadas: processamento numérico (`telemetry-*`, `lap-*`, `track-map`), armazenamento (`session-storage`), diagnósticos (`diagnostics-engine`), modelo de linguagem (`engineer-assistant/llm-provider.ts`, opcional) e interface (`src/pages`, `src/components`).

## O que é medido, derivado ou estimado

- Canais do arquivo são **medidos**. Acelerador, freio e direção **nunca** são inferidos.
- Sem coluna de distância, ela é **derivada** do GPS filtrado ou **estimada** pela integração da velocidade. Sem velocidade, ela é derivada da distância.
- Ponto de frenagem: medido pelo canal de freio quando existe; senão **estimado** pela desaceleração (≥ 0,3 g por ≥ 3 m).
- A "soma dos melhores segmentos" é um cálculo, não uma previsão de tempo.
- Não há linha matematicamente ideal: a aba "Linha ideal" compara trajetórias reais, mede desvio lateral (com piso de ruído do GPS) e permite desenhar uma linha de referência manual.

## Dados demonstrativos

A sessão demo, o CSV de exemplo e os gráficos da landing usam **dados sintéticos** de uma pista fictícia (coordenadas no oceano Atlântico, longe de qualquer kartódromo). Tudo é identificado como demonstração na interface. Os diagnósticos mostrados na landing são a saída real do motor de regras sobre esses dados.

## Integração opcional com modelo open source

Veja [`docs/VPS-LLM.md`](docs/VPS-LLM.md).

## Status por fase

| Fase | Item | Status |
|---|---|---|
| 1 | Landing, rotas, dashboard, importação CSV/GPX, cálculos, comparação, gráficos sincronizados, armazenamento local, diagnósticos | Implementado |
| 2 | Mapa, traçado de referência, onboard, sincronização manual, PDF | Implementado |
| 3 | Detecção de curvas por curvatura + velocidade, desvio lateral entre voltas | Implementado (primeira versão) |
| 3 | Processamento de vídeo por visão computacional | **Não implementado** (`onboard-player/vision.ts` declara `available: false`) |
| 3 | Modelo open source na VPS | Cliente implementado e desativado por padrão; servidor não incluído |
