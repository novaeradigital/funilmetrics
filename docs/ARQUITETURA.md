# Arquitetura proposta

## Visão geral

```text
Meta Ads / Google Drive / Lastlink / Sendflow / Hotwebinar / Datacrazy / Formulários
                              ↓
                 Webhooks e sincronizadores
                              ↓
                  Fila e processamento idempotente
                              ↓
            Dados brutos → normalização → identidade
                              ↓
                 PostgreSQL / Supabase + mídia
                              ↓
             API de aplicação e camada de métricas
                              ↓
           Next.js / dashboards / relatórios / IA
                              ↓
           Aprovação e execução futura de ações
```

## Stack inicial

- TypeScript.
- Next.js e React no frontend.
- Backend TypeScript modular.
- PostgreSQL gerenciado pelo Supabase.
- Drizzle ORM e migrações versionadas.
- Railway para aplicações e workers.
- Armazenamento de objetos para criativos e exportações.
- Fila para processamento assíncrono.

## Organização recomendada

Monorepo:

```text
apps/
  web/
  api/
  worker/
packages/
  database/
  domain/
  integrations/
  metrics/
  ui/
  config/
```

No início, API e web podem compartilhar implantação se isso reduzir complexidade, mas ingestão e tarefas demoradas devem rodar em worker.

## Camadas

1. Ingestão: recebe e autentica.
2. Raw store: preserva o payload.
3. Normalização: converte fontes distintas para contratos internos.
4. Identidade: liga identificadores à pessoa.
5. Domínio: aplica regras de pedidos, funis e jornada.
6. Métricas: cálculos consistentes e versionados.
7. Aplicação: dashboards, filtros e permissões.
8. IA: acessa métricas governadas, não o banco livremente.
9. Ações: executa comandos externos com guardrails.

## Pipeline da Central de Criativos

```text
Pastas autorizadas no Google Drive
→ inventário e checkpoint de sincronização
→ detecção idempotente de novo/alterado/movido/removido
→ download ou exportação autorizada
→ hash e cópia no armazenamento próprio
→ criação de versão imutável do criativo
→ transcrição, extração e análise assíncrona
→ conferência e aprovação humana
→ solicitação e prévia de publicação
→ Meta Ads
→ IDs externos, auditoria e métricas
```

Sincronização, processamento de mídia, IA e publicação rodam em filas
separáveis. Falha em análise não invalida a importação; falha de publicação não
altera a versão aprovada.

## Multiempresa e permissões

- Organização contém projetos.
- Dados são isolados por organização.
- Perfis iniciais: proprietário, administrador, editor, analista e visualizador.
- Acesso de cliente pode ser limitado a projetos e dashboards.

### Contexto global de projeto

O projeto ativo é um contexto de aplicação resolvido antes das consultas, nunca
um filtro visual local. A implementação incremental mantém as rotas públicas
existentes e usa o cookie HTTP-only `funil_metrics_project` como preferência.
Em cada renderização no servidor, o valor é confrontado com a associação ativa
do usuário, a organização e as restrições de `project_memberships`.

- Sem cookie, o primeiro projeto permitido é usado como seleção automática.
- Cookie válido resolve exatamente o projeto solicitado.
- Cookie sem permissão produz contexto bloqueado; não há fallback silencioso.
- O seletor lateral recebe somente a lista já autorizada pelo servidor.
- A troca preserva pathname e query string e invalida o layout do dashboard.
- Logout remove a preferência para não transferir contexto entre identidades.

Rotas com `[projectId]` continuam como evolução futura. Até essa migração, URLs
antigas permanecem compatíveis e toda página resolve o escopo no servidor por
`getActiveProject` antes de consultar dados.

## Confiabilidade

- Idempotência e reprocessamento.
- Dead-letter/quarentena.
- Backoff e limites de API.
- Checkpoints de sincronização.
- Monitoramento de atraso e falhas.
- Backups e testes de restauração.
- Logs sem exposição de segredos ou dados desnecessários.

## Implantação inicial

- API Fastify publicada como serviço separado na Railway.
- Worker de normalização publicado como serviço contínuo separado na Railway,
  consultando a fila no PostgreSQL a cada cinco segundos.
- Interface Next.js preparada como serviço Railway separado, com healthcheck na
  página de login e segredos disponíveis apenas no runtime do servidor.
- Imagem Docker multistage contém somente API e pacotes internos necessários.
- API e worker usam imagens Docker próprias e encerramento gracioso.
- Healthcheck público em `/health`.
- Tráfego de banco usa o pooler de sessão IPv4 do Supabase.
- TLS do PostgreSQL valida a CA oficial do Supabase incluída na imagem.
- O worker processa lotes com bloqueio concorrente, limita retentativas e envia
  falhas esgotadas para quarentena.
- O mesmo processo avalia a qualidade a cada minuto, abre ocorrências
  idempotentes e resolve a ocorrência sem apagar seu histórico quando a condição
  desaparece. Backlog só é considerado parado após dez minutos.
- Erros HTTP inesperados retornam somente código genérico e identificador da
  requisição; consultas, parâmetros e credenciais permanecem nos limites do
  backend.

## Segurança

- Segredos fora do código.
- Credenciais criptografadas.
- OAuth oficial e menor escopo possível para pastas do Google Drive.
- Menor privilégio nas integrações.
- Controle de acesso por organização/projeto.
- Auditoria de login, exportação e ações críticas.
- Política de retenção e atendimento à LGPD.

### Adaptador de armazenamento de criativos

O worker possui adaptador S3 compatível com Cloudflare R2. A configuração é
exclusivamente de servidor e deve estar completa; ausência total mantém o
recurso desativado, enquanto configuração parcial bloqueia a inicialização.

Um bucket privado usa dois prefixos isolados:

- `quarantine/<organization>/<project>/<job>/<item>` para bytes ainda não
  verificados.
- `assets-private/<organization>/<project>/<sha256>` para conteúdo imutável que
  recebeu resultado antimalware `clean`.

A promoção copia primeiro para a chave definitiva e só depois remove o objeto
temporário. Nenhum método produz URL pública.

O cliente ClamAV usa o protocolo `INSTREAM` diretamente por TCP, sem gravar
arquivo temporário no worker. Ele aplica timeout e limite máximo antes de
aceitar o resultado. As respostas internas são reduzidas aos estados `clean`,
`infected`, `unsupported` ou `failed_retryable`; o nome de ameaça é sanitizado.
O cliente não promove objetos e não possui credenciais do R2.

## Escala

O volume informado de 8 mil vendas/mês é confortável para PostgreSQL, desde que visitas e eventos sejam modelados e indexados corretamente. A escala deve considerar principalmente eventos de página e anúncios, que podem superar vendas em várias ordens de magnitude.

### Redirecionador A/B na borda

O caminho público `/r/:slug` passa a possuir um Cloudflare Worker dedicado. O
Worker consulta a configuração assinada na API apenas quando o cache regional
expira, calcula o split deterministicamente, preserva UTMs e `sck`, fixa a
variante em cookie por experimento e responde com `302` sem aguardar a gravação
analítica. Exposições seguem por Cloudflare Queue em produção; a API as persiste
em lote e idempotentemente no PostgreSQL.

A rota Next.js existente permanece como fallback durante a migração e para
contingência. O DNS só é trocado depois de teste de carga, reconciliação de
distribuição e confirmação da fila. Painel, API e processamento continuam na
Railway; somente o caminho crítico de redirecionamento vai para a borda.

## Decisões pendentes

- Redis/serviço de fila definitivo.
- Armazenamento de mídia.
- Provedor de WhatsApp.
- Frequência e retenção por categoria de dado.
- Estratégia de warehouse quando o volume justificar.
- Provedor e política do armazenamento próprio de mídia.
- Estratégia de detecção automática do Drive: notificações, polling ou híbrida.
- Limites de arquivo, codecs e formatos de exportação dos documentos do Google.
# Camada financeira multimoeda

- A borda de ingestão preserva valor e moeda originais. Conversão ocorre depois,
  no worker, por projeto e de forma idempotente.
- `ExchangeRateProvider` desacopla a regra financeira do provedor. A primeira
  implementação usa PTAX de fechamento do BCB e guarda a observação obtida.
- Todo agregado consolidado usa somente `spend_base` com estado `converted` ou
  `not_required`. Linhas pendentes bloqueiam lucro, ROAS e demais derivados.
- O lote nunca mistura projetos. A moeda-base vem de `projects.currency`; a
  moeda de origem confirmada vem de `meta_ad_accounts`.
- Valor original, taxa, data efetiva, fonte, versão da fonte e versão da regra
  formam a evidência reprocessável da conversão.
- O processador usa exclusivamente `spend_original` como entrada. Quando uma
  sincronização altera valor ou moeda, a derivação anterior é invalidada antes
  do reprocessamento, evitando que taxa ou valor-base obsoletos permaneçam na
  linha pendente.
