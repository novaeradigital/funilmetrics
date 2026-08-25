# Fontes originais do projeto

Esta pasta preserva os arquivos usados como evidência durante a descoberta do Funil Metrics. Os documentos oficiais em `docs/` registram as decisões do produto; os arquivos desta pasta servem para validar integrações, campos e contexto.

## Estrutura

### `ferramentas/`

- `Contexto_Tecnico_Sistemas_Funil.docx`: informações sobre as ferramentas utilizadas, integrações possíveis e dados enviados ou recebidos.

### `lastlink/`

- `webhook_logs_2026-07-23.xlsx`
- `webhook_logs_2026-07-23-parte-2.xlsx`

Logs exportados da Lastlink. Devem ser analisados como evidência dos payloads realmente disponíveis. Não presumir que um campo ausente nesses arquivos nunca existe; diferenças podem depender do tipo de evento, produto ou configuração.

### `conversas/`

- `conversa-inicial-claude.txt`: conversa inicial usada como referência durante a definição do projeto.

Conversas não substituem o PRD nem as decisões registradas. Em caso de conflito, prevalecem os documentos oficiais do projeto.

### `transicao/`

- `resumo-leitura-nova-tarefa.txt`: resumo produzido após a nova tarefa ler a documentação.

## Regras de uso

- Não modificar os arquivos originais.
- Criar cópias anonimizadas antes de compartilhar externamente.
- Não publicar nomes, e-mails, telefones, documentos, endereços, tokens ou segredos.
- Guardar análises derivadas fora desta pasta.
- Documentar campos comprovados em `docs/INTEGRACOES.md`.
- Guardar exemplos anonimizados de payload em `docs/payloads/<fonte>/`.

## Prioridade da informação

1. PRD, regras de negócio e decisões em `docs/`.
2. Payloads e documentos originais desta pasta.
3. Conversas e resumos, apenas como contexto complementar.
