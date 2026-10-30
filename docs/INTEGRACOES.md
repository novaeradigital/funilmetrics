# Catálogo de integrações

## Padrão obrigatório

Cada integração deve documentar:

- Autenticação e permissões.
- Webhooks disponíveis.
- Sincronização histórica e incremental.
- IDs externos.
- Payloads reais.
- Mapeamento para eventos internos.
- Idempotência.
- Rate limits e retentativas.
- Reconciliação.
- Última sincronização e saúde.

## Lastlink

Objetivo: pedidos, compradores, produtos, pagamentos, reembolsos e UTMs.

Fontes originais disponíveis:

- `docs/fontes-originais/lastlink/webhook_logs_2026-07-23.xlsx`
- `docs/fontes-originais/lastlink/webhook_logs_2026-07-23-parte-2.xlsx`

Decisões:

- Rebrandly está fora do projeto.
- As UTMs já ficam gravadas na Lastlink e devem ser aproveitadas.
- Logs/payloads reais serão a referência do contrato.
- Guardar payload bruto antes de normalizar.
- Separar evidência de produção de fixtures com `IsTest: true`.
- Não usar o simulador para inferir fórmulas ou obrigatoriedade de campos.

Evidências derivadas:

- `docs/analises/lastlink/ANALISE_WEBHOOKS_2026-07-23.md`
- `docs/payloads/lastlink/`

### Envelope do webhook

Comprovado pelo simulador:

- `Id`
- `IsTest`
- `Event`
- `CreatedAt`
- `Data`

`Id` é candidato a identificador idempotente da entrega, mas ainda é preciso
confirmar se permanece igual em retentativas. Eventos com `IsTest: true` não
alimentam métricas de produção.

O webhook envia o header `x-lastlink-token`. O valor é segredo e deve ser
armazenado fora do código, comparado de forma segura e nunca registrado em log.
A Lastlink gera o token automaticamente e o disponibiliza para cópia na tela de
configuração. Foi confirmado operacionalmente que produtos diferentes podem
gerar tokens diferentes. O Funil Metrics deve aceitar múltiplas conexões ou
endpoints por projeto, com escopo e identificação do produto correspondente.

O painel deverá permitir colar o token uma única vez, armazenar somente seu hash,
testar a conexão, rotacionar e revogar. Depois de salvo, o valor completo não
será exibido novamente.

### Eventos comprovados

Nos logs reais:

- `Purchase_Order_Confirmed`
- `Purchase_Request_Confirmed`
- `Purchase_Request_Expired`
- `Abandoned_Cart`
- `Payment_Refund`
- `Payment_Chargeback`
- `Refund_Requested`

No simulador e na documentação oficial:

- `Purchase_Request_Canceled`

Outros eventos documentados pela Lastlink ainda não foram analisados e não
integram o contrato inicial.

### Mapeamento financeiro inicial

- `Purchase_Request_Confirmed`: fatura criada; não reconhecer receita.
- `Purchase_Order_Confirmed`: pagamento confirmado; reconhecer receita bruta.
- `Purchase_Request_Expired`: fatura expirada; não reconhecer receita.
- `Purchase_Request_Canceled`: fatura cancelada; não reconhecer receita.
- `Refund_Requested`: solicitação; não reduzir receita.
- `Payment_Refund`: reembolso efetivo; reduzir receita líquida.
- `Payment_Chargeback`: chargeback efetivo; reduzir receita líquida.

Reembolso e chargeback para o mesmo `PaymentId` exigem reconciliação para não
deduzir duas vezes o mesmo valor.

### UTMs e parâmetros

Preservar separadamente:

- `UtmSource`
- `UtmMedium`
- `UtmCampaign`
- `UtmTerm`
- `UtmContent`
- `UtmId`
- `Src`
- `Sck`
- `Vtid`

Não tratar `Src`, `Sck`, `UtmId` ou `Vtid` como sinônimos sem regra confirmada.

### Idempotência e duplicidade

Foram observadas reentregas prováveis do mesmo `PaymentId + Event`, além de
transições legítimas com o mesmo `PaymentId`. Portanto:

- `PaymentId` não é chave única de evento.
- `PaymentId + Event` também pode repetir.
- O payload bruto e seu hash devem ser preservados.
- `Id` deve ser usado quando presente, com fallback determinístico versionado.
- Reprocessamento não cria novo fato financeiro.

### Limitações conhecidas

- O simulador apresenta combinações sintéticas e inconsistentes.
- `Payment_Refund` simulado trouxe `ChargebackDate`, enquanto os eventos reais
  trouxeram `RefundDate`.
- Campos são opcionais e variam entre produção e simulador.
- `CreatedAt` não informa fuso nos exemplos.
- Moeda, retentativas, order bump e semântica completa de assinaturas continuam
  pendentes.

### Saúde operacional implementada

O painel consolida por período eventos brutos recebidos, normalizados,
duplicados, em fila, com falha, em quarentena, parciais ou desconhecidos.
Também mostra estado e última atividade por conexão. O rótulo “operacional”
significa apenas que a conexão está ativa e não possui falha, quarentena ou
backlog no recorte consultado; não garante que a fonte externa enviou todos os
eventos que deveria.

Validar:

- Estabilidade de `Id` em retentativas.
- Política de retentativas e limite dos exports.
- Rotação e escopo do `x-lastlink-token`.
- Fuso de `CreatedAt`.
- Moeda e significado exato dos preços.
- Order bump, upsell, assinatura e parcelamento inteligente.

## ConfigCheckout

Objetivo: pedidos, compradores, produtos, pagamentos, estornos e atribuição
das vendas feitas nos checkouts do ConfigCheckout (plataforma de checkout
própria), para análise nos dashboards sem depender dos dados crus do gateway.

Decisões:

- A fonte é o ConfigCheckout, não o gateway (AppMax) direto: o pedido no
  ConfigCheckout já guarda o contexto de marketing capturado na página
  (UTMs, fbp, fbc, domínio de origem e visitante), que o gateway sozinho
  não devolve.
- Guardar o payload bruto antes de normalizar (mesmo padrão da Lastlink).
- Uma conexão por vendedor: cada vendedor cola a URL e o token da conexão
  nas Integrações do ConfigCheckout dele.
- Contrato próprio e versionado (`version: 1`), porque os dois lados são
  mantidos pelo mesmo time.

### Autenticação

O ConfigCheckout envia o header `x-configcheckout-token`. O valor é segredo,
definido por quem cria a conexão no Funil Metrics, salvo aqui somente como
hash (scrypt) e no ConfigCheckout criptografado. Rotação mantém o token
anterior válido por 24 horas. Depois de salvo, o valor completo não é
exibido em nenhum dos dois painéis.

### Envelope do webhook

`POST /webhooks/configcheckout/:connectionPublicId` com o corpo:

- `id`: uuid do evento, gerado pelo ConfigCheckout a cada disparo.
- `type`: um dos eventos do catálogo abaixo.
- `version`: versão do contrato (atual: 1).
- `occurred_at`: quando o evento aconteceu, com fuso.
- `test`: verdadeiro quando o pedido é de teste (compra do próprio
  vendedor); eventos de teste não alimentam métricas de produção.
- `seller.id`: id do vendedor no ConfigCheckout.
- `order`: retrato completo do pedido no momento do evento (comprador com
  e-mail, telefone, documento e endereço com UF; produto e kit; valores
  subtotal, descontos, frete, juros e total como texto decimal; método e
  parcelas; ids do gateway; `confirmation` igual a `gateway` ou `manual`;
  atribuição com `utm` no formato gravado pelo checkout (`utm_source`,
  `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`), `fbp`, `fbc`,
  `domain` e `visitor_id`).

Payload anonimizado de referência: `docs/payloads/configcheckout/`.

### Eventos do catálogo

- `order.created`: pedido criado no envio do formulário do checkout.
- `payment.confirmed`: pagamento confirmado. Com `confirmation: manual`,
  é a baixa manual do vendedor (recebimento por fora, sem pagamento de
  gateway por trás).
- `payment.analysis`: pagamento em análise no antifraude da fonte.
- `payment.failed`: pagamento recusado.
- `order.canceled`: pedido cancelado.
- `order.refunded`: pedido estornado.
- `order.chargeback`: pedido em chargeback.
- `connection.test`: sondagem do botão Testar conexão do ConfigCheckout.
  Não é evento de venda: é autenticado e guardado em quarentena como tipo
  desconhecido, de propósito.

Tipos desconhecidos e versões não suportadas são guardados em quarentena,
nunca normalizados.

### Mapeamento para eventos internos

- `order.created` vira `payment_pending` (pedido e pagamento pendentes),
  sem efeito financeiro.
- `payment.confirmed` vira `payment_approved`, com efeito financeiro de
  aprovação sobre o total do pedido.
- `payment.analysis` vira `payment_analysis`, sem efeito financeiro.
- `payment.failed` vira `payment_failed`, sem efeito financeiro.
- `order.canceled` vira `payment_cancelled`, sem efeito financeiro.
- `order.refunded` vira `payment_refunded`, com efeito de reversão.
- `order.chargeback` vira `payment_chargeback`, com efeito de reversão.

A identidade do pedido entre eventos é o `token` do pedido no
ConfigCheckout. A pessoa é resolvida por e-mail, telefone e documento
(novo tipo de identificador: `document`). A oferta interna é o checkout
do pedido (`checkout:<id>`); sem checkout, a oferta é o próprio produto
(`product:<id>`). A data do evento usa `paid_at` na confirmação
(`payment_date`), `created_at` na criação e `occurred_at` nos demais.

### Idempotência e retentativas

- O `id` do evento é a chave de idempotência: reentregas do mesmo evento
  são reconhecidas e não criam fato novo.
- O ConfigCheckout envia por job em fila com até 5 tentativas e espera
  crescente (30 s a 30 min). Falha de rede ou de status gera nova
  tentativa; o Funil Metrics responde 202 na aceitação e 200 na
  duplicidade.
- O efeito financeiro é aplicado uma única vez por pagamento, pela mesma
  régua das demais fontes.

### Limitações conhecidas

- O ConfigCheckout não informa comissão do produtor: o efeito financeiro
  de comissão fica ausente (`producer_commission_missing`) e a base
  governada de receita por comissão marca a cobertura como parcial para
  esta fonte. A base por valor total da venda está completa.
- A baixa manual (`confirmation: manual`) não tem id de pagamento do
  gateway, então o efeito financeiro dela é bloqueado pela régua
  (`payment_id_missing_financial_effect_blocked`): ela entra na jornada
  e na atribuição, não no faturamento.
- O kit vendido fica preservado no payload bruto; o item normalizado é o
  produto do pedido.
- A UF do comprador fica preservada no payload bruto (endereço); a
  geografia normalizada continua vindo do telefone, como nas demais
  fontes.
- Sem carga histórica na v1: valem os eventos a partir da ativação da
  conexão.

### Saúde operacional implementada

A página da integração (Integrações, ConfigCheckout) consolida por conexão
os mesmos indicadores das demais fontes: eventos recebidos, normalizados,
duplicados, backlog, falhas, quarentena e último evento. Do lado do
ConfigCheckout, a linha da integração mostra o último evento enviado e
quando ele foi aceito.

## Google Drive

## Cofre central no painel

A rota `/dashboard/integracoes` organiza OpenAI, Cloudflare R2 e ClamAV.
R2 e ClamAV são resolvidos por projeto durante a importação, e a prévia privada
usa a credencial R2 do mesmo projeto do ativo. Os segredos são decifrados
somente em memória nos runtimes autorizados; não retornam ao navegador.
Segredos são inseridos em campos mascarados, cifrados com AES-256-GCM em
`integration_secrets` e nunca reapresentados. Configurações não secretas ficam
em `connections.configuration`. Cada substituição rotaciona o bundle anterior
e registra somente configuração não secreta e indicador de troca na auditoria.

Confirmar um lote inventariado exige conexões R2 e ClamAV ativas e com
validação bem-sucedida no projeto. Para o R2, também é obrigatório existir um
bundle de credencial ativo no cofre do mesmo projeto. A Central reflete essa
prontidão e a rota server-side impede contorno direto. O inventário de
metadados continua permitido porque não baixa nem promove arquivos.

Somente proprietário ou administrador pode salvar. Sem
`INTEGRATION_SECRET_ENCRYPTION_KEY` válida, todos os formulários permanecem
bloqueados.

### Seleção explícita de pastas

O fluxo web usa o Google Picker com `drive.readonly` após o protótipo confirmar
que `drive.file` não enumerava os descendentes de uma pasta. O servidor troca o refresh
token criptografado por um access token de curta duração e o entrega somente à
sessão autenticada de proprietário ou administrador com acesso ao projeto. O
refresh token nunca chega ao navegador.

O Picker permite selecionar uma ou mais pastas. Cada escolha volta ao servidor,
que consulta `files.get` com field mask mínimo, confirma que o item existe, está
acessível, não está na lixeira e possui MIME type de pasta. Somente depois dessa
validação é criado ou reativado um `drive_folder`, com auditoria
`drive_folder_connected`.

A seleção não inventaria, importa ou publica arquivos. Essas ações continuam
separadas e exigem jobs idempotentes posteriores. A chave pública do Picker e o
número do projeto Google Cloud são configuração do ambiente; sua ausência
mantém o controle desabilitado na interface.

### Inventário manual

Uma solicitação manual cria um job idempotente por pasta e impede outro job
ativo concorrente para a mesma origem. O worker renova a credencial no servidor,
lista páginas de até mil itens, percorre subpastas quando autorizado e preserva
ID externo, pai, nome, MIME type, tamanho, modificação e checksum quando o Drive
os fornece. Imagens, vídeos, textos, PDFs e documentos Google são elegíveis.

O resultado atualiza `drive_files` por ID externo e cria itens pendentes no job.
Não há download nessa etapa. Falhas guardam somente código sanitizado; tokens e
respostas completas do Google não são persistidos em logs.

### Cópia, quarentena e versão

Depois do inventário, uma confirmação humana separada muda o lote para
`importing`. O worker faz download ou exportação oficial, aplica os limites
aprovados por categoria, calcula SHA-256 sobre os bytes completos e usa arquivo
temporário com backpressure em vez de carregar vídeos em memória.

O objeto entra em `quarantine/<organização>/<projeto>/<job>/<item>`. O ClamAV
recebe um novo stream local; somente `clean` é promovido para
`assets-private/<organização>/<projeto>/<sha256>`. Resultado infectado é
bloqueado e removido da quarentena; erro recuperável permanece inacessível.

Após promoção, o banco registra o ativo, cria ou reutiliza o conceito de
criativo e cria uma versão imutável. O mesmo hash no mesmo arquivo de origem é
`skipped_unchanged`; hash diferente cria a próxima versão.

Objetivo: fonte oficial de entrada e organização da Central de Criativos.

O adaptador R2 de servidor está implementado, mas permanece desativado enquanto
as credenciais não estiverem presentes. Ele não realiza importação por conta
própria: recebe streams apenas do futuro worker OAuth, grava em `quarantine/` e
promove para `assets-private/` somente após resultado ClamAV `clean`.

O contrato do scanner ClamAV também está implementado e desativado sem
configuração. Ele trabalha por streaming, aplica timeout e limite máximo, não
recebe credenciais do armazenamento e falha de forma fechada: qualquer estado
diferente de `clean` mantém o objeto indisponível.

### Prévia privada

Imagens e vídeos já importados permanecem no bucket privado. O endpoint do
Funil Metrics valida a sessão, o vínculo organizacional, o projeto,
`available_at` e o resultado antimalware `clean`. Em seguida, gera uma URL
pré-assinada `GET` para o objeto exato, válida por cinco minutos, e responde com
redirecionamento temporário sem cache.

O navegador lê os bytes diretamente do R2. Vídeos usam as requisições parciais
nativas do armazenamento para carregar duração, avançar e retroceder sem
transportar a mídia pela Railway. Credenciais do R2 nunca são enviadas ao
navegador e o bucket não se torna público.

### Autenticação e escopo

- OAuth oficial do Google, sem compartilhamento de senha.
- Menor conjunto de permissões compatível com seleção, leitura e cópia dos
  arquivos autorizados.

Fundação implementada:

- fluxo OAuth 2.0 para aplicação web no backend;
- `drive.file` acompanhado apenas de `openid` e `email` para identificar a conta;
- acesso offline, consentimento explícito e autorização incremental;
- `state` assinado, nonce em cookie `HttpOnly`, validade de dez minutos e
  revalidação de usuário, papel e projeto no callback;
- refresh token criptografado por AES-256-GCM em tabela inacessível ao navegador;
- access token descartado após o callback;
- recurso permanece desativado sem todas as credenciais e chaves de servidor.
- Uma conexão pode autorizar múltiplas pastas.
- Cada pasta é ligada explicitamente a organização, projeto e, quando
  aplicável, marca e produto.
- Remoção da autorização interrompe novas leituras, sem apagar silenciosamente
  cópias históricas permitidas.
- Credenciais e refresh tokens são criptografados, rotacionáveis e nunca
  aparecem em logs.

O Google recomenda `drive.file` com Google Picker para acesso estreito por
arquivo. Escopos como `drive.readonly` são restritos, dão acesso amplo e podem
exigir verificação e avaliação de segurança quando os dados são armazenados no
servidor. A seleção de uma pasta no produto deve manter uma allowlist interna,
mas não pode ser descrita como isolamento garantido pelo OAuth até um protótipo
confirmar acesso aos descendentes, arquivos futuros, atalhos e Shared Drives.

Referência:
`https://developers.google.com/workspace/drive/api/guides/api-specific-auth`

### Tipos de conteúdo

- Imagens.
- Vídeos.
- Arquivos de texto.
- Documentos do Google exportáveis para formato compatível.
- Thumbnail e documentos auxiliares quando presentes.

Antes de baixar ou exportar, consultar `capabilities.canDownload`. Documentos do
Google exigem exportação para MIME type compatível; a exportação por
`files.export` possui limite documentado de 10 MB. Formatos, codecs, tamanhos e
modalidades de exportação ainda precisam de matriz aprovada.

Referência:
`https://developers.google.com/workspace/drive/api/guides/manage-downloads`

### Metadados preservados

- ID externo do arquivo.
- ID e caminho conhecido da pasta.
- Nome.
- MIME type.
- Tamanho quando disponível.
- Data de criação e modificação quando disponível.
- Checksum/hash fornecido pela fonte quando disponível.
- Estado de remoção e permissão.
- IDs de versão/revisão quando fornecidos.

### Sincronização

- Fase inicial manual para uma pasta.
- Sincronização automática posterior por notificações, polling incremental ou
  estratégia híbrida.
- Checkpoints e cursores são preservados por pasta/conexão.
- Detectar arquivo novo, alterado, movido ou removido.
- Download/exportação, cópia própria, transcrição e análise são jobs
  idempotentes separados.
- Falhas permitem retentativa e reprocessamento sem duplicar versões.

O log de mudanças fornece o estado atual do item alterado, não um diff. O
sistema precisa guardar o estado anterior e comparar. Notificações push apenas
avisam que houve mudança e exigem leitura posterior do log. My Drive e cada
Shared Drive possuem logs próprios; a primeira versão deve limitar o escopo
suportado explicitamente.

Referências:
`https://developers.google.com/workspace/drive/api/guides/about-changes` e
`https://developers.google.com/workspace/drive/api/guides/push`.

### Versionamento e armazenamento próprio

- Arquivo importado recebe hash e cópia autorizada no armazenamento próprio.
- Mudança de conteúdo cria nova versão imutável do criativo.
- Mudança apenas de pasta ou nome atualiza metadados da origem e não cria
  necessariamente nova versão de conteúdo.
- Uma versão já aprovada ou publicada nunca é substituída.
- Remoção no Drive marca a origem como ausente; a cópia histórica permanece
  conforme autorização, retenção e direito de exclusão.
- O produto não depende do Drive para exibir uma versão já importada.

### Saúde e qualidade

Mostrar:

- Última sincronização por conexão e pasta.
- Arquivos descobertos, importados, ignorados e com erro.
- Permissão removida ou token vencido.
- Arquivo ausente.
- Formato inválido ou não suportado.
- Tamanho incompatível.
- Exportação indisponível.
- Divergência de hash ou versão.
- Atraso e backlog de processamento.

### Pendências

- Escopos OAuth definitivos.
- Estratégia de autorização restrita a pastas, acesso a descendentes futuros e
  comportamento de atalhos.
- Aceitar ou evitar escopo restrito e seu custo de verificação/avaliação.
- Shared Drives e arquivos compartilhados por terceiros.
- Notificações versus polling e frequência padrão.
- Formatos de exportação de Google Docs.
- Limites de tamanho, duração e codecs.
- Política de retenção e exclusão da cópia própria.
- Quotas, backoff e reconciliação de mudanças perdidas.

## Meta Ads

Objetivo: contas, campanhas, conjuntos, anúncios, criativos e métricas históricas.

Modos oficiais de autorização:

- `oauth_user`: cada cliente autoriza o app e seleciona explicitamente os ativos
  aos quais sua identidade já possui acesso;
- `system_user`: uma operação ou agência utiliza usuário do sistema e ativos
  próprios ou recebidos por parceria empresarial.

O app define capacidades; o token representa a identidade; a atribuição no
portfólio empresarial define os ativos efetivamente acessíveis. Cada autorização
é isolada por organização, projeto e conexão.

A configuração do aplicativo OAuth é separada da credencial de usuário do
sistema. Para iniciar OAuth, o projeto salva somente App ID e App Secret no
cofre `meta_ads_app`; token de acesso, Business ID e allowlist não são exigidos
nesse modo. O modo `system_user` continua exigindo token, Business ID e contas
permitidas e permanece armazenado como uma conexão `meta_ads` independente.

Configuração OAuth de produção:

- callback: `https://web-production-a818d.up.railway.app/dashboard/integracoes/meta/callback`;
- tokens OAuth de usuário são armazenados no cofre com tipo isolado pelo UUID
  da conexão (`oauth_access_token:<connection_id>`), permitindo revogação e
  rotação independentes sem expor o valor no painel ou nos logs;
- escopos iniciais: `ads_read` e `business_management`;
- estado aleatório armazenado somente como hash, válido por dez minutos e
  consumido uma única vez;
- troca do código e leitura da identidade executadas exclusivamente no servidor;
- token resultante cifrado por conexão.
- após o callback, as contas acessíveis são apenas listadas; o usuário precisa
  selecioná-las explicitamente antes de formar a allowlist do projeto.
- cada conexão aparece separadamente no projeto e pode ser validada, sincronizada
  ou revogada sem apagar o catálogo histórico de outras conexões.
- a prévia é gerada somente para versão criativa aprovada e valida que conexão,
  conta, campanha e conjunto pertencem ao mesmo catálogo autorizado.

Inicialmente:

- Leitura e arquivamento.
- Sincronização incremental diária e intradiária.
- Cópia de metadados e mídia permitida.

Futuramente:

- Criar, pausar e alterar orçamento com aprovação.
- Receber uma versão aprovada da Central de Criativos.
- Exigir seleção explícita de conta, campanha, público, destino e orçamento.
- Gerar prévia e registrar aprovação antes da chamada de escrita.
- Armazenar IDs retornados para campanha, conjunto, anúncio, criativo e mídia.
- Relacionar um criativo e sua versão a vários anúncios sem perder o histórico.
- Registrar requisição, aprovador, estado anterior, resposta, falha e
  reconciliação.

Importar do Drive ou aprovar um criativo não autoriza publicação na Meta.

Fundação implementada:

- credencial cifrada por projeto;
- App ID e Business ID preservados como configuração;
- allowlist explícita de contas de anúncio;
- modo inicial `preparation_only`;
- validação server-side do token sem expô-lo no navegador, URL ou logs;
- leitura do perfil técnico e das contas presentes na allowlist;
- sincronização paginada e idempotente de campanhas e conjuntos das contas
  autorizadas, em entidades próprias do projeto;
- versão da Graph API fixada e registrada na configuração validada;
- solicitação, prévia imutável e aprovação externa separadas;
- hash do snapshot aprovado para impedir alteração silenciosa.
- agenda e histórico físico de sincronizações automáticas por conexão, ambos
  desativados por padrão até a implantação validada do executor no worker.
- executor paginado no worker para contas, campanhas, conjuntos, anúncios,
  criativos e insights diários, com fila concorrente, limite de páginas,
  tentativas com backoff e falha terminal para credencial ou configuração
  inválida.
- monitor de qualidade para agenda atrasada, execução parada e última execução
  terminal por conexão.

A validação da conexão e a sincronização continuam estritamente de leitura.
Separadamente, o executor governado do Gerenciador de Anúncios aceita pausa,
ativação, alteração de nome e orçamento diário somente após solicitação,
aprovação de proprietário ou administrador e um segundo comando explícito de
execução. Toda escrita é relida na Graph API e só atualiza o catálogo local
quando o estado confirmado coincide exatamente com o desejado. Não existe
automação dessas mudanças, e publicação de anúncio ou campanha permanece fora
do executor.

Notas operacionais do sincronizador Meta:

- o catálogo usa uma janela de atualização controlada para preservar a cota da
  Graph API, enquanto os insights diários seguem a agenda normal;
- insights válidos de anúncios históricos materializam as identidades mínimas
  de campanha, conjunto e anúncio antes da persistência, evitando descarte de
  métricas quando o objeto não aparece mais no catálogo atual.
- a consulta de insights usa intervalo explícito e inclusivo, encerrado no dia
  corrente do fuso da conta de anúncios. Os últimos 30 dias são reconsultados
  idempotentemente porque a Meta pode revisar valores recentes; presets que
  omitem o dia corrente não são usados para o consolidado financeiro.

## Sendflow

Objetivo: mensagens, campanhas, listas, entregas, cliques, respostas e possíveis conversões intermediárias.

Validar:

- Webhooks e IDs de contato.
- Telefone normalizado.
- Campanhas e sequências.
- Status de entrega e interação.

## Hotwebinar

Objetivo: inscrições, presença, entrada/saída, duração, interações e sessões.

Validar:

- Eventos ao vivo versus gravação.
- Identidade disponível.
- Métricas de retenção e oferta.
- Relação entre webinar recorrente e lançamento.

## Datacrazy

Objetivo ainda precisa ser detalhado com payloads e fluxo real.

O documento geral das ferramentas está em `docs/fontes-originais/ferramentas/Contexto_Tecnico_Sistemas_Funil.docx`.

## Formulários próprios

### Coleta própria de páginas e VSL

O endpoint `POST /track/v1/:publicKey/events` recebe lotes de até 25 eventos
permitidos. A chave identifica uma fonte ativa do projeto e a origem HTTP deve
pertencer à allowlist quando configurada. Reentregas não duplicam fatos.
O coletor não recebe senha, documento, texto digitado em formulário ou IP
persistido. Eventos de bot permanecem armazenados e marcados fora da análise
principal.

Objetivo: captura de lead, pesquisa de persona e eventos comportamentais.

Devem enviar:

- Identificador do projeto.
- Página e URL.
- UTMs.
- Identificador do visitante.
- Campos do formulário.
- Consentimento quando aplicável.
- Timestamp e chave idempotente.

## Próximas integrações possíveis

- Google Ads.
- Outros gateways.
- Plataformas de e-mail/CRM.
- WhatsApp para relatórios.

Só entram no roadmap após as fontes iniciais estarem confiáveis.
## Railway e domínios personalizados

- A integração Railway é configurada por projeto no cofre de integrações.
- O token da API é criptografado; Project ID, Environment ID e Web Service ID
  ficam na configuração não secreta da conexão.
- O fluxo separa três estados: propriedade confirmada pelo TXT do Funil
  Metrics, provisionamento do hostname na Railway e ativação após CNAME, TXT da
  Railway e HTTPS válidos.
- O Funil Metrics nunca altera automaticamente a zona DNS do cliente. Após o
  provisionamento, mostra os registros exatos que o proprietário deve publicar.
- O identificador retornado pela Railway, os registros requeridos, o estado do
  certificado e as conferências operacionais ficam preservados por domínio.
## Cloudflare — domínios próprios

O projeto pode guardar uma conexão `cloudflare_account` independente da conexão
`cloudflare_r2`. O token de R2 não deve ser reutilizado para administrar DNS.

Fluxo:

1. administrador informa Account ID e API Token em **Integrações**;
2. o painel valida o token sem registrá-lo em logs;
3. ao cadastrar domínio principal e subdomínio, a API cria ou reutiliza a zona;
4. o painel mostra os nameservers atribuídos;
5. o usuário altera os nameservers no registrador;
6. o painel consulta o estado da zona e, quando `active`, vincula o subdomínio ao
   Worker de redirecionamento;
7. o domínio só fica `active` depois da confirmação do provedor.

A operação é idempotente e não altera registros de outras zonas. Falhas
preservam o domínio e o histórico para nova tentativa.

Uma zona Cloudflare pode ser reutilizada por vários subdomínios. Ao cadastrar
um segundo hostname do mesmo domínio principal, o sistema localiza a zona
existente e cria apenas o novo vínculo com o Worker. Os nameservers não precisam
ser alterados novamente.
# Cotações cambiais — Banco Central do Brasil

- Fonte oficial inicial: serviço PTAX/OData do BCB, operação
  `CotacaoMoedaPeriodo` e catálogo `Moedas`.
- Política: cotação de venda do boletim `Fechamento`; busca histórica limitada
  e escolha do último dia disponível menor ou igual à data do gasto.
- Conversões cruzadas usam uma mesma data de fechamento comum às duas moedas,
  via BRL. A resposta e a regra são persistidas; o dashboard não consulta o BCB.
- Falhas HTTP, ausência de moeda ou cotação mantêm a linha bloqueada e geram
  observabilidade. Nenhum endpoint ou taxa é inventado.
