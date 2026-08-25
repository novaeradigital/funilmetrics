# Modelo de dados conceitual

## Dashboards personalizáveis

- `dashboards`: identidade, projeto, período padrão e ciclo de vida.
- `dashboard_versions`: rascunhos e versões publicadas imutáveis.
- `dashboard_widgets`: tipo, métrica governada, configuração e posição em grade
  pertencentes a uma versão.
- `dashboard_templates`: composições reutilizáveis do sistema ou do projeto.
- `dashboard_access`: concessões adicionais de visualização ou edição por
  membership, sem ampliar o acesso ao projeto.

Publicar preserva a versão publicada e deriva um novo rascunho. Arquivar não
apaga versões ou widgets. Registros operacionais carregam o escopo de organização
e projeto; widgets não armazenam fórmulas livres.

## Organização

### Bases financeiras normalizadas da Lastlink

`normalized_payment_events` preserva `sale_amount` e
`sale_financial_effect` para o valor total, alem de
`producer_commission_amount` e `producer_commission_financial_effect` para a
comissao `PRODUCER`. `commission_data_status` distingue `complete` de `missing`.
O retroprocessamento deriva esses campos exclusivamente de `raw_events` e do
efeito idempotente ja aplicado, sem editar o payload bruto. `amount` e
`financial_effect` permanecem temporariamente como base total legada.

- `organizations`
- `projects`
- `users`
- `memberships`
- `roles`
- `audit_logs`

### Projeto como escopo operacional

`projects` é o contexto global da aplicação. Produto, oferta, pedido, pessoa,
evento, conexão, campanha, criativo, funil, dashboard, relatório e alerta
pertencem ao par `organization_id` + `project_id` quando vinculados a projeto.
O produto é uma dimensão interna N:1 do projeto e nunca substitui o projeto
ativo. Um projeto pode existir sem produtos e um projeto pode possuir vários
produtos; filtros de produto operam somente sobre o catálogo do projeto atual.

O projeto selecionado não é persistido nas entidades de domínio. Ele é uma
preferência de navegação validada contra `memberships` e
`project_memberships` a cada resolução no servidor.

### Schema físico inicial

A primeira migração física está em
`packages/database/drizzle/0000_slow_thena.sql` e contém:

- `organizations`: organização e slug global único.
- `projects`: projeto com slug único dentro da organização, moeda e fuso.
- `users`: perfil interno e vínculo opcional futuro com o usuário do Supabase
  Auth.
- `memberships`: papel do usuário na organização.
- `project_memberships`: acesso explícito e eventual papel específico por
  projeto.
- `audit_logs`: ação, autor, alvo, motivo, antes, depois, metadados e instante.

O papel organizacional usa `owner`, `administrator`, `editor`, `analyst` ou
`viewer`. As relações de projeto usam chaves estrangeiras compostas para impedir
vínculos entre organizações diferentes.

Ainda não estão concluídos nesta etapa:

- fluxo de convite, login e ativação;
- matriz de capacidades por papel;
- serviços e endpoints de administração;
- política de retenção dos registros de auditoria.

### RLS inicial

As políticas iniciais estão em
`supabase/migrations/20260724022000_initial_rls.sql`.

- Usuário autenticado lê seu próprio perfil.
- Membro ativo lê sua organização.
- Proprietário e administrador leem todos os projetos da organização.
- Demais papéis leem somente projetos com vínculo explícito.
- Auditoria é visível somente para proprietário e administrador.
- Escritas diretas pelos papéis `anon` e `authenticated` estão bloqueadas.
- Escritas administrativas devem passar pelo backend e registrar auditoria.

## Identidade

- `people`: pessoa canônica.
- `identities`: e-mail, telefone, cookie, click ID e IDs externos.
- `identity_links`: evidência e confiança da ligação.
- `merge_history`: fusões e reversões.
- `sessions`: sequência técnica de navegação.

## Marketing

- `traffic_sources`
- `ad_accounts`
- `campaigns`
- `ad_sets`
- `ads`
- `creatives`
- `creative_assets`: arquivo armazenado pelo Funil Metrics.
- `creative_versions`: versão imutável e publicável de um criativo.
- `creative_version_assets`: arquivos que compõem uma versão.
- `creative_source_links`: vínculo entre criativo/versão e arquivo de origem.
- `creative_status_history`: transições de status com autor e motivo.
- `creative_tags`
- `creative_tag_assignments`
- `creative_transcripts`
- `creative_text_extractions`
- `creative_analyses`
- `creative_approvals`
- `creative_publication_requests`
- `creative_publication_previews`
- `creative_publications`
- `meta_publication_executions`: simulação, liberação manual, tentativas,
  reconciliação e IDs externos retornados, com chave idempotente.
- `creative_ad_links`: relação N:N entre criativo/versão e anúncio publicado.

Implementado na camada editorial:

- `creative_editorial_metadata`: copy, headline, CTA, destino e observações
  vinculados à versão exata e ao último editor.
- `creative_tags`: catálogo normalizado e isolado por organização/projeto.
- `creative_tag_assignments`: vínculo da tag com criativo e versão, origem
  manual ou IA, confiança quando aplicável e remoção histórica por
  `removed_at`.
- `utm_touchpoints`

Criativo é separado de anúncio para consolidar uma peça reutilizada em vários anúncios.

### Regras da Central de Criativos

- `creatives` representa o conceito reutilizável.
- `creative_assets` representa um arquivo copiado para armazenamento próprio.
- `creative_versions` congela a composição e os metadados aprováveis.
- Arquivo do Drive é origem; não substitui o ativo interno.
- Alteração de conteúdo cria nova versão.
- Movimento ou renomeação sem alteração de conteúdo atualiza a origem e seu
  histórico.
- Uma publicação referencia exatamente a versão aprovada.
- Uma versão pode participar de vários anúncios e campanhas.
- Status atual não substitui `creative_status_history`.

Status iniciais:

- `new`
- `imported`
- `analyzing`
- `awaiting_approval`
- `approved`
- `ready_to_publish`
- `published`
- `paused`
- `winner`
- `fatigued`
- `archived`

## Funis

- `funnels`
- `funnel_versions`
- `funnel_steps`
- `funnel_entries`
- `step_events`
- `launches`
- `webinars`
- `webinar_sessions`
- `webinar_participations`

## Produtos e receita

- `products`
- `offers`
- `orders`
- `order_items`
- `transactions`
- `payment_events`
- `refunds`
- `ascensions`

Pedido não é sinônimo de pagamento. Mudanças financeiras são eventos.

## Comportamento

- `events`: contrato normalizado.
- `raw_events`: payload original, hash, fonte e processamento.
- `event_links`: relações do evento com pessoa, sessão, campanha, funil e teste.

Implementado na primeira etapa da Lastlink:

- `connections`: conexão externa vinculada obrigatoriamente a organização e
  projeto.
- `webhook_endpoints`: identificador público e hashes dos tokens atual e
  anterior; não guarda o segredo em texto puro.
- `raw_events`: corpo textual original, JSON quando válido, hash SHA-256,
  estratégia de idempotência, validação e estado de processamento.
- `people` e `person_identifiers`: identidade separada por organização, projeto
  e escopo (`production`, `test` ou `unknown`).
- `commerce_products`, `commerce_offers`, `commerce_orders` e
  `commerce_order_items`: catálogo e pedidos preservando todos os produtos.
- `product_classifications`: papel atual e histórico do produto na jornada,
  produto pai, fonte, confiança, motivo e responsável pela classificação.

Na Lastlink, `Data.Products` pode conter o produto principal e order bumps. Todos
permanecem como itens do pedido, mas a conexão registra separadamente o produto
principal confirmado. Os demais itens de produção da mesma conexão podem ser
apresentados como order bumps; a classificação não deve ser inferida apenas pela
posição no array.
- `payments` e `normalized_payment_events`: estado consolidado e fatos
  financeiros idempotentes, ligados ao evento bruto.
- `order_attributions`: UTMs, `src`, `sck`, `vtid` e URL de origem normalizados
  sem remover os valores do payload bruto.

Todas essas tabelas usam RLS. O cliente autenticado pode consultar somente os
metadados das conexões autorizadas. Endpoints e eventos brutos, que podem conter
segredos ou dados pessoais, e a camada normalizada permanecem sem acesso direto
pelo navegador nesta etapa.

A modelagem deverá evoluir para múltiplos endpoints Lastlink no mesmo projeto.
Cada endpoint terá rótulo e vínculo com o produto externo correspondente, além
de token próprio. A restrição física atual de um endpoint por conexão será
revista antes da tela administrativa, sem misturar eventos históricos entre
produtos.

## Atribuição

- `touchpoints`
- `conversions`
- `attribution_models`
- `attribution_runs`
- `attribution_credits`

Os créditos são resultados recalculáveis e não substituem os eventos.

## Experimentação

- `domains`
- `smart_links`
- `experiments`
- `variants`
- `allocations`
- `exposures`
- `experiment_conversions`

## Lead scoring e persona

- `surveys`
- `questions`
- `survey_responses`
- `score_models`
- `score_factors`
- `score_results`
- `segments`

## Integrações

- `connections`
- `drive_connections`
- `drive_folders`: pasta autorizada e seu vínculo de escopo.
- `drive_files`: estado atual conhecido do arquivo externo.
- `drive_file_revisions`: revisões/metadados observados na origem.
- `drive_sync_jobs`
- `drive_sync_checkpoints`
- `drive_change_records`: novo, alterado, movido ou removido.
- `webhook_endpoints`
- `sync_jobs`
- `sync_checkpoints`
- `processing_failures`
- `data_quality_issues`
- `meta_authorizations`: modo OAuth ou usuário do sistema, identidade externa,
  escopos, validade e estado de revogação.
- `meta_oauth_states`: estado OAuth descartável, com expiração e consumo único.
- `meta_ad_accounts`: contas explicitamente autorizadas por projeto.
- `meta_campaigns`: campanhas observadas no catálogo somente leitura.
- `meta_ad_sets`: conjuntos observados e valores monetários em unidade mínima.

`data_quality_issues` preserva ocorrências abertas e resolvidas. A chave da
regra é única apenas enquanto aberta, permitindo atualizar a evidência sem
duplicar alertas e criar uma nova ocorrência caso o problema reapareça depois
de resolvido.

### Fundação física da Central de Criativos

A migração `20260724223000_creative_drive_foundation.sql` materializa o núcleo
inicial, ainda sem executar OAuth ou importar arquivos:

- `drive_connections`: vínculo do Google com referência externa ao segredo;
  nunca armazena refresh token em texto puro.
- `drive_folders`: pasta explicitamente autorizada, projeto, caminho conhecido e
  estado da permissão.
- `drive_files`: estado atual conhecido do arquivo no Drive, incluindo ID,
  nome, MIME type, tamanho e modificação na origem.
- `creative_assets`: cópia interna endereçada por hash, chave imutável no R2 e
  resultado do antimalware.
- `creatives`: conceito reutilizável e status atual.
- `creative_versions`: versão imutável ligada ao arquivo observado e aos bytes
  copiados.
- `drive_import_jobs` e `drive_import_items`: execução manual idempotente,
  progresso, tentativas e falhas sanitizadas.

As relações usam chaves compostas de organização e projeto, começam com RLS
habilitada e sem acesso direto do navegador. Somente ativos com varredura
`clean` podem receber `available_at`. Remoção na origem altera estado e não
apaga versões internas.

## Catálogo Meta Ads em leitura

- `meta_ad_accounts`
- `meta_campaigns`
- `meta_ad_sets`
- `meta_creatives`: metadados do criativo externo, sem substituir a entidade
  própria `creatives` da Central de Criativos.
- `meta_ads`: anúncio externo ligado à conta, campanha, conjunto e criativo
  Meta.
- `meta_ad_insights_daily`: métricas diárias brutas e normalizadas por anúncio,
  com unicidade por projeto, anúncio externo e data.

O inventário é idempotente, limitado às contas explicitamente autorizadas e
não concede permissão de publicação.

## IA e ações

- `ai_conversations`
- `ai_insights`
- `ai_usage_records`: uso medido por job, modelo e operação; custo estimado só
  é preenchido quando houver tabela de preços versionada.
- `ai_project_pricing_versions`: preço em BRL informado por projeto, modelo e
  operação, com vigência temporal e fonte de referência.
- `recommendations`
- `action_policies`
- `action_requests`
- `action_approvals`
- `action_executions`

Publicação assistida na Meta usa `action_requests`, `action_approvals` e
`action_executions`, ligada também a `creative_publication_requests` e à versão
exata do criativo.

## Regras de modelagem

- Chaves internas não dependem de IDs de fornecedores.
- IDs externos são únicos por fonte e escopo.
- Timestamps guardados em UTC, exibidos no fuso do projeto.
- Valores monetários guardados em unidade mínima e com moeda.
- Dados brutos são imutáveis.
- Arquivos importados guardam hash, tamanho, MIME type e chave do objeto.
- Versões publicadas de criativos são imutáveis.
- Exclusão ou perda de permissão na origem não apaga automaticamente a cópia
  histórica autorizada.
- Aprovação e publicação são registros separados e auditáveis.
- Entidades mutáveis possuem histórico quando afetam métricas ou auditoria.
- Toda tabela de negócio inclui organização/projeto direta ou indiretamente.
## Funis operacionais

- `funnels`: conceito de funil por projeto, com nome, tipo perpétuo, lançamento
  ou híbrido, estado e janela opcional.
- `funnel_steps`: sequência ordenada de eventos governados esperados.

Funil não é campanha, pessoa nem produto. O cadastro de uma definição não
inscreve pessoas nem transforma presença de evento em sequência comprovada.
# Extensão financeira multimoeda

- `meta_ad_accounts`: `currency`, `currency_status`, `currency_source`,
  `currency_confirmed_at`, `currency_confirmed_by_user_id` e
  `currency_updated_at` identificam e auditam a moeda operacional.
- `meta_ad_insights_daily`: `spend`/`spend_original` e `original_currency`
  preservam a origem; `spend_base`, `base_currency`, `exchange_rate`,
  `exchange_rate_date`, fonte/versão, regra/status/erro e `converted_at`
  registram a derivação.
- `exchange_rates` é histórico imutável e versionado, único por data solicitada,
  par, fonte, versão da fonte e regra. `source_rate_date` registra o dia útil
  efetivamente usado.
- `currency_conversion_runs` registra execução, gatilho, contagens e resultado.
- Estados: `converted`, `pending_rate`, `missing_currency`,
  `unsupported_currency`, `conversion_error` e `not_required`.
- `spend_original` é a única entrada do cálculo cambial. Mudança posterior de
  gasto ou moeda preserva a nova origem, limpa os derivados anteriores e
  recoloca a linha em processamento. Falhas também limpam valor-base, taxa,
  fonte e data efetiva sem remover a evidência original.
