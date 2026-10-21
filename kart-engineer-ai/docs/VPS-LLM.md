# Modelo de linguagem open source na VPS (opcional)

O Kart Engineer AI **não depende** de modelo de linguagem. O engenheiro virtual responde com um motor determinístico local. O modelo, se configurado, só **reescreve o texto** de respostas já calculadas.

## O que é enviado

Somente o texto estruturado da resposta (pergunta, título e blocos marcados como MEDIÇÃO/ESTIMATIVA/CÁLCULO/HIPÓTESE/RECOMENDAÇÃO/INDISPONÍVEL). Arquivos de telemetria, coordenadas brutas e vídeos nunca são enviados. Veja `serializeAnswer` em `src/lib/engineer-assistant/llm-provider.ts`.

## Requisitos do servidor

- API compatível com OpenAI: `GET /v1/models` e `POST /v1/chat/completions`.
- HTTPS (navegadores bloqueiam HTTP a partir de páginas HTTPS).
- CORS liberando a origem do site (`Access-Control-Allow-Origin`, método `POST`, cabeçalho `Content-Type`).

## Antes de instalar qualquer modelo

Não instale modelos pesados às cegas. Verifique na VPS:

```bash
nproc; free -h; df -h /; uname -m
lspci | grep -i nvidia || echo "sem GPU NVIDIA"
```

Referência aproximada para modelos quantizados em 4 bits (GGUF Q4_K_M) rodando em CPU:

| Modelo (ordem de grandeza) | RAM livre necessária | Observação |
|---|---|---|
| 1–3 B parâmetros | 2–4 GB | rápido em CPU, texto mais simples |
| 7–8 B parâmetros | 6–8 GB | bom equilíbrio para reescrita em português |
| 14 B+ | 12 GB+ | lento sem GPU |

Esses números são estimativas; meça na sua máquina antes de colocar em uso.

## Exemplo com llama.cpp

```bash
# compile o llama.cpp conforme a documentação oficial e baixe um GGUF de licença compatível
./llama-server -m modelo.gguf --host 127.0.0.1 --port 8080 -c 4096
```

Coloque um proxy reverso (Caddy/Nginx) com TLS e CORS na frente. Exemplo Caddy:

```
llm.seudominio.com {
  @preflight method OPTIONS
  header Access-Control-Allow-Origin "https://seu-site"
  header Access-Control-Allow-Headers "Content-Type"
  header Access-Control-Allow-Methods "GET, POST, OPTIONS"
  respond @preflight 204
  reverse_proxy 127.0.0.1:8080
}
```

Restrinja o acesso (autenticação no proxy, firewall ou allowlist), pois o endpoint consome CPU.

## Exemplo com Ollama

Ollama expõe `/v1/chat/completions`. Configure `OLLAMA_ORIGINS=https://seu-site` e coloque TLS na frente.

## No aplicativo

Configurações → "Modelo de linguagem open source" → informe endereço e nome do modelo → **Testar conexão** → **Salvar e ativar**. O app só mostra "Conectado" após um teste bem-sucedido; se a conexão cair, as respostas continuam vindo do motor local.
