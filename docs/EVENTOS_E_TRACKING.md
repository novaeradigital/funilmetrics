# Eventos e tracking

## Dashboard V2

- `dashboard_v2_layout_updated`: evento de auditoria emitido após salvar, por projeto, a lista, posição e versão da configuração governada dos widgets do Dashboard V2. Registra ator, projeto, dashboard, `widgetKinds` e `configurationVersion`; não contém valores financeiros nem consultas livres.

## Envelope comum

Todo evento normalizado deve possuir:

- `event_id`
- `event_name`
- `occurred_at`
- `received_at`
- `source`
- `organization_id`
- `project_id`
- `person_id` quando conhecido
- `anonymous_id` quando aplicável
- `session_id` quando aplicável
- referências externas
- contexto de URL, UTM e dispositivo quando disponível
- `schema_version`

## Eventos iniciais

### Navegação e lead

- `page_viewed`
- `form_started`
- `form_submitted`
- `lead_created`
- `identity_identified`
- `cta_clicked`
- `checkout_started`

### VSL

- `vsl_started`
- `vsl_progressed`
- `vsl_pitch_reached`
- `vsl_cta_shown`
- `vsl_cta_clicked`
- `vsl_completed`

Progresso deve conter segundos e percentual, evitando excesso de eventos redundantes.

### Webinar

- `webinar_registered`
- `webinar_joined`
- `webinar_left`
- `webinar_offer_viewed`
- `webinar_cta_clicked`
- `webinar_completed`

### Comunicação

- `message_sent`
- `message_delivered`
- `message_read`
- `message_clicked`
- `message_replied`

### Comercial

- `order_created`
- `checkout_abandoned`
- `payment_request_cancelled`
- `payment_request_expired`
- `payment_pending`
- `payment_approved`
- `payment_refused`
- `refund_requested`
- `payment_refunded`
- `payment_chargeback`
- `subscription_started`
- `subscription_renewed`
- `subscription_cancelled`
- `product_ascended`

### Mapeamento inicial da Lastlink

| Evento externo | Evento normalizado | Efeito financeiro |
|---|---|---|
| `Abandoned_Cart` | `checkout_abandoned` | nenhum |
| `Purchase_Request_Confirmed` | `payment_pending` | não reconhecer receita |
| `Purchase_Order_Confirmed` | `payment_approved` | reconhecer receita bruta |
| `Purchase_Request_Expired` | `payment_request_expired` | nenhum |
| `Purchase_Request_Canceled` | `payment_request_cancelled` | nenhum |
| `Refund_Requested` | `refund_requested` | não reduzir receita |
| `Payment_Refund` | `payment_refunded` | reduzir receita líquida |
| `Payment_Chargeback` | `payment_chargeback` | reduzir receita líquida |

`checkout_abandoned` é adicionado ao catálogo como evento comercial de intenção
interrompida.

O nome externo, o payload bruto e `IsTest` devem ser preservados. O evento
normalizado não substitui o fato original.

Quando `IsTest` for `true`, o evento não participa de métricas de produção.

Para datas financeiras:

- `payment_approved` prefere `Purchase.PaymentDate`.
- `payment_refunded` prefere `Purchase.RefundDate`.
- `payment_chargeback` prefere `Purchase.ChargebackDate`.
- Ausência da data específica resulta em dado parcial; não autoriza copiar uma
  data de semântica diferente.

O mesmo `PaymentId` pode atravessar vários estados. Reembolso e chargeback
permanecem como eventos separados, com reconciliação para impedir dupla dedução.

### Mapeamento do ChatSX

| Evento externo | Evento normalizado | Efeito financeiro |
|---|---|---|
| `order.created` | `payment_pending` | nenhum |
| `payment.confirmed` | `payment_approved` | reconhecer receita bruta |
| `order.refunded` | `payment_refunded` | reduzir receita líquida |
| `order.chargeback` | `payment_chargeback` | reduzir receita líquida |

Somente planos avulsos (`unico_15`, `unico_30`) entram. Planos recorrentes
(`assinatura_stories`, `assinatura_premium`) não são enviados pelo ChatSX e,
se chegarem, são bloqueados na normalização (`recurring_out_of_scope`).

A identidade do pedido entre eventos é o `token` (`assinatura:<id>`). A
pessoa é resolvida por e-mail, telefone e CPF. `test: true` (gateway em
sandbox) marca o escopo `test`, fora das métricas de produção.

Para datas financeiras:

- `payment_approved` prefere `paid_at` do pedido.
- `payment_refunded` e `payment_chargeback` usam `occurred_at` do evento.
- `payment_pending` prefere `created_at` do pedido.

Reembolso e chargeback do mesmo pagamento usam a mesma régua de efeito
único das demais fontes, para impedir dupla dedução.

### Anúncios

- `ad_metrics_snapshot`
- `campaign_status_changed`
- `budget_changed`
- `creative_detected`

### Central de Criativos

- `drive_connection_created`
- `drive_folder_connected`
- `drive_folder_disconnected`
- `drive_inventory_requested`
- `creative_file_detected`
- `creative_import_requested`
- `creative_import_blocked`
- `creative_file_imported`
- `creative_file_moved`
- `creative_file_removed`
- `creative_version_created`
- `creative_metadata_updated`
- `creative_analysis_completed`
- `creative_ai_processing_requested`
- `creative_approved`
- `creative_rejected`
- `creative_publication_requested`
- `creative_published`
- `creative_sync_failed`
- `integration_connection_validation_failed`
- `drive_sync_scheduled`
- `drive_change_detected`
- `drive_sync_overdue_detected`
- `meta_publication_reconciliation_required`

`creative_file_detected` registra descoberta ou alteração observada na origem.
Movimento e remoção possuem eventos próprios porque não equivalem a mudança de
conteúdo nem autorizam exclusão da cópia interna.

Campos de contexto conforme o evento:

- `connection_id`
- `drive_folder_id`
- `drive_file_id`
- `creative_id`
- `creative_asset_id`
- `creative_version_id`
- `analysis_id`
- `approval_id`
- `publication_request_id`
- `actor_user_id` para ações humanas
- tipo da mudança
- hash, MIME type, tamanho e data de modificação quando disponíveis
- IDs externos retornados pela Meta quando publicados
- estado anterior e posterior quando houver transição
- motivo, erro sanitizado e tentativa quando houver falha

Regras:

- `drive_connection_created` registra ator, projeto, conta e escopos concedidos,
  mas nunca access token, refresh token, segredo do cliente ou material
  criptográfico.
- `drive_inventory_requested` registra ator, pasta, projeto e modo manual, mas
  não afirma que arquivos foram importados.
- `creative_import_requested` registra a confirmação humana do lote inventariado
  e sua quantidade pendente; não representa importação concluída.
- `creative_import_blocked` registra job, ator e motivo sanitizado quando a
  confirmação é recusada por R2 ou ClamAV não validados. Não registra host,
  porta, bucket, token ou qualquer material secreto.
- `integration_connection_validation_failed` invalida a prontidão anterior e
  registra somente conexão, provedor, ator e estado sanitizado. Uma nova
  validação bem-sucedida é obrigatória para restaurar a prontidão.
- `creative_file_imported` só é registrado após download, hash, varredura limpa,
  promoção ao armazenamento privado e persistência da versão.
- `creative_metadata_updated` registra versão, ator, antes e depois de copy,
  headline, CTA, destino, observações e tags manuais. Não altera os bytes nem
  cria uma nova versão binária.
- `creative_ai_processing_requested` será emitido somente quando o executor e
  os limites operacionais estiverem habilitados; criar a fundação do banco não
  emite nem simula esse evento.
- Eventos de sincronização e processamento são idempotentes.
- Evento de remoção não apaga o arquivo histórico.
- `creative_approved` referencia uma versão exata.
- `creative_publication_requested` registra a configuração e a prévia submetida
  à aprovação.
- `creative_published` só ocorre após resposta bem-sucedida da Meta e guarda os
  IDs externos.
- Falhas de publicação não usam `creative_published`; ficam no fluxo auditável
  de ações e erros.
- Status atual é derivado do histórico de eventos e não substitui os fatos.

### Experimentos

- `experiment_assigned`
- `variant_exposed`
- `experiment_converted`

### Administração de integrações

- `integration_configuration_updated`
- `integration_connection_validated`

Para a Meta, `integration_connection_validated` registra somente resultado,
conexão, ator, versão da Graph API e IDs das contas conferidas. Token, segredo e
respostas brutas da API não entram no evento.

- `meta_catalog_synchronized`
- `meta_authorization_created`
- `meta_authorization_validated`
- `meta_authorization_revoked`
- `meta_accounts_authorized`

Registra projeto, conexão, contas autorizadas, quantidade de campanhas e
conjuntos atualizados e instante. Exclusões não são inferidas por uma execução
incompleta ou com falha.

- `lastlink_connection_created`
- `lastlink_token_tested`
- `lastlink_token_rotated`
- `lastlink_connection_revoked`
- `lastlink_primary_product_confirmed`

Os eventos registram organização, projeto, conexão, ator e instante. A criação
também registra produto; o teste registra apenas sucesso ou falha; a rotação
registra o fim da janela de transição; a revogação registra estado anterior e
posterior. Nenhum deles inclui o token completo nem seu hash.

### Administração de equipe

### Catálogo comercial

- `product_classification_updated`
- `ai_monthly_budget_updated`
- `sales_volume_anomaly_detected`
- `ai_pricing_version_created`
- `ai_monthly_budget_exhausted`
- `creative_text_extraction_requested`
- `creative_text_extraction_completed`

- `member_access_pre_authorized`
- `member_access_granted`
- `member_invitation_accepted`
- `member_role_changed`
- `member_project_scope_changed`
- `member_access_revoked`

Esses eventos registram organização, ator, usuário afetado, instante e estados
anterior e posterior quando aplicável. A retirada de acesso não apaga o perfil,
os fatos históricos nem a auditoria. Proprietários não podem ser removidos ou
rebaixados por esse fluxo.

## Versionamento

Alterações incompatíveis aumentam `schema_version`. Consumidores devem aceitar reprocessamento. Exemplos reais ficam em `docs/payloads/<fonte>/`, sempre com dados pessoais removidos.
## Central de Criativos — transcrição

### `creative_analysis_requested`

- Quando: usuário autorizado solicita análise de uma versão já transcrita.
- Propriedades auditáveis: `jobId`, `model` e `promptVersion`.
- Não contém o texto da transcrição.

### `creative_analysis_completed`

- Quando: análise estruturada e tags automáticas são persistidas.
- Propriedades auditáveis: `jobId` e `model`.
- Hipóteses não são tratadas como desempenho comprovado.

### `creative_review_requested`

- Quando: uma versão analisada é enviada para revisão humana.
- Autor: owner, administrador ou editor.
- Resultado: status `awaiting_approval`.

### `creative_approved`

- Quando: owner ou administrador aprova uma versão específica.
- Registra responsável, horário, versão e observação.
- Uma versão nova não herda a aprovação.

### `creative_rejected`

- Quando: owner ou administrador devolve a versão para ajustes.
- Comentário é obrigatório; histórico e análise original são preservados.

### `creative_publication_preview_created`

- Quando: uma prévia imutável é gerada para versão aprovada.
- Registra `publicationRequestId` e `snapshotSha256`.

### `creative_publication_approved`

- Quando: owner ou administrador aprova o snapshot exato da publicação.
- Não equivale a confirmação de publicação pela Meta.

### Execução assistida

- `campaign_action_requested`: intenção de pausa ou orçamento criada com
  campanha, motivo, snapshot e SHA-256 imutável; não executa escrita externa.
- `campaign_action_approved`: owner ou administrador aprovou o snapshot exato.
- `campaign_action_rejected`: owner ou administrador rejeitou a solicitação.
- `campaign_action_simulated`: valida novamente campanha, conta, estado e hash
  aprovados; divergências exigem reconciliação e nenhuma escrita externa ocorre.

- `creative_publication_simulation_requested`
- `creative_publication_simulation_completed`
- `creative_publication_reconciliation_required`: a simulação encontrou
  divergência no hash aprovado, ativo privado, conexão ou hierarquia de destino;
  nenhuma escrita externa foi realizada.
- `financial_report_schedule_updated`: administrador alterou a agenda interna.
- `financial_report_snapshot_generated`: worker criou snapshot financeiro
  imutável e idempotente para a agenda, janela e consulta no painel.
- `financial_report_snapshot_requested`: administrador solicitou um fechamento
  imediato; repetições no mesmo projeto, agenda e minuto reutilizam o snapshot.
- `financial_report_snapshot_exported`: usuário baixou a cópia exata de um
  snapshot existente, sem recalcular o fechamento histórico.
- `financial_report_snapshot_comparison_exported`: usuário exportou dois
  snapshots compatíveis, seus valores preservados e diferenças descritivas.
- `data_quality_issue_history_exported`: usuário exportou ocorrências
  persistentes de qualidade, incluindo filtros, regra e evidência sanitizada.
- `smart_link_created`: link com variantes e pesos foi criado por usuário autorizado.
- `experiment_exposure_recorded`: visitante foi designado persistentemente a
  uma variante; bots permanecem marcados fora da análise principal.
- `experiment_status_changed`: editor autorizado pausou ou reativou o
  redirecionamento, preservando exposições anteriores.
- `experiment_conversion_linked`: pedido foi ligado idempotentemente a uma
  exposição pelo `sck` próprio do Funil Metrics.
- `creative_publication_reconciliation_required`

Simulação não executa escrita externa. Reconciliação é obrigatória quando não
for possível confirmar com segurança o resultado de uma chamada futura.

### `creative_transcription_requested`

- Quando: usuário autorizado solicita manualmente a transcrição de uma versão.
- Escopo: organização, projeto, criativo e versão.
- Propriedades auditáveis: `jobId` e `model`.
- Idempotência: versão + conteúdo SHA-256 + modelo + versão do processo.

### `creative_transcription_completed`

- Quando: o worker conclui a transcrição e persiste o resultado versionado.
- Escopo: organização, projeto, criativo e versão.
- Propriedades auditáveis: `jobId` e `model`.
- Não contém: texto transcrito, chave, URL assinada ou conteúdo do arquivo.

### Projetos

- `project_created`: projeto criado por owner ou administrador, com nome,
  moeda e fuso, sem segredos.
- `active_project_changed`: seleção validada de outro projeto acessível; a
  preferência não move nem replica dados.
- `project_settings_updated`: alteração administrativa de nome, moeda ou fuso
  horário, com valores anteriores e novos preservados na auditoria.

### Meta Ads em leitura

- `meta_catalog_synchronized`: inventário solicitado por administrador,
  registrando quantidades de contas, campanhas, conjuntos, anúncios, criativos
  e linhas diárias de insights, versão da Graph API e janela consultada.
- `creative_meta_ads_linked`: editor ou administrador ligou os anúncios que
  usam um criativo Meta a uma versão específica da biblioteca própria.
- `creative_performance_status_changed`: classificação humana do criativo como
  publicado, pausado, vencedor, em fadiga ou arquivado, com justificativa,
  estado anterior e versão avaliada.
- `meta_performance_exported`: exportação CSV diária por anúncio, registrando
  período, filtros de conta, status e busca,
  quantidade de linhas, fonte e granularidade.
- `meta_campaign_performance_exported`: exportação CSV do detalhe de uma
  campanha, registrando campanha, período, quantidade de linhas, fonte e
  granularidade.
- `meta_sync_scheduled`: o worker criou uma execução idempotente para uma agenda
  Meta vencida; não significa que a sincronização externa foi concluída.
- `meta_sync_processed`: o worker concluiu ou falhou uma execução Meta agendada;
  contagens ficam no histórico da execução e segredos não entram no evento.
- `meta_sync_schedule_updated`: administrador ativou, desativou ou alterou o
  intervalo da agenda de uma conexão Meta; registra antes e depois.
- `meta_sync_requested`: administrador solicitou uma execução Meta manual na
  fila; repetição enquanto existe execução ativa não cria outro job.

### Dashboards personalizáveis

- `dashboard_created`: dashboard e primeira versão de rascunho criados no
  projeto, com período padrão e ator.
- `dashboard_widget_created`: widget governado incluído no rascunho, registrando
  tipo, chave da métrica e versão da regra, sem valores calculados.
- `dashboard_published`: rascunho promovido a versão imutável e novo rascunho
  derivado criado para edições posteriores.
- `dashboard_archived`: dashboard removido da navegação ativa sem apagar suas
  versões, widgets ou auditoria.
- `dashboard_layout_updated`: posição, ordem e dimensões dos widgets do rascunho
  atualizadas em lote, depois de validar que todos pertencem à mesma versão.
- `dashboard_filters_updated`: período ou filtros governados do dashboard
  alterados por usuário autorizado.
- `dashboard_created_from_template`: novo dashboard criado a partir de template
  conhecido, registrando a chave do template e a quantidade de widgets.
- `dashboard_version_restored`: versão publicada escolhida como origem para
  substituir o conteúdo do rascunho atual; origem, destino e ator permanecem na
  auditoria, sem modificar a versão publicada.
- `dashboard_access_granted`: acesso individual de visualização ou edição
  criado ou atualizado por administrador, com valor anterior e novo.
- `dashboard_access_revoked`: concessão individual removida; o histórico
  registra membro, nível anterior, ator, projeto e dashboard.
- `dashboard_created_with_ai`: composição validada contra o catálogo governado
  criada somente como rascunho, registrando modelo, quantidade de widgets,
  consumo e confirmação de que não houve publicação automática.
## Tracking próprio de páginas e VSL

Eventos aceitos pela coleta pública v1:

- `page_view`
- `video_play`
- `video_progress_25`
- `video_progress_50`
- `video_progress_75`
- `video_complete`
- `cta_click`
- `form_submit`

Cada evento exige `eventId`, tipo, instante e URL. `visitorId` e `sessionId` são
pseudônimos opcionais. UTMs ficam em campos próprios; propriedades livres são
limitadas a valores escalares e não devem conter senha, documento, conteúdo de
formulário ou outro dado sensível. A chave idempotente é fonte + `eventId`.
User-Agent é usado apenas para marcar bot e não é persistido integralmente.

Quando um CTA marcado aponta para outro endereço, a tag acrescenta
`sck=fmt_<token-opaco>` somente se o destino ainda não possuir `sck`. A
normalização Lastlink pode ligar o pedido ao visitante e à fonte mais recente
observada. O parâmetro existente nunca é substituído.

- `tracking_conversion_linked`: pedido ligado idempotentemente a uma fonte e
  visitante pelo `sck` próprio.

Eventos administrativos:

- `tracking_source_created`: fonte criada com nome e origens permitidas.
- `tracking_source_status_changed`: coleta pausada ou reativada sem apagar o
  histórico.
- `funnel_created`: definição de funil criada como rascunho, com tipo e janela.
- `funnel_step_created`: etapa governada acrescentada à sequência, com posição e
  evento esperado.
- `funnel_tracking_source_linked`: fonte associada explicitamente ao funil.
- `funnel_tracking_source_unlinked`: associação desativada sem apagar seu
  histórico, com ator e instante preservados.
- `funnel_status_changed`: funil ativado ou arquivado por usuário autorizado.
- `funnel_definitions_exported`: exportação CSV das definições, fontes ativas e
  volumes observados, com versão da regra registrada na auditoria.
- `custom_domain_created`: domínio cadastrado no escopo do projeto e mantido
  pendente de comprovação DNS.
- `custom_domain_verified`: registro TXT esperado encontrado e propriedade
  confirmada, sem ativação automática de tráfego.
- `custom_domain_verification_failed`: consulta concluída sem o TXT esperado;
  nenhum domínio ou link existente é alterado.
- `custom_domain_provisioning_requested`: domínio verificado colocado na fila
  operacional, sem chamada automática à hospedagem.
- `custom_domain_provisioning_cancelled`: solicitação cancelada de forma
  reversível antes da ativação.
- `custom_domain_disabled`: hostname desativado por ação humana; novos acessos
  aos links inteligentes nesse domínio deixam de ser atendidos.
- `custom_domain_restored`: hostname retorna para conferência de propriedade e
  novo provisionamento; a restauração não o ativa automaticamente.
- `custom_domain_verification_rotated`: código de comprovação substituído por
  solicitação humana; o valor anterior deixa de confirmar propriedade e não é
  registrado na auditoria.
- `data_quality_exported`: exportação CSV dos estados operacionais dos eventos
  brutos, limitada ao projeto e período ativos e sem incluir payloads.
- `raw_event_retry_requested`: falha recuperável recolocada manualmente na fila
  por usuário autorizado, preservando tentativa e código anteriores na auditoria.
## Eventos de domínio personalizado

- `custom_domain_created`: hostname cadastrado no projeto.
- `custom_domain_verified`: propriedade confirmada pelo TXT próprio.
- `custom_domain_provisioned`: hostname criado na hospedagem e registros DNS
  necessários armazenados.
- `custom_domain_health_checked`: CNAME, TXT da hospedagem e HTTPS conferidos.
- `custom_domain_activated`: domínio considerado operacional após as três
  verificações.
- `custom_domain_disabled`: domínio desativado no projeto.
- `custom_domain_deleted`: hostname removido definitivamente do projeto após
  confirmação nominal. A auditoria preserva hostname, provedor, zona e ator,
  mas nunca credenciais. A zona Cloudflare só é removida quando não atende
  outro hostname e o usuário marca explicitamente essa opção.
- `cloudflare_zone_created`: zona própria criada ou localizada na conta
  Cloudflare do projeto; registra Zone ID, nome, estado e nameservers, nunca o
  token.
- `cloudflare_zone_status_checked`: estado da delegação consultado sem alterar
  tráfego quando a zona ainda está pendente.
- `cloudflare_domain_activated`: zona ativa e subdomínio vinculado ao Worker.

## Eventos do redirecionador de borda

- `edge_experiment_config_fetched`: configuração ativa consultada pela borda.
- `edge_exposure_queued`: exposição aceita para persistência assíncrona.
- `edge_exposure_persisted`: exposição gravada ou deduplicada no histórico.
- `edge_redirect_fallback_used`: rota Railway usada por indisponibilidade da
  configuração na borda.
# Eventos financeiros multimoeda

- `exchange_rate_fetched`: taxa histórica obtida e persistida com fonte e data.
- `currency_conversion_processed`: lote por projeto concluído com contagens.
- `currency_conversion_failed`: conversão falhou sem alterar o valor original.
- `meta_ad_account_currency_corrected`: administrador confirmou ou corrigiu a
  moeda, com antes/depois e quantidade recolocada para processamento.
- `currency_conversion_backfill_planned`: inventário e plano foram produzidos;
  não significa que o backfill foi executado.

## Eventos do gerenciador Meta Ads

- `meta_manager_columns_saved`: preferência de colunas salva por usuário,
  projeto e nível (`accounts`, `campaigns`, `adsets` ou `ads`).
- `meta_manager_filters_saved`: filtros operacionais (busca, conta, status e
  período) salvos por usuário, projeto e nível. A URL continua registrando os
  mesmos filtros para permitir compartilhamento e reprodução da consulta.
- `meta_manager_status_requested`: intenção idempotente de pausar ou ativar
  uma entidade criada com estado anterior, estado desejado, motivo e ator.
- `meta_manager_bulk_status_requested`: agrupamento auditável de solicitações
  individuais criadas por uma seleção múltipla. O evento registra tipo,
  ação, estado desejado, quantidade e IDs, mas não representa execução externa.
- `meta_manager_status_approved`: solicitação aprovada por proprietário ou
  administrador. Nesta fase, o evento não significa execução na Meta.
- `meta_manager_status_rejected`: solicitação rejeitada com histórico
  preservado. Nenhuma alteração externa é realizada.
### Execução governada no gerenciador Meta

- `meta_manager_execution_started`: executor reivindicou uma solicitação aprovada.
- `meta_manager_execution_succeeded`: a Meta confirmou a alteração e a releitura coincidiu com o estado desejado.
- `meta_manager_execution_failed`: a chamada ou a verificação falhou; resposta registrada sem segredos.
- `meta_manager_execution_state_mismatch`: a Meta respondeu, mas a releitura não confirmou o estado desejado.
### `meta_manager_edit_requested`

Emitido quando uma edição de nome ou orçamento é preparada no gerenciador. Registra entidade, estado anterior, estado desejado e autor; não representa alteração executada na Meta.

- `meta_manager_edit_approved`: edição de nome ou orçamento aprovada por
  proprietário ou administrador; ainda não representa a execução externa.
- `meta_manager_edit_rejected`: edição rejeitada, preservando estado anterior,
  estado desejado, decisão e autor sem alterar a Meta.
