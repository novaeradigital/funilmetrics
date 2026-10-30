# Registro de decisões

## D-083 — Templates nomeados do Dashboard V2

- Composições personalizadas são salvas em `dashboard_templates`, isoladas por organização e projeto, com nome, autor, data e definição versionada.
- Nomes duplicados no mesmo projeto são rejeitados para evitar ambiguidade.
- Aplicar um template modifica apenas o rascunho local; nenhuma configuração ativa é substituída sem `Salvar layout`.
- A criação registra `dashboard_template_created` na auditoria e continua limitada a métricas e widgets governados, sem SQL ou JavaScript livres.

## D-082 - Duas bases financeiras Lastlink no dashboard

Data: 02/08/2026  
Status: aceita e implementada

- Valor total da venda e comissao do produtor sao medidas diferentes.
- Somente `Commissions.Source = PRODUCER` comprova a comissao do produtor.
- Comissao e a base padrao; o dashboard permite selecionar o valor total.
- Comissao ausente gera cobertura parcial, nunca fallback silencioso.
- O historico deriva do payload bruto imutavel e permanece auditavel.

## D-081 — Dashboard V2 reutiliza a persistência versionada oficial

Data: 01/08/2026  
Status: aceita e implementada

- O layout personalizável de `/dashboard-v2` usa `dashboards`, `dashboard_versions` e `dashboard_widgets`.
- Cada projeto possui um dashboard V2 identificado internamente por `[funil-metrics:dashboard-v2]` e um rascunho independente.
- Os blocos semânticos usam `config.v2Kind`, sem tabela ou fonte de verdade paralela.
- O salvamento exige papel de edição, usa transação e bloqueio por projeto e registra `dashboard_v2_layout_updated` na auditoria.
- O banco, não o armazenamento local, determina o layout carregado em outros dispositivos.

## D-046 — Resolução de credenciais por projeto no runtime

Data: 24/07/2026  
Status: aceita e implementada

O worker e a prévia autenticada resolvem R2 e ClamAV pelo projeto do ativo ou
do item de importação. Configurações não secretas vêm de `connections`; bundles
secretos são decifrados em memória somente no servidor. Variáveis de ambiente
continuam como fallback temporário de migração, sem precedência sobre uma
configuração ativa do projeto.

Falha de cofre, configuração incompleta ou serviço ausente mantém a importação
fechada, registra código técnico sem segredo e nunca promove o arquivo da
quarentena. A chave mestra é compartilhada apenas pelos runtimes autorizados.

## D-045 — Cofre central de integrações no painel

Data: 24/07/2026  
Status: aceita e implementada

Credenciais por projeto são administradas em Integrações, cifradas com
AES-256-GCM e nunca reveladas após o salvamento. Configuração não secreta,
segredo e auditoria são registros separados. Credenciais operacionais continuam
bloqueadas quando o cofre do servidor não está configurado.

O banco mantém allowlists explícitas de provedores (`google_drive`,
`google_drive_app`, `openai`, `cloudflare_r2`, `clamav`) e tipos de segredo (`oauth_refresh_token`,
`credential_bundle`); valores arbitrários continuam rejeitados.

`google_drive_app` identifica as credenciais da aplicação OAuth/Picker;
`google_drive` continua reservado às conexões de contas e refresh tokens.

## D-044 — Resultados de IA versionados e execução opt-in

Data: 24/07/2026  
Status: aceita; fundação implementada

Transcrição, extração e análise possuem jobs e resultados separados, sempre
ligados à versão exata. A análise registra modelo, versão do prompt, evidências
e confiança. A infraestrutura permanece opt-in: ausência de chave, modelo,
orçamento ou worker mantém a ação desabilitada e não envia conteúdo.

## D-043 — Metadados editoriais por versão e tags com remoção histórica

Data: 24/07/2026  
Status: aceita e implementada

Copy, headline, CTA, destino e observações são rascunhos editoriais vinculados à
versão exata do criativo. Editá-los não altera os bytes nem substitui a versão
binária. Tags possuem catálogo por projeto e atribuições separadas por origem
`manual` ou `ai`.

Remover uma tag marca `removed_at` e preserva a atribuição histórica. Toda
alteração registra ator, instante, antes e depois. Somente proprietário,
administrador ou editor com acesso ao projeto pode editar.

## D-042 — Prévia autenticada sem URL pública do R2

Data: 24/07/2026  
Status: aceita e implementada

Imagens e vídeos da biblioteca são entregues por rota autenticada do Funil
Metrics. A rota confirma organização, projeto, associação do usuário, varredura
`clean` e disponibilidade do ativo antes de ler o objeto privado. O bucket não
é público e a chave interna não é enviada ao navegador.

Vídeos aceitam requisições `Range`; respostas usam cache privado `no-store` e
`nosniff`. Sem credenciais R2 no serviço web, metadados e histórico permanecem
visíveis, mas a prévia mostra indisponibilidade real.

## D-041 — Confirmação humana antes da cópia e quarentena obrigatória

Data: 24/07/2026  
Status: aceita e implementada

O inventário termina antes da cópia. Somente proprietário ou administrador pode
confirmar a importação do lote inventariado. O worker baixa por streaming para
arquivo temporário, calcula SHA-256 e tamanho real, envia ao prefixo privado de
quarentena, verifica com ClamAV e promove apenas resultado `clean`.

Conteúdo repetido para o mesmo arquivo de origem não cria nova versão. Conteúdo
alterado cria versão imutável, atualiza a versão atual do criativo e preserva as
anteriores. Falhas não expõem tokens, URLs temporárias nem respostas completas
dos fornecedores.

## D-040 — Inventário separado da cópia dos criativos

Data: 24/07/2026  
Status: aceita e implementada

O primeiro processamento manual do Drive lista e normaliza somente metadados de
imagens, vídeos, textos, PDFs e documentos Google. O job usa paginação,
subpastas opcionais, suporte a Shared Drives, lock para impedir duas solicitações
ativas da mesma pasta e upsert pelo ID externo.

Inventariar não equivale a importar: nenhum byte é copiado, disponibilizado ou
publicado nessa etapa. Os itens descobertos ficam pendentes para a etapa
posterior de download, quarentena, antimalware e versionamento.

## D-039 — Google Picker para autorização explícita de pastas

Data: 24/07/2026  
Status: aceita e implementada na fundação

Selecionar pastas pelo Google Picker usando `drive.file`, emitir access token
temporário apenas para sessão administrativa autorizada e validar novamente a
pasta no servidor antes de persistir. Isso preserva o menor escopo OAuth
compatível, evita IDs de pasta não comprovados e permite múltiplas pastas sem
conceder leitura irrestrita do Drive.

O refresh token permanece cifrado; tokens não entram em logs, auditoria ou
banco em texto puro; a resposta de sessão usa `no-store`. Selecionar uma pasta
não inicia inventário, cópia, análise ou publicação.

## D-001 — TypeScript como linguagem principal

Data: 23/07/2026  
Status: aceita

Usar TypeScript no frontend e backend para compartilhar contratos, reduzir troca de contexto e manter uma base coerente.

## D-002 — Next.js/React para interface

Data: 23/07/2026  
Status: aceita

Next.js é o framework da aplicação web; React é a biblioteca de interface utilizada por ele.

## D-003 — Supabase/PostgreSQL

Data: 23/07/2026  
Status: aceita

Usar PostgreSQL gerenciado pelo Supabase como banco principal. Dados relacionais e históricos da jornada se beneficiam do modelo relacional.

## D-004 — Drizzle ORM

Data: 23/07/2026  
Status: proposta aceita

Usar Drizzle para schema, consultas tipadas e migrações, mantendo SQL e modelo de dados compreensíveis.

## D-005 — Railway inicialmente

Data: 23/07/2026  
Status: aceita para início

Hospedar aplicação e workers inicialmente no Railway. Reavaliar por custo, confiabilidade e escala observada, sem acoplamento desnecessário.

## D-006 — Jornada híbrida como conceito central

Data: 23/07/2026  
Status: aceita

Pessoas têm uma jornada única e podem atravessar perpétuo, webinar, lançamento e outros funis. Classificamos funis e campanhas, não a pessoa.

## D-007 — Histórico próprio

Data: 23/07/2026  
Status: aceita

Persistir dados de anúncios, criativos e métricas para evitar perda histórica quando contas forem bloqueadas ou conexões removidas.

## D-008 — Teste A/B por link inteligente

Data: 23/07/2026  
Status: aceita

Começar com split por link e domínios personalizados. Script de página e editor visual ficam para etapa posterior.

## D-009 — Rebrandly fora do escopo

Data: 23/07/2026  
Status: aceita

As UTMs já estão disponíveis na Lastlink; o projeto não dependerá do Rebrandly.

## D-010 — Codex para design e implementação

Data: 23/07/2026  
Status: aceita

Criar o design system e as telas diretamente no projeto. Ferramentas externas de prototipação podem servir de referência, mas não serão a base técnica.

## D-011 — Evidência em camadas para a Lastlink

Data: 23/07/2026  
Status: aceita

Separar campos observados em produção, campos vistos apenas no simulador e
semânticas da documentação oficial. O simulador com `IsTest: true` comprova
estrutura possível, mas não obrigatoriedade, fórmulas ou coerência entre campos.
Payload bruto e origem da evidência serão preservados.

## D-012 — Estados financeiros iniciais da Lastlink

Data: 23/07/2026  
Status: aceita para início

Reconhecer receita bruta somente em `Purchase_Order_Confirmed`.
`Purchase_Request_Confirmed`, `Purchase_Request_Expired`,
`Purchase_Request_Canceled` e `Refund_Requested` não alteram receita.
`Payment_Refund` e `Payment_Chargeback` reduzem receita líquida sem apagar a
compra. Se ambos ocorrerem para o mesmo pagamento, reconciliar antes de aplicar
deduções para evitar dupla redução.

## D-013 — Google Drive como fonte da Central de Criativos

Data: 23/07/2026  
Status: aceita

Usar integração oficial por OAuth e permitir somente pastas explicitamente
autorizadas. Suportar múltiplas conexões e pastas por organização, projeto,
marca e produto. O Drive é fonte de entrada e organização, não dependência
permanente para exibir o histórico.

A lista de pastas autorizadas será aplicada pelo domínio do Funil Metrics. O
escopo OAuth definitivo permanece pendente porque seleção de pasta na interface
não garante, por si só, que o token do Google esteja tecnicamente restrito à
árvore selecionada.

## D-014 — Cópia própria e versionamento imutável de criativos

Data: 23/07/2026  
Status: aceita

Copiar arquivos autorizados para armazenamento próprio, preservar metadados e
hash e criar nova versão quando o conteúdo mudar. Alteração, movimento, remoção
ou perda de permissão no Drive não substitui nem apaga silenciosamente uma
versão já importada ou publicada.

## D-015 — Criativo, arquivo, versão e anúncio são entidades distintas

Data: 23/07/2026  
Status: aceita

Um criativo pode possuir vários arquivos e versões e ser utilizado em vários
anúncios e campanhas. Toda publicação referencia uma versão exata e preserva os
IDs retornados pela plataforma externa.

## D-016 — Publicação assistida com aprovação humana

Data: 23/07/2026  
Status: aceita

Importar ou aprovar um criativo não autoriza publicação. Escrita na Meta Ads
exige seleção explícita de conta, campanha, público, destino e orçamento,
prévia, permissão e aprovação humana auditada. Nenhum arquivo será publicado
automaticamente por entrar no Drive.

## D-017 — Entrega faseada da Central de Criativos

Data: 23/07/2026  
Status: aceita

Entregar na ordem: importação manual; sincronização e versionamento; IA;
revisão/aprovação; publicação assistida; modelos e automações controladas. A
publicação na Meta permanece na fase de inteligência e operação do roadmap.

## D-018 — Base técnica da Fase 1 da Central de Criativos

Data: 23/07/2026  
Status: aceita

Aprovar `docs/especificacoes/CENTRAL_CRIATIVOS_DRIVE_FASE_1.md` como base
técnica. A Fase 1 começa com Meu Drive, importação manual e recursiva de uma
pasta por execução, múltiplas pastas cadastráveis, formatos e limites
documentados, Google Docs exportado para DOCX e um criativo por arquivo
principal.

A implementação continua condicionada ao protótipo de `drive.file`, à escolha
do escopo OAuth e armazenamento, e à aprovação das políticas de retenção,
exclusão e antimalware.

## D-019 — Fundação técnica do monorepo

Data: 23/07/2026  
Status: aceita para início

Organizar a implementação com npm workspaces, mantendo `apps/web`, `apps/api` e
`apps/worker` como processos separáveis e contratos compartilhados em
`packages/domain`. A interface usa Next.js/React, a API modular inicial usa
Fastify e os processos usam TypeScript estrito.

API e worker podem ser implantados separadamente no Railway sem obrigar essa
separação no desenvolvimento local. Integrações externas continuam desacopladas
e nenhuma credencial real é mantida no repositório.

O comando `npm run check` executa tipos, lint, testes e build. Dependências
transitivas sinalizadas pelo `npm audit` devem ser acompanhadas e atualizadas de
forma controlada; correções automáticas com downgrade ou mudança incompatível
não serão aplicadas.

## D-020 — Isolamento organizacional no schema físico

Data: 23/07/2026  
Status: aceita para início

O schema físico começa com organizações, projetos, usuários, associações,
acessos por projeto e auditoria. O usuário interno poderá ser ligado ao
Supabase Auth por `auth_user_id`, sem fazer o domínio depender diretamente da
tabela gerenciada pelo provedor.

Associações de projeto usam chaves estrangeiras compostas com
`organization_id`. Assim, o banco rejeita o vínculo entre um membro de uma
organização e o projeto de outra, mesmo diante de erro na aplicação.

Papéis organizacionais iniciais são `owner`, `administrator`, `editor`,
`analyst` e `viewer`. Um acesso de projeto pode restringir o escopo e definir
papel específico. Row Level Security, capacidades por papel e fluxos de convite
serão definidos antes da disponibilização do ambiente compartilhado.

## D-021 — Supabase remoto e RLS conservadora

Data: 24/07/2026  
Status: aceita para desenvolvimento

Criar o projeto remoto `Funil Metrics` no Supabase Free, organização
`Funil Metrics Org`, região `sa-east-1`. Credenciais técnicas permanecem apenas
em arquivos locais ignorados pelo Git.

As migrações implantáveis ficam em `supabase/migrations`. A RLS inicial permite
somente leituras autenticadas compatíveis com organização, projeto e papel.
Escritas diretas pelo cliente ficam bloqueadas; mutações administrativas serão
executadas pelo backend com autorização e auditoria.

Proprietários e administradores podem ler todos os projetos de sua organização.
Editores, analistas e visualizadores precisam de vínculo explícito em
`project_memberships`. Essa política pode ser refinada junto da matriz de
capacidades, mas não deve ser ampliada silenciosamente.

## D-022 — Autenticação e bootstrap do primeiro proprietário

Data: 24/07/2026  
Status: aceita para desenvolvimento

Usar Supabase Auth com e-mail e senha, fluxo PKCE, sessão em cookies e renovação
no Proxy do Next.js. Páginas protegidas validam identidade no servidor e não
confiam apenas em dados de sessão fornecidos pelo navegador.

O primeiro usuário confirmado pode executar uma única inicialização
transacional que cria seu perfil interno, a organização `Funil Metrics`, o
projeto `Operação principal`, a associação com papel `owner` e a respectiva
auditoria. Um lock transacional impede dois proprietários iniciais concorrentes.

Depois que a primeira organização existe, contas novas sem associação recebem
`invitation_required` e não ganham acesso automaticamente. Convites e
administração de membros serão implementados como fluxo separado.

## D-023 — Recepção bruta e idempotente da Lastlink

Data: 24/07/2026  
Status: aceita para desenvolvimento

O primeiro incremento da Lastlink limita-se à recepção autenticada e à
preservação do evento bruto. Ele não cria pedidos, pagamentos, reembolsos,
pessoas nem métricas. Esses efeitos serão produzidos posteriormente por
processamento assíncrono e idempotente.

Cada conexão possui um endpoint público opaco e um segredo diferente. O banco
guarda somente hash scrypt do token atual e, durante uma janela de rotação, do
token anterior. Payloads e tokens não são registrados nos logs da aplicação.

O limite inicial do corpo é 1 MiB. Eventos novos retornam `202`; reentregas
reconhecidas retornam `200`; token inválido, JSON inválido e conexão inexistente
retornam respostas genéricas. JSON inválido autenticado é preservado em
quarentena antes da resposta.

A chave idempotente preferencial é o `Id` externo dentro da conexão. Na ausência
dele, usa-se SHA-256 de uma representação JSON canônica, com versão da
estratégia registrada. Campos desconhecidos são preservados, e os oito eventos
confirmados são validados de forma tolerante com Zod. Eventos desconhecidos e
estruturas parciais são guardados para análise, sem produzir efeito financeiro.

As tabelas `connections`, `webhook_endpoints` e `raw_events` usam RLS.
O navegador não acessa diretamente hashes de tokens nem payloads brutos; futuras
consultas administrativas deverão passar pelo backend, com autorização e
auditoria.

## D-024 — Implantação da API e conexão segura com o Supabase

Data: 24/07/2026  
Status: aceita para desenvolvimento

A API de ingestão será executada como serviço separado na Railway, empacotada em
imagem Docker multistage que contém somente a API e os pacotes de domínio e
banco necessários. O endpoint de saúde é `/health`, e o processo respeita a
porta fornecida pelo ambiente.

Como o endpoint direto do Supabase do plano atual é IPv6 e a saída da Railway
usada nesta implantação é IPv4, o runtime usa o pooler compartilhado em modo de
sessão. A conexão mantém TLS com verificação completa usando a CA oficial do
Supabase. Não é permitido desativar silenciosamente a validação do certificado.

Falhas inesperadas da API retornam resposta genérica com `requestId`. SQL,
parâmetros, tokens, payloads e detalhes da infraestrutura não podem ser
devolvidos ao remetente do webhook.

## D-025 — Tokens Lastlink por produto e gestão pelo painel

Data: 24/07/2026  
Status: aceita para desenvolvimento

A Lastlink gera automaticamente o `x-lastlink-token` e permite copiá-lo na tela
do webhook. Produtos diferentes podem gerar tokens diferentes. Portanto, um
projeto do Funil Metrics não será limitado a um único endpoint ou token
Lastlink.

A futura tela de Integrações permitirá cadastrar o produto e colar o token uma
única vez, testar a configuração, rotacionar e revogar. O token será armazenado
somente como hash e não poderá ser recuperado pelo painel após o salvamento.
Cada alteração terá auditoria. A granularidade final entre produto, oferta e
webhook ainda será confirmada com exemplos reais antes da migração física que
removerá a restrição atual de um endpoint por conexão.

## D-026 — Normalização idempotente e escopo financeiro da Lastlink

Data: 24/07/2026  
Status: aceita para desenvolvimento

Os oito eventos confirmados da Lastlink são normalizados em lotes concorrentes,
sem alterar `raw_events`. A camada inclui pessoas e identificadores, produtos,
ofertas, pedidos, itens, pagamentos, eventos normalizados e atribuição. Todos os
registros mantêm organização e projeto; entidades comerciais também separam
`production`, `test` e `unknown`.

Eventos com `IsTest: true` e eventos sem confirmação explícita de produção têm
efeito financeiro zero. Em produção, aprovação financeira exige `PaymentId` e
valor; somente a primeira aprovação aplica valor positivo e somente a primeira
reversão equivalente aplica valor negativo. Pedido de reembolso não reverte
receita. Reembolso e chargeback do mesmo pagamento não podem descontar duas
vezes.

O worker usa bloqueio transacional com `FOR UPDATE SKIP LOCKED`, chave única
entre evento bruto e evento normalizado e progressão de estado sem regressão.
Identidade ambígua é bloqueada para conferência. UTMs e parâmetros auxiliares
permanecem no bruto e também são copiados para a atribuição normalizada.

A camada normalizada inicia com RLS e sem acesso direto dos papéis de navegador.
Dashboards deverão consumi-la por endpoints autorizados. A execução contínua,
backoff operacional e monitoramento do worker são o próximo incremento.

## D-027 — Worker contínuo de normalização na Railway

Data: 24/07/2026  
Status: aceita e implementada

A normalização Lastlink roda em serviço Railway separado da API. O worker usa a
mesma conexão TLS do Supabase por referência interna de variável, sem duplicar
segredos no código, e valida a CA oficial incluída na imagem.

O ciclo inicial consulta o banco a cada cinco segundos, reivindica até 25
eventos com `FOR UPDATE SKIP LOCKED` e processa um evento por transação. Falhas
temporárias são tentadas no máximo cinco vezes; bloqueios de regra e falhas
esgotadas ficam em quarentena. O processo responde a `SIGTERM` e `SIGINT`,
encerra o pool de conexões e não interrompe a API de ingestão.

O polling no PostgreSQL é uma decisão operacional inicial. Redis ou outro
serviço de fila permanece opcional até volume, latência ou isolamento de cargas
justificarem o custo e a complexidade adicionais.

## D-028 — Cadastro administrativo inicial da Lastlink

Data: 24/07/2026  
Status: aceita e implementada

A primeira tela administrativa da Lastlink permite listar conexões autorizadas
e cadastrar uma conexão por produto. A ação ocorre exclusivamente no servidor,
revalida o usuário pelo Supabase Auth e exige papel de proprietário ou
administrador no projeto.

O token em texto puro existe apenas durante a submissão, é transformado em hash
scrypt compatível com a autenticação do webhook e não é persistido nem
devolvido. A criação da conexão, do endpoint e do registro de auditoria ocorre
na mesma transação. A resposta exibe a URL pública do webhook, nunca o token ou
seu hash.

Rotação, revogação e teste de conexão permanecem ações separadas para receberem
confirmação, estados próprios e auditoria antes de serem habilitadas.

Complemento implementado: a validação compara em tempo constante um token
informado com o hash atual; a rotação guarda apenas o hash anterior por uma
janela de 24 horas; e a revogação desativa a conexão imediatamente e remove a
janela anterior. As três ações exigem papel administrativo. A revogação exige a
confirmação textual `REVOGAR`, e todas produzem auditoria sem segredos.

## D-029 — Painel Next.js publicado como serviço separado

Data: 24/07/2026  
Status: aceita e implementada

O painel Next.js roda em serviço Railway separado da API e do worker, com domínio
HTTPS próprio e healthcheck na página de login. As rotas de painel permanecem
protegidas pelo Supabase Auth e redirecionam visitantes sem sessão.

As variáveis públicas do Supabase são incorporadas conforme o modelo do Next.js.
A conexão privada com PostgreSQL existe somente no runtime do servidor web e é
referenciada internamente a partir da variável já mantida na Railway; ela não é
enviada ao navegador. O certificado oficial do Supabase continua obrigatório
para a conexão TLS.

## D-030 — Resumo financeiro inicial da Lastlink

Data: 24/07/2026  
Status: aceita e implementada

O dashboard inicial consulta fatos normalizados e nunca calcula receita
diretamente do payload bruto. Somente o escopo `production` participa. Receita
bruta é a soma dos efeitos positivos; receita líquida é a soma algébrica dos
efeitos; reversões são apresentadas separadamente; e pagamentos são
deduplicados por `payment_id`.

Até existir seletor de período, a tela declara explicitamente “todo o histórico
disponível”, além de fonte, moeda, fuso e versão da regra. Dados de teste não
entram nos valores financeiros.

## D-031 — Exportação financeira agregada e auditada

Data: 24/07/2026  
Status: aceita e implementada

A primeira exportação do painel usa CSV com agregados financeiros diários e não
inclui dados pessoais. A consulta é executada no servidor após revalidar a
sessão e limitar o escopo ao primeiro projeto acessível do usuário.

Cada geração registra `financial_report_exported` em `audit_logs`, com ator,
organização, projeto, período, formato, quantidade de linhas, escopo de dados e
versão da regra. Consulta e auditoria participam da mesma transação; se a
auditoria falhar, o arquivo não é entregue.

## D-032 — Convites oficiais sem compartilhamento de senha

Data: 24/07/2026  
Status: aceita e implementada

Proprietários e administradores pré-autorizam um e-mail e um papel no banco,
sem usar uma chave administrativa do Supabase Auth no painel. A pessoa acessa a
tela pública de cadastro, define a própria senha e confirma o e-mail pelo fluxo
oficial do Supabase.

No primeiro login, `bootstrap_first_user` encontra a pré-autorização pelo e-mail,
vincula o `auth_user_id`, ativa o perfil e registra a data de entrada e a
aceitação na auditoria. Uma nova pré-autorização nunca rebaixa ou altera
silenciosamente um membro já ativo. Nenhuma
senha é compartilhada e nenhuma chave de privilégio amplo precisa existir no
serviço web. O proprietário não pode ser atribuído por convite nesta versão.

Complemento implementado: administradores podem alterar o papel ou remover o
acesso de membros que não sejam proprietários nem o próprio ator. A remoção
exige a confirmação textual `REMOVER`, elimina o vínculo de acesso da
organização e preserva perfil, fatos e auditoria. Um usuário já confirmado pode
receber acesso novamente sem recriar senha ou conta.

## D-033 — Escopo explícito de membros por projeto

Data: 24/07/2026  
Status: aceita e implementada

O escopo organizacional pode ser restringido por projeto. Ausência de registros
em `project_memberships` significa acesso a todos os projetos atuais e futuros;
o modo restrito exige pelo menos um projeto selecionado. A interface nunca
converte uma seleção vazia em acesso total sem que o administrador escolha
explicitamente esse modo, e toda mudança registra escopo anterior e posterior.

## D-034 — Saúde da Lastlink baseada em fatos internos observáveis

Data: 24/07/2026  
Status: aceita e implementada

O painel de conexão não afirma disponibilidade da Lastlink sem uma verificação
externa comprovada. O estado operacional deriva de eventos recebidos, estados de
processamento, quarentena, idade do backlog e ocorrências abertas pelo monitor.
A janela curta usa 24 horas e permanece separada dos totais históricos.

A taxa exibida como normalização é `eventos normalizados recebidos nas últimas
24 horas / total de eventos recebidos nas últimas 24 horas`. Duplicados,
payloads parciais, falhas e quarentena são exibidos separadamente para não
mascarar causas diferentes.

## D-035 — Fundação física da Central de Criativos antes do OAuth

Data: 24/07/2026  
Status: aceita e implementada

O domínio físico de Drive e criativos é criado antes da conexão externa para
garantir chaves, isolamento, idempotência e versionamento independentes do
provedor. A fundação separa conexão, pasta autorizada, arquivo observado, ativo
interno, criativo, versão e execução de importação.

O token OAuth será guardado por referência a um cofre/segredo e não em texto
puro nessas tabelas. O ativo usa chave imutável no R2 e só pode ficar disponível
após resultado antimalware `clean`. Todas as relações de negócio preservam
organização e projeto por chaves compostas, e as tabelas começam privadas, com
RLS habilitada e escrita apenas pelo backend. A criação do schema não autoriza
importação, análise ou publicação automática.

## D-036 — Um bucket R2 privado com prefixos isolados e chaves imutáveis

Data: 24/07/2026  
Status: aceita e implementada

O adaptador inicial usa a API S3 do Cloudflare R2 em um único bucket privado,
separando `quarantine/` de `assets-private/`. Chaves de quarentena incluem
organização, projeto, job e item; chaves definitivas incluem organização,
projeto e SHA-256 do conteúdo.

Configuração ausente mantém o recurso desligado e configuração parcial impede a
inicialização do worker. A promoção exige estado antimalware `clean`, copia para
a chave definitiva antes de remover a quarentena e não cria URL pública. As
credenciais de produção continuam pendentes e não foram adicionadas ao código
ou ao repositório.

## D-037 — Varredura ClamAV por streaming e falha fechada

Data: 24/07/2026  
Status: aceita e implementada

O worker usa o protocolo `INSTREAM` do ClamAV por conexão TCP privada. O
conteúdo é enviado em blocos com limite total e timeout configuráveis, sem
criar arquivo temporário local. Ausência completa de configuração mantém o
scanner desligado; configuração inválida impede a inicialização.

Somente a resposta `OK` produz `clean`. Ameaça encontrada produz `infected`
com nome sanitizado; limites ou formatos não suportados produzem `unsupported`;
falha de conexão, timeout ou resposta inesperada é retentável e nunca autoriza
promoção para `assets-private/`.

## D-038 — OAuth do Google Drive com `drive.file` e cofre criptografado

Data: 24/07/2026  
Status: aceita e implementada como fundação; configuração externa pendente

O fluxo usa OAuth 2.0 de aplicação web, acesso offline e o escopo não sensível
`drive.file`, além de `openid` e `email` exclusivamente para identificar a conta
conectada. O callback valida assinatura, expiração, nonce, sessão, papel e
projeto antes de trocar o código.

O refresh token é cifrado com AES-256-GCM e salvo em
`integration_secrets`, tabela privada com RLS e sem acesso do navegador. A chave
de criptografia permanece somente no runtime. Access token, código de
autorização, segredo do cliente e material criptográfico não entram na
auditoria. Sem configuração completa, o fluxo permanece desabilitado.

## D-039 — Leitura de árvores autorizadas do Drive com `drive.readonly`

Data: 25/07/2026  
Status: aceita após protótipo e implementada

O protótipo de produção confirmou que selecionar uma pasta pelo Google Picker
com `drive.file` concede acesso à pasta selecionada, mas não torna seus arquivos
descendentes enumeráveis pelo worker. O inventário terminou corretamente, porém
com zero arquivos, mesmo com conteúdo existente na árvore.

Como a funcionalidade aprovada exige selecionar pastas, detectar descendentes e
sincronizar arquivos futuros, o OAuth passa a solicitar `drive.readonly`.
Esse escopo permite leitura ampla e é classificado como restrito pelo Google;
por isso a interface continua exigindo seleção explícita das pastas que entram
na allowlist do Funil Metrics, não oferece escrita no Drive e pode exigir
verificação do aplicativo antes do uso público. A aplicação só inventaria as
pastas autorizadas internamente, ainda que o token tecnicamente permita leitura
mais ampla.

Contas já conectadas precisam consentir novamente. O refresh token anterior é
rotacionado de forma auditável, e nenhuma pasta selecionada inicia publicação
automática.

## D-040 — Reprodução privada por URL pré-assinada do R2

Data: 25/07/2026  
Status: aceita e implementada

Imagens e vídeos da Central de Criativos permanecem em bucket privado. Antes de
entregar uma prévia, o backend valida a sessão, o vínculo da organização e o
acesso ao projeto. Para um ativo disponível e aprovado pelo antimalware, gera
uma URL `GET` pré-assinada limitada ao objeto exato e válida por cinco minutos.

O navegador segue um redirecionamento temporário e lê o objeto diretamente do
R2. Assim, o próprio armazenamento atende requisições parciais de vídeo,
incluindo duração, avanço e retrocesso, sem transportar os bytes pela Railway.
Credenciais do R2 nunca são enviadas ao cliente. A URL temporária é tratada
como token portador, usa `no-store` e política de referência restrita. O bucket
não se torna público.
## D-041 — Transcrição manual por versão com áudio derivado

- **Status:** aceita
- **Data:** 2026-07-25
- **Decisão:** a primeira execução de IA da Central de Criativos será solicitada
  manualmente por versão. O worker baixa a cópia privada autorizada do R2,
  extrai áudio mono temporário com FFmpeg, envia somente esse áudio ao endpoint
  de transcrição configurado no projeto e apaga os temporários ao terminar.
- **Idempotência:** a chave combina versão do processo, SHA-256 do conteúdo e
  modelo. Repetir a ação não cria cobrança duplicada para a mesma combinação.
- **Segurança:** resultados e estados são persistidos; segredos, conteúdo e
  respostas brutas não aparecem em logs. Nenhuma transcrição publica anúncios.
- **Limite operacional:** o áudio derivado precisa ficar abaixo de 24 MiB; acima
  disso o job falha com código seguro até existir particionamento.

## D-042 — Análise estruturada baseada somente na transcrição

- **Status:** aceita
- **Data:** 2026-07-25
- **Decisão:** a análise é solicitada manualmente após a transcrição e usa
  Structured Outputs na Responses API. Gancho, promessa, mecanismo, prova,
  objeções, CTA, estrutura, hipóteses, evidências, confiança e tags são
  persistidos por versão.
- **Guardrail:** o modelo deve distinguir evidência textual de hipótese e não
  pode inferir desempenho real sem métricas observadas.

## D-043 — Aprovação humana vinculada à versão

- **Status:** aceita
- **Data:** 2026-07-25
- **Decisão:** editor pode enviar versão analisada para revisão; somente owner
  ou administrador pode aprovar. Status atual, histórico de transições e decisão
  de aprovação são armazenados separadamente.
- **Guardrail:** aprovação vale somente para a versão indicada e não autoriza
  publicação automática.

## D-044 — Prévia de publicação imutável antes da Meta

- **Status:** aceita
- **Data:** 2026-07-25
- **Decisão:** solicitação, prévia e aprovação da publicação são entidades
  separadas. A aprovação guarda o SHA-256 do snapshot que contém versão,
  conta, campanha, conjunto/público, destino, orçamento e moeda.
- **Guardrail:** qualquer alteração no snapshot exige nova prévia e nova
  aprovação. Salvar credenciais Meta nunca dispara publicação.

## D-045 — Validação Meta server-side e restrita à allowlist

- **Status:** aceita
- **Data:** 2026-07-25
- **Decisão:** o token da Meta é decifrado somente no servidor e enviado à Graph
  API pelo cabeçalho `Authorization`. A validação lê o perfil técnico e apenas as
  contas explicitamente presentes na allowlist do projeto.
- **Versionamento:** a versão da Graph API usada na validação é fixada no código
  e registrada junto ao resultado, permitindo migração auditável.
- **Guardrail:** a validação não consulta contas fora da allowlist e não executa
  operações de escrita. Token, segredo e resposta bruta não são persistidos em
  auditoria nem enviados ao navegador.

## D-046 — Catálogo Meta local, paginado e não destrutivo

- **Status:** aceita
- **Data:** 2026-07-25
- **Decisão:** contas, campanhas e conjuntos autorizados são sincronizados para
  entidades próprias por projeto. A chave externa da Meta é única dentro do
  projeto e novas leituras atualizam a entidade de forma idempotente.
- **Paginação:** cursores são reaplicados a endpoints construídos pelo sistema;
  URLs de paginação retornadas pela Meta não são reutilizadas, evitando propagar
  tokens eventualmente presentes nelas.
- **Guardrail:** uma execução incompleta não remove registros locais. Remoção e
  arquivamento exigirão reconciliação completa e explícita.

## D-047 — Dois modos de autorização Meta

- **Status:** aceita
- **Data:** 2026-07-25
- **Decisão:** o Funil Metrics suportará `oauth_user` para clientes de SaaS e
  `system_user` para operações/agências. Autorização, conexão e catálogo são
  conceitos separados e ficam isolados por organização e projeto.
- **Acesso efetivo:** permissões aprovadas no app não concedem ativos por si só;
  o acesso é a interseção entre app, token/identidade, escopos concedidos e
  ativos atribuídos ou compartilhados.
- **Guardrail:** contas externas nunca são descobertas ou ativadas globalmente.
  Cada projeto mantém allowlist explícita e revogação independente.

## D-048 — Publicação Meta passa primeiro por execução simulada

- **Status:** aceita
- **Data:** 2026-07-25
- **Decisão:** uma aprovação de prévia cria inicialmente uma execução em modo
  `simulation`. A liberação real será uma ação posterior, explícita e separada.
- **Idempotência:** solicitação e aprovação formam uma chave única; IDs de mídia,
  criativo e anúncio retornados futuramente são armazenados separadamente.
- **Reconciliação:** timeout após chamada de escrita nunca autoriza repetição
  cega; o estado muda para `reconciliation_required`.

## D-049 — Sincronização Drive agendada por pasta

- **Status:** aceita
- **Data:** 2026-07-25
- **Decisão:** cada pasta autorizada possui agenda persistente, inicialmente
  desativada, com intervalo mínimo de quinze minutos.
- **Concorrência:** o worker seleciona agendas vencidas com `SKIP LOCKED` e cria
  jobs usando chave composta pela agenda e instante planejado.
- **Guardrail:** agendamento não publica criativos nem remove histórico; mudanças
  observadas serão registradas antes de qualquer nova versão.

## D-050 — Uso de IA separado da tabela de preços

- **Status:** aceita
- **Data:** 2026-07-25
- **Decisão:** tokens e duração são fatos medidos e imutáveis por job. Conversão
  para custo usa uma tabela de preços versionada, sem reescrever o uso original.
- **Guardrail:** ausência de preço válido deixa custo como desconhecido; não será
  apresentado custo zero nem precisão financeira falsa.

## D-051 — Papel do produto é classificação temporal explícita

- **Status:** aceita
- **Data:** 2026-07-25
- **Decisão:** principal, order bump, upsell, downsell, assinatura e adicional
  são classificações temporais auditáveis, com produto pai opcional.
- **Guardrail:** a posição em `Data.Products` ou a coocorrência no pedido não
  classifica automaticamente o produto.

## D-052 — Filtro de produto não implica atribuição financeira

- **Status:** aceita
- **Data:** 2026-07-25
- **Decisão:** o dashboard pode filtrar e comparar produtos por presença em
  pedidos, aprovações e pessoas, inclusive em série temporal diária.
- **Guardrail:** o valor total de um pedido com múltiplos produtos não é
  atribuído nem rateado por item sem uma fonte confiável de preço por produto.

## D-053 — Primeira anomalia é conservadora e somente informativa

- **Status:** aceita
- **Data:** 2026-07-25
- **Decisão:** a primeira regra automática compara o volume das últimas 24 horas
  com o histórico recente do próprio projeto e exige amostra mínima antes de
  abrir uma ocorrência persistente.
- **Guardrail:** o sinal não diagnostica causa, não prevê desempenho e não
  altera campanhas. Limiar, evidência e versão da regra são explícitos.

## D-054 — Preço de IA é configurado por projeto e preservado por vigência

- **Status:** aceita
- **Data:** 2026-07-25
- **Decisão:** custos estimados usam preços em BRL informados explicitamente
  para o modelo e operação no projeto. Cada alteração encerra a vigência
  anterior e cria uma nova versão.
- **Guardrail:** ausência de preço mantém custo desconhecido, nunca zero. Ao
  atingir o limite mensal medido, o worker não inicia nova chamada externa.

## D-055 — Simulação de orçamento começa como calculadora sem execução

- **Status:** aceita
- **Data:** 2026-07-25
- **Decisão:** a primeira simulação transforma orçamento, CPM, CTR, conversão,
  ticket e margem informados em um cenário matemático com fórmulas visíveis.
- **Guardrail:** o cenário não é previsão e não lê, cria ou altera campanhas.
  Premissas simuladas permanecem separadas das métricas observadas.

## D-056 — Extração textual determinística precede IA

- **Status:** aceita
- **Data:** 2026-07-25
- **Decisão:** arquivos TXT e documentos Google exportados como DOCX são
  extraídos localmente antes de qualquer interpretação por modelo.
- **Guardrail:** método, contagem de caracteres, avisos e versão do criativo são
  preservados; extração não equivale a análise nem aprovação humana.

## D-057 — Biblioteca filtra a versão atual sem ocultar o histórico

- **Status:** aceita
- **Data:** 2026-07-25
- **Decisão:** busca e filtros operam sobre o criativo e sua versão atual para
  manter a biblioteca rápida e previsível; o histórico permanece no detalhe.
- **Guardrail:** filtro vazio não altera, arquiva ou exclui registros e informa
  explicitamente que os arquivos continuam preservados.

## D-058 — Debriefing começa por fatos antes de hipóteses

- **Status:** aceita
- **Data:** 2026-07-25
- **Decisão:** o primeiro debriefing consolida receita, pedidos, pessoas,
  reversões, cobertura de origem e presença de produtos por período.
- **Guardrail:** rankings não demonstram causalidade; origem não é tratada como
  atribuição multitoque e receita total não é rateada entre produtos.

## D-059 — Segmentos iniciais são consultas explicáveis e sobrepostas

- **Status:** aceita
- **Data:** 2026-07-25
- **Decisão:** os primeiros segmentos derivam diretamente de compras aprovadas,
  recência e reversões com regras visíveis.
- **Guardrail:** participação não é gravada como verdade permanente, não
  representa propensão e não ativa públicos ou campanhas externas.

## D-060 — Score v1 descreve relacionamento, não prevê compra

- **Status:** aceita
- **Data:** 2026-07-25
- **Decisão:** o primeiro score combina recência, frequência, posição relativa
  de receita líquida e ausência de reversões, exibindo cada parcela.
- **Guardrail:** a pontuação não é propensão, não usa atributos sensíveis e não
  ativa comunicação, público ou campanha automaticamente.

## D-061 — Projeto ativo é escopo obrigatório, não preferência visual

- **Status:** aceita
- **Data:** 2026-07-25
- **Decisão:** o projeto ativo é persistido em cookie HTTP-only e validado
  novamente contra as permissões do usuário em cada seleção.
- **Guardrail:** consultas e integrações recebem o ID validado do projeto;
  trocar o seletor não agrega, move ou compartilha dados entre projetos.

## D-062 — Desempenho Meta contextualiza a análise, mas não prova causalidade

- **Status:** aceita
- **Data:** 2026-07-25
- **Decisão:** a IA pode analisar conjuntamente a transcrição e métricas Meta
  somente após ligação explícita do anúncio com uma versão criativa.
- **Guardrail:** o resultado usa linguagem de hipótese, separa moedas, informa
  o período observado e não altera status, aprovação ou campanha.

## D-063 — Vencedor e fadiga são classificações humanas no primeiro ciclo

- **Status:** aceita
- **Data:** 2026-07-25
- **Decisão:** os estados de desempenho são registrados manualmente por
  usuário autorizado, ligados à versão atual e acompanhados de justificativa.
- **Guardrail:** métricas e IA podem apoiar a decisão, mas não mudam o status
  automaticamente e a ação não pausa nem altera anúncios na Meta.

## D-064 — Sincronização Meta automática nasce desativada e enfileirada

- **Status:** aceita
- **Data:** 2026-07-25
- **Decisão:** cada conexão Meta poderá possuir uma agenda própria, inicialmente
  desativada, com intervalo mínimo de sessenta minutos. Cada instante planejado
  gera uma execução com chave idempotente e histórico de contagens e falhas.
- **Concorrência:** o worker selecionará agendas e execuções com bloqueio
  transacional e `SKIP LOCKED`; retentativas não criam uma segunda execução para
  a mesma conexão e instante planejado.
- **Retentativas:** falhas transitórias usam backoff exponencial persistido, de
  um minuto até o limite de uma hora; autenticação e configuração inválidas
  encerram a execução sem repetição automática.
- **Guardrail:** a agenda usa somente permissões de leitura, não remove catálogo
  histórico e não cria, pausa, publica ou altera campanhas. A interface só será
  habilitada depois que o executor do worker estiver implantado e validado.

## D-065 — Designação de variante é persistida na primeira exposição

- **Status:** aceita
- **Data:** 2026-07-26
- **Decisão:** a variante persistida para o par experimento–visitante prevalece
  sobre qualquer novo cálculo determinístico.
- **Motivo:** alterações posteriores de peso devem afetar apenas visitantes
  ainda não expostos, preservando consistência da experiência e da medição.
- **Concorrência:** a inserção usa a chave única do experimento e visitante e
  retorna atomicamente a variante já persistida em caso de reentrega simultânea.
## D-066 — Recomendações iniciais de campanhas são comparativos observados

- **Data:** 2026-07-26
- **Decisão:** a primeira leitura assistida de campanhas usa regras
  determinísticas e versionadas sobre entrega, CTR e CPC no período selecionado.
  Comparações financeiras são restritas à mesma moeda e exigem volume mínimo.
- **Guardrail:** os sinais não diagnosticam causa, não incorporam conversão ou
  LTV sem ligação comprovada, não declaram vencedor e não criam, pausam ou
  alteram campanhas.

## D-067 — Aprovação de ação não equivale a execução externa

- **Data:** 2026-07-26
- **Decisão:** pausa e orçamento podem ser preparados como snapshot imutável,
  identificado por SHA-256, e decididos por owner ou administrador.
- **Guardrail:** aprovação registra intenção humana sobre a versão exata; não
  chama a Meta, não altera campanha e não autoriza execução silenciosa futura.

## D-068 — Ação aprovada deve ser reconciliada antes de qualquer execução

- **Data:** 2026-07-26
- **Decisão:** a simulação compara conta, campanha e estado sincronizado com o
  snapshot aprovado e persiste o resultado idempotentemente.
- **Guardrail:** qualquer divergência produz `reconciliation_required`; a
  simulação não utiliza endpoint de escrita da Meta.

## D-069 — Assistente v1 usa intenções fechadas e métricas governadas

- **Data:** 2026-07-26
- **Decisão:** perguntas são classificadas localmente em receita, vendas, UTMs
  ou campanhas e executam consultas previamente revisadas.
- **Guardrail:** não há SQL livre, envio de dados pessoais a modelo, consumo de
  IA paga, interpretação causal ou ação externa.

## D-070 — Tracking próprio nasce com taxonomia fechada e mínimo de dados

- **Data:** 2026-07-26
- **Decisão:** páginas e VSL enviam somente eventos permitidos, em lotes
  limitados e idempotentes, para uma fonte pública vinculada ao projeto.
- **Privacidade:** IP e User-Agent completos não são persistidos; propriedades
  aceitam apenas escalares e não devem transportar conteúdo ou dados sensíveis.
- **Guardrail:** origem pode ser restringida por allowlist e bots são marcados
  fora da análise principal.

## D-071 — Retenção de VSL usa pessoas observadas, não eventos brutos

- **Data:** 2026-07-26
- **Decisão:** reprodução e progresso deduplicam primeiro por visitante,
  depois sessão e finalmente evento. O denominador é quem reproduziu no mesmo
  período e fonte.
- **Guardrail:** bots são excluídos; ausência de identificadores é explicitada
  porque o fallback por evento pode superestimar pessoas.

## D-072 — Tracking próprio não disputa o campo sck

- **Data:** 2026-07-26
- **Decisão:** CTAs recebem um identificador opaco `fmt_` apenas quando não
  existe `sck`; pedidos retornados com esse valor são ligados idempotentemente
  à fonte mais recente do visitante.
- **Guardrail:** valores existentes nunca são substituídos, bots são excluídos
  e a ligação é observacional, não causal.

## D-073 — Definição de funil não inscreve nem classifica pessoas

- **Data:** 2026-07-26
- **Decisão:** funis possuem tipo, janela e etapas ordenadas próprias. O
  lançamento exige início e fim; perpétuo pode não ter janela; híbrido preserva
  sua classificação explícita.
- **Guardrail:** criar etapas não presume que todos os eventos formam uma coorte
  sequencial e não altera campanha, produto ou jornada da pessoa.

## D-074 — Fonte entra no funil somente por associação explícita

- **Data:** 2026-07-26
- **Decisão:** métricas do funil usam fontes vinculadas manualmente e respeitam
  sua janela. Comportamento deduplica pessoas; finanças deduplicam pedidos.
- **Guardrail:** os volumes não viram taxa sequencial até existir comprovação de
  coorte e ordem entre as etapas.

## D-075 — Desassociar fonte de funil é reversível

- **Data:** 2026-07-26
- **Decisão:** a desassociação desativa o vínculo e preserva quem vinculou,
  desvinculou e quando; uma nova associação reativa o mesmo registro.
- **Guardrail:** nenhum evento, conversão ou histórico do funil é apagado. As
  métricas correntes consideram somente vínculos ativos.

## D-076 — Verificação de domínio não implica ativação

- **Data:** 2026-07-26
- **Decisão:** domínios são isolados por projeto e comprovados por TXT exclusivo
  em `_funil-metrics.<hostname>`.
- **Guardrail:** encontrar o TXT muda o domínio somente para `verified`.
  Provisionamento na hospedagem, TLS e ativação do tráfego permanecem etapas
  separadas e nunca ocorrem apenas pelo cadastro ou pela verificação.

## D-077 — Link inteligente em domínio personalizado respeita o projeto

- **Data:** 2026-07-26
- **Decisão:** o roteador aceita o domínio padrão da aplicação ou um domínio
  personalizado em estado `active`. Neste último caso, o slug é resolvido
  somente dentro do projeto proprietário do domínio.
- **Guardrail:** host arbitrário, domínio apenas cadastrado ou somente verificado
  recebe 404. A primeira exposição preserva o hostname de entrada sem alterar
  UTMs, atribuição persistente ou destino.

## D-078 — Provisionamento de domínio começa por solicitação reversível

- **Data:** 2026-07-26
- **Decisão:** somente um domínio `verified` pode receber solicitação de
  provisionamento; enquanto nenhuma operação externa ocorrer, a solicitação
  pode voltar para `verified`.
- **Guardrail:** solicitar não cria DNS, domínio Railway ou certificado, e não
  muda o domínio para `active`. A ativação depende de comprovação operacional
  posterior.

## D-079 — Auditoria central é restrita e redigida defensivamente

- **Data:** 2026-07-26
- **Decisão:** somente proprietários e administradores consultam a trilha
  central do projeto; lista e detalhe são somente leitura.
- **Guardrail:** antes, depois e metadados passam por redação recursiva de
  campos associados a token, segredo, senha, autorização e chaves, mesmo que
  uma origem tenha registrado esses campos indevidamente.
- **Cobertura:** credenciais, cookies, sessões e chaves privadas ou de
  assinatura também são tratadas como sensíveis pela mesma regra defensiva.

## D-080 — Exportações da auditoria preservam filtros e aplicam redação

- **Data:** 2026-07-26
- **Decisão:** proprietários e administradores podem exportar até dez mil
  registros da trilha do projeto, respeitando os filtros ativos.
- **Guardrail:** estados e metadados são sanitizados antes de entrar no CSV; a
  própria exportação gera auditoria com filtros, volume e versão da regra de
  redação, sem incluir segredos.
- **Consulta:** busca, ação, tipo de alvo e intervalo inclusivo de datas são
  aplicados igualmente à lista paginada e à exportação.

## D-081 — Governança de equipe acompanha o projeto ativo

- **Data:** 2026-07-26
- **Decisão:** a tela e as ações administrativas de equipe resolvem a
  organização a partir do projeto ativo, inclusive quando o usuário participa
  de mais de uma organização.
- **Guardrail:** gestão global de membros exige papel organizacional de
  proprietário ou administrador; um override administrativo limitado a um
  projeto não eleva privilégios na organização. Um identificador de membro de
  outra organização não pode deslocar silenciosamente o escopo da ação.

## D-082 — Auditoria do projeto inclui fatos globais da própria organização

- **Data:** 2026-07-26
- **Decisão:** a trilha de um projeto mostra seus registros específicos e os
  registros organizacionais sem `project_id`, identificando visualmente o
  escopo global.
- **Guardrail:** registros globais entram somente quando `organization_id`
  coincide com a organização do projeto ativo. Lista, detalhe, indicadores e
  exportação aplicam a mesma regra.

## D-083 — OAuth do Drive não escolhe projeto por fallback

- **Data:** 2026-07-26
- **Decisão:** o início da conexão Google Drive exige `projectId` explícito e
  igual ao projeto ativo da sessão.
- **Guardrail:** parâmetro ausente, inválido ou pertencente a outro projeto é
  recusado antes de carregar credenciais ou criar estado OAuth; a ordem de
  criação dos projetos nunca define o destino de uma integração.

## D-084 — Mutações de integração pertencem ao projeto ativo

- **Data:** 2026-07-26
- **Decisão:** toda alteração iniciada nas telas de integrações deve informar o
  projeto e o backend deve confirmar que ele é exatamente o projeto ativo da
  sessão antes de salvar, validar, revogar, rotacionar ou enfileirar trabalhos.
- **Motivo:** campos ocultos e IDs enviados pelo navegador não são autoridade.
  Um usuário que tenha acesso a mais de um projeto não pode alterar a
  integração de outro projeto por manipulação da requisição ou por uma aba
  antiga após trocar de projeto.
- **Aplicação inicial:** configurações gerais, orçamento e preços de IA,
  validações, conexões e sincronizações Meta, conexões Lastlink e todo o fluxo
  Drive (sessão do seletor, autorização de pasta, inventário, importação e
  retorno OAuth). Retornos OAuth da Meta seguem a mesma restrição.
- **Consequência:** após trocar o projeto, ações abertas em uma tela anterior
  são recusadas e o usuário deve repeti-las no contexto atual.

## D-085 — Estado OAuth da Meta é descartável e consumido atomicamente

- **Data:** 2026-07-26
- **Decisão:** o callback da Meta reivindica o estado OAuth com uma atualização
  condicional atômica antes de trocar o código por credenciais.
- **Guardrail:** apenas o primeiro callback válido consegue consumir um estado
  não expirado; tentativas simultâneas, repetidas ou posteriores recebem estado
  inválido e não criam conexões duplicadas.
- **Consequência:** se a comunicação externa falhar depois do consumo, o
  administrador inicia uma nova conexão; estados de autorização nunca são
  reutilizados.

## D-086 — Callback Meta falha de forma limitada e diagnosticável

- **Data:** 2026-07-26
- **Decisão:** chamadas do callback OAuth à Meta possuem limite de quinze
  segundos e tratam separadamente indisponibilidade, resposta HTTP recusada,
  corpo inválido e falha de persistência.
- **Guardrail:** tokens e respostas externas não são incluídos na URL, na
  mensagem apresentada ou em logs de aplicação.
- **Consequência:** falhas externas retornam ao painel com código operacional
  específico, sem deixar a requisição pendurada nem produzir erro genérico.

## D-087 — Callback Google Drive usa o mesmo limite operacional do OAuth

- **Data:** 2026-07-26
- **Decisão:** troca de código e validação de identidade no OAuth do Google
  Drive têm limite de quinze segundos, validação explícita do JSON recebido e
  mensagens distintas para indisponibilidade, recusa, escopo e identidade.
- **Guardrail:** credenciais, tokens e conteúdo das respostas do Google não
  aparecem nas mensagens exibidas ao usuário.
- **Consequência:** a Central de Criativos informa a causa operacional segura e
  orienta uma nova conexão quando o estado não pode ser reaproveitado.

## D-088 — Troca de projeto retorna somente para rotas internas do painel

- **Data:** 2026-07-26
- **Decisão:** o destino enviado pelo seletor de projeto é interpretado como
  URL, normalizado e aceito apenas quando pertence a `/dashboard` ou a uma rota
  filha no mesmo origin lógico.
- **Guardrail:** URLs absolutas, URLs de protocolo, barras invertidas,
  caracteres de controle e caminhos apenas parecidos com `dashboard` retornam
  para `/dashboard`.
- **Consequência:** a troca de contexto não pode ser usada como redirecionamento
  aberto; query string e âncora de rotas internas válidas continuam preservadas.

## D-089 — Novo projeto herda a organização do contexto ativo

- **Data:** 2026-07-26
- **Decisão:** quando já existe um projeto ativo, a criação de outro projeto é
  limitada à mesma organização desse contexto.
- **Guardrail:** a ordem de criação das associações do usuário não pode escolher
  silenciosamente outra organização. O usuário ainda precisa ser proprietário
  ou administrador organizacional.
- **Estado inicial:** quando a conta ainda não possui projeto acessível, o
  usuário escolhe explicitamente entre as organizações que administra; a ordem
  das associações nunca decide o destino.
- **Consequência:** integrações e dados do novo projeto nascem no tenant
  esperado em contas que participam de várias organizações.

## D-090 — Configurações alteram somente o projeto ativo

- **Data:** 2026-07-26
- **Decisão:** nome, moeda e fuso horário só podem ser atualizados quando o ID
  enviado corresponde ao projeto ativo da sessão.
- **Guardrail:** acesso administrativo a outro projeto não autoriza uma
  requisição manipulada ou originada de aba antiga a alterar seu cadastro.
- **Consequência:** o administrador troca primeiro o contexto e então edita as
  configurações, mantendo interface, auditoria e destino da mutação alinhados.

## D-091 — Criação de projeto exige administração organizacional

- **Data:** 2026-07-26
- **Decisão:** a interface consulta o papel da associação organizacional para
  decidir se exibe a criação de projeto.
- **Guardrail:** um override administrativo limitado a um projeto não concede
  o direito de criar novos escopos na organização.
- **Estado inicial:** quando ainda não existe projeto acessível, proprietário ou
  administrador escolhe a organização e cria o primeiro projeto nela.
- **Consequência:** a permissão mostrada no painel coincide com a autorização
  aplicada pelo backend.

## D-092 — Organização fica explícita em contas multi-tenant

- **Data:** 2026-07-26
- **Decisão:** quando o usuário possui projetos em mais de uma organização, o
  seletor mostra `organização - projeto`; a listagem de projetos sempre informa
  a organização proprietária.
- **Motivo:** nomes de projeto podem se repetir e o contexto precisa ser
  inequívoco antes de qualquer integração ou mutação.
- **Consequência:** a interface deixa claro o tenant ativo sem alterar IDs,
  escopos ou registros históricos.

## D-093 — Integrações usam o papel efetivo do projeto

- **Data:** 2026-07-26
- **Decisão:** configurar, validar, sincronizar ou revogar uma integração usa
  `role_override` do projeto quando existente e, caso contrário, o papel
  organizacional.
- **Separação:** esse override vale somente para recursos do projeto; criação
  de projetos e gestão global de membros continuam exigindo administração
  organizacional.
- **Consequência:** administradores delegados de projeto conseguem operar
  Google Drive, Lastlink, Meta, IA, R2 e ClamAV conforme exibido pela interface,
  sem ganhar privilégios no restante da organização.

## D-094 — Biblioteca privada é limitada ao projeto ativo

- **Data:** 2026-07-26
- **Decisão:** detalhe de criativo e emissão de URL assinada para imagem ou
  vídeo exigem que o ativo pertença ao projeto ativo, além da associação do
  usuário ao tenant.
- **Guardrail:** conhecer um ID de criativo ou ativo de outro projeto acessível
  não permite abri-lo em uma aba cujo contexto já foi trocado.
- **Consequência:** para consultar outro acervo, o usuário troca explicitamente
  o projeto; URLs privadas continuam curtas, autenticadas e sem cache público.

## D-095 — Ações do criativo exigem o projeto ativo

- **Data:** 2026-07-26
- **Decisão:** alterações editoriais, solicitações de IA, transições de revisão,
  aprovação, classificação de desempenho e preparação de publicação exigem que
  o criativo pertença ao projeto ativo da sessão.
- **Guardrail:** formulários de abas antigas e IDs manipulados são recusados
  antes de qualquer alteração ou enfileiramento.
- **Limite:** a preparação e a simulação continuam sem publicar anúncios reais;
  o envio à Meta permanece sujeito à aprovação humana e autorização explícita.
- **Consequência:** leitura e mutação usam o mesmo contexto de projeto, evitando
  alterações cruzadas em contas com vários projetos acessíveis.

## D-096 — Domínios personalizados começam com verificação sem automação externa

- **Data:** 2026-07-26
- **Decisão:** o projeto pode cadastrar um hostname e comprovar sua propriedade
  por um TXT exclusivo antes de solicitar provisionamento.
- **Guardrail:** cadastro e verificação não alteram DNS, hospedagem, certificado
  TLS ou tráfego. Endereços IP, hosts locais, URLs completas e rótulos DNS
  inválidos são recusados.
- **Auditoria:** criação, êxito ou falha da verificação e mudança da solicitação
  de provisionamento são registradas com projeto, ator e transição de estado.
- **Consequência:** a fundação é utilizável sem assumir um provedor de domínio;
  ativação permanece pendente até haver hospedagem e TLS confirmados.

## D-097 — Desativar domínio interrompe tráfego sem apagar histórico

- **Data:** 2026-07-26
- **Decisão:** proprietário ou administrador pode desativar um hostname; links
  inteligentes aceitam somente domínios no estado `active`.
- **Preservação:** domínio, verificações, exposições e auditoria permanecem no
  banco. A ação não remove registros nem altera destinos de experimentos.
- **Restauração:** o hostname retorna para `verified` quando já houve
  comprovação ou para `pending_dns` quando não houve; nunca volta diretamente
  para `active`.
- **Consequência:** a interrupção é imediata e reversível no produto, enquanto
  uma retomada exige nova conferência operacional de hospedagem e TLS.

## D-098 — Código de propriedade do domínio pode ser rotacionado

- **Data:** 2026-07-26
- **Decisão:** proprietário ou administrador pode substituir o código TXT de
  um domínio que não esteja ativo nem em provisionamento.
- **Guardrail:** a rotação remove a comprovação anterior e exige nova
  verificação. Domínio desativado continua desativado; os demais retornam para
  `pending_dns`.
- **Auditoria:** registra-se que houve rotação, sem persistir o código anterior
  ou o novo dentro do log.
- **Consequência:** códigos expostos ou configurados incorretamente podem ser
  revogados sem apagar o domínio e sem risco de reativação automática.

## D-099 — Saúde de domínio usa mensagens sanitizadas e estados explícitos

- **Data:** 2026-07-26
- **Decisão:** a tela apresenta rótulos operacionais em português, data da
  última consulta DNS, confirmação de propriedade e solicitação de
  provisionamento.
- **Guardrail:** códigos internos desconhecidos nunca são mostrados diretamente;
  a interface usa uma mensagem sanitizada e mantém o código técnico apenas no
  dado operacional autorizado.
- **Consequência:** usuários não técnicos distinguem espera de DNS, propriedade
  confirmada, provisionamento, atividade, falha e desativação sem interpretar
  enums ou logs.

## D-100 — Exportação de qualidade não contém payload bruto

- **Data:** 2026-07-26
- **Decisão:** o CSV de qualidade contém apenas identificadores operacionais,
  conexão, evento, estados e data de recepção no projeto e período ativos.
- **Guardrail:** payload, headers, tokens e dados pessoais normalizados não são
  incluídos; o limite é de dez mil linhas.
- **Auditoria:** período, quantidade, limite e versão dos campos são registrados
  sem copiar o conteúdo exportado para o log.
- **Consequência:** a equipe pode analisar fila, falha, quarentena e validação
  fora do painel sem transformar a exportação em uma cópia de dados sensíveis.

## D-101 — Painel e CSV compartilham o filtro operacional

- **Data:** 2026-07-26
- **Decisão:** qualidade pode ser filtrada por normalização, duplicidade, fila,
  falha, quarentena, validação parcial ou evento desconhecido.
- **Consistência:** cartões, conexões e CSV aplicam o mesmo projeto, período e
  predicado de estado.
- **Guardrail:** filtros apenas selecionam fatos existentes e nunca mudam o
  estado de processamento nem disparam reprocessamento.
- **Consequência:** o arquivo baixado corresponde ao diagnóstico visível, sem
  misturar categorias ou induzir contagens incompatíveis.

## D-102 — Diagnóstico recente não expõe payload

- **Data:** 2026-07-26
- **Decisão:** a qualidade lista até cinquenta ocorrências recentes e permite
  restringir painel e CSV a uma conexão do projeto ativo.
- **Campos:** horário, conexão, nome externo do evento, processamento e
  validação.
- **Guardrail:** a consulta não seleciona payload, headers, contato ou documento;
  um ID de conexão de outro projeto produz recorte vazio.
- **Consequência:** a equipe localiza rapidamente qual conexão e categoria
  concentram exceções sem ampliar a exposição de dados pessoais.

## D-103 — Retentativa manual aceita somente falha recuperável

- **Data:** 2026-07-26
- **Decisão:** proprietário ou administrador pode recolocar em `queued` apenas
  evento Lastlink do projeto ativo que esteja em `failed_retryable`.
- **Bloqueios:** falha terminal, quarentena, duplicidade, processamento ativo e
  evento normalizado não podem ser alterados por essa ação.
- **Auditoria:** código da falha e número de tentativas anteriores são
  preservados no estado anterior do log; o payload não é copiado.
- **Consequência:** a equipe antecipa uma nova tentativa segura sem contornar
  limites de falha, criar novo evento ou duplicar efeito financeiro.

## D-104 — Códigos de qualidade são sanitizados na interface

- **Data:** 2026-07-26
- **Decisão:** estados de processamento e validação recebem rótulos em português;
  tentativas e uma descrição segura da falha aparecem na ocorrência.
- **Guardrail:** somente códigos conhecidos possuem descrição específica.
  Qualquer valor desconhecido vira “Falha operacional registrada”, sem mostrar
  detalhe de banco, constraint ou stack.
- **Consequência:** o diagnóstico continua útil para operação e suporte sem
  transformar a interface em exposição de detalhes internos.

## D-105 — Detalhe da ocorrência consulta somente metadados operacionais

- **Data:** 2026-07-26
- **Decisão:** cada ocorrência possui uma página limitada ao projeto ativo com
  origem, estados, tentativas, parser, descrição sanitizada e auditoria manual.
- **Guardrail:** a consulta não seleciona `body_raw`, `body_json`,
  `allowed_headers`, hashes de corpo, contato, documento ou endereço.
- **Consequência:** suporte e operação investigam processamento e retentativas
  sem abrir o conteúdo original do webhook na interface cotidiana.

## D-106 — Política de mídia efetiva é compartilhada e versionada

- **Data:** 2026-07-26
- **Decisão:** MIME types, formato de saída e limite por arquivo da importação
  Drive pertencem ao contrato compartilhado `creative_media_import_v1`.
- **Aplicação:** o worker consulta esse contrato e o painel de integrações
  apresenta exatamente a mesma estrutura em modo somente leitura.
- **Guardrail:** a tela não promete retenção ainda não implementada; limites por
  execução passaram a integrar o mesmo contrato na D-108. ClamAV pode impor
  limite adicional configurado no projeto.
- **Consequência:** regras efetivas deixam de ficar duplicadas entre execução,
  documentação e interface, e futuras mudanças exigirão nova versão explícita.

## D-107 — Testes compilam o contrato compartilhado antes dos consumidores

- **Data:** 2026-07-26
- **Decisão:** a suíte raiz executa o build de `@funil-metrics/domain` no
  `pretest` antes de testar API, web e worker.
- **Motivo:** os consumidores usam declarações do fonte durante a tipagem e o
  JavaScript de `dist` em runtime; um artefato antigo poderia mascarar ou quebrar
  a suíte integrada.
- **Consequência:** teste local e pipeline exercitam a mesma versão do contrato
  compartilhado que será carregada pelos serviços compilados.

## D-108 — Importação Drive é bloqueada integralmente ao exceder o lote

- **Data:** 2026-07-26
- **Decisão:** `creative_media_import_v1` limita cada execução a 1.000 arquivos
  e 20 GB contabilizados por tamanho conhecido ou estimativa conservadora.
- **Aplicação:** o inventário preserva os metadados observados, mas encerra o job
  com motivo sanitizado antes de qualquer download; a confirmação server-side
  repete a validação sob bloqueio transacional.
- **Guardrail:** não existe importação parcial silenciosa. Arquivo sem tamanho
  de origem reserva preventivamente o máximo individual de seu MIME type e
  continua limitado durante o streaming.
- **Consequência:** a operação precisa selecionar uma pasta ou lote menor para
  prosseguir, mantendo o histórico do inventário e a explicação visível.

## D-109 — Ausência de rateio por produto não bloqueia o dashboard

- **Data:** 2026-07-26
- **Decisão:** o dashboard executivo e de campanhas é considerado entregue com
  as métricas observadas e reproduzíveis atualmente disponíveis.
- **Guardrail:** receita total de pedido não será dividida, rateada ou atribuída
  artificialmente entre produtos. A capacidade será adicionada somente quando
  uma fonte fornecer valor confiável por item.
- **Consequência:** o roadmap diferencia uma dependência de dados externos de
  uma pendência de implementação e não comunica precisão inexistente.

## D-110 — Download do Drive exige R2 e ClamAV validados por projeto

- **Data:** 2026-07-26
- **Decisão:** inventário de metadados permanece independente, mas a confirmação
  humana do download exige conexões ativas e validadas de Cloudflare R2 e
  ClamAV no projeto atual.
- **Aplicação:** a Central mostra a prontidão real, oculta a ação indisponível e
  a rota server-side repete a checagem sob o mesmo escopo organizacional. Uma
  tentativa bloqueada registra ator, job e motivo sanitizado na auditoria.
- **Guardrail:** configuração apenas salva não equivale a serviço operacional;
  R2 também exige bundle secreto ativo no cofre do mesmo projeto. Nenhum arquivo
  entra em quarentena sem armazenamento e scanner previamente testados.
- **Revalidação:** um teste posterior com falha remove imediatamente a prontidão
  anterior e registra auditoria sanitizada na mesma transação; somente novo
  teste bem-sucedido restaura o estado válido.
- **Consequência:** falhas previsíveis deixam de virar jobs quebrados e cada
  projeto mantém suas próprias dependências operacionais.

## D-111 — Painel não antecipa destino DNS antes do provisionamento

- **Data:** 2026-07-26
- **Decisão:** durante a etapa atual, o usuário publica somente o TXT de
  propriedade exibido para o hostname cadastrado.
- **Guardrail:** a interface não recomenda CNAME, IP, proxy ou alteração no
  servidor enquanto a hospedagem não devolver um destino operacional e o TLS
  não estiver verificável.
- **UX:** cadastro, propriedade, provisionamento, apontamento e ativação são
  apresentados como etapas distintas, com indicação de que a alteração
  geralmente ocorre no provedor DNS.
- **Consequência:** evita apontamento prematuro, interrupção de tráfego e falsa
  impressão de que verificar propriedade já torna o domínio acessível.
## D-112 — Provisionamento auditável de domínios pela Railway

Data: 27/07/2026  
Status: aprovada

O provisionamento de domínio personalizado usa a API oficial da Railway e uma
credencial criptografada, isolada por projeto. A comprovação de propriedade, o
roteamento DNS e a disponibilidade HTTPS são estados independentes. A aplicação
não declara o domínio ativo somente porque o TXT interno foi encontrado e não
altera a zona DNS do cliente. O ID externo e os requisitos DNS retornados são
preservados para idempotência, suporte e auditoria.

## D-113 — Redirecionamento A/B na borda com fallback Railway

Data: 27/07/2026  
Status: aprovada para implementação; ativação condicionada a custo e credencial

O caminho de alto volume dos links inteligentes será executado em Cloudflare
Workers. Configurações são obtidas da API autenticada e mantidas em cache curto;
exposições são desacopladas do `302` e, em produção, seguem por Cloudflare
Queues. A Railway permanece responsável pelo núcleo da aplicação e oferece a
rota de contingência durante a migração. A mudança de DNS exige teste de carga,
reconciliação, segredo compartilhado configurado e autorização explícita para
qualquer plano pago.
## D-114 — Domínios próprios gerenciados pela Cloudflare

- **Status:** aprovado em 26/07/2026.
- **Decisão:** novos domínios de links inteligentes serão zonas próprias da
  operação, criadas idempotentemente pelo Funil Metrics na conta Cloudflare do
  projeto. O painel exibirá os nameservers atribuídos, acompanhará a ativação da
  zona e, após a delegação, vinculará o subdomínio ao Worker
  `funil-metrics-redirect`.
- **Responsabilidade humana:** a troca dos nameservers no registrador continua
  manual, pois o Funil Metrics não recebe credenciais do registrador.
- **Segurança:** o API Token da Cloudflare é criptografado, isolado por projeto e
  deve possuir apenas `Zone:Zone:Edit`, `Zone:DNS:Edit` e as permissões mínimas
  de Workers necessárias ao vínculo do domínio.
- **Contingência:** a Railway permanece como origem de fallback do Worker, mas
  não assume automaticamente uma indisponibilidade total do DNS da Cloudflare.
- **Subdomínios:** uma mesma zona pode atender vários hostnames, inclusive em
  projetos diferentes da mesma organização quando explicitamente cadastrados.
  O hostname completo permanece globalmente exclusivo para evitar roteamento
  ambíguo; a troca dos nameservers ocorre somente uma vez por domínio principal.

## D-115 — Referência visual escura e violeta como direção dominante

- **Data:** 27/07/2026.
- **Status:** aprovada.
- **Decisão:** a aplicação demonstrada no vídeo analisado em 27/07/2026 passa a
  ser a referência dominante de experiência para as telas equivalentes do Funil
  Metrics. A meta declarada é de 98% de proximidade perceptiva e funcional em
  composição, densidade, hierarquia, navegação e interação.
- **Identidade:** o verde dominante será substituído progressivamente por uma
  base azul-preta e violeta. Verde permanece reservado a sucesso, crescimento e
  estados saudáveis.
- **Limite:** a meta não autoriza copiar nome, logotipo, código, textos,
  ilustrações, fotografias, ícones proprietários ou outros ativos protegidos.
  Componentes, marca e implementação permanecem próprios.
- **Validação:** telas migradas serão comparadas lado a lado por checklist de
  estrutura, proporção, tipografia, paleta, estados, interação,
  responsividade, acessibilidade e fidelidade às métricas reais.
- **Consequência:** novas superfícies e revisões visuais devem partir do novo
  design system. Telas verdes existentes serão migradas em blocos, evitando uma
  troca parcial que torne fluxos críticos inconsistentes.

## D-116 — Navegação por módulos principais e funções internas

- **Data:** 27/07/2026.
- **Status:** aprovada pelo responsável do produto.
- **Decisão:** a lateral não exibirá todas as rotas simultaneamente. A navegação
  principal será formada por Visão geral, Performance, Funis e páginas,
  Criativos, Inteligência e Configurações.
- **Comportamento:** cada módulo revela suas funções internas em um submenu
  compacto. O módulo relacionado à rota atual abre automaticamente e os demais
  permanecem recolhidos.
- **Motivo:** reproduzir a hierarquia observada na referência aprovada, reduzir
  carga cognitiva e manter funções avançadas acessíveis sem poluir a navegação.
- **Limite:** reorganizar menus não altera permissões, escopo por projeto,
  métricas ou regras de negócio das rotas existentes.

## D-117 — Credencial do aplicativo Meta separada das autorizações

- **Data:** 27/07/2026.
- **Status:** aprovada pela continuidade do fluxo Meta em leitura.
- **Decisão:** App ID e App Secret usados pelo OAuth pertencem a uma
  configuração `meta_ads_app` isolada por projeto. Tokens OAuth de pessoas e
  credenciais de usuário do sistema continuam em conexões `meta_ads`
  independentes.
- **Motivo:** configurar o aplicativo não significa autorizar uma conta de
  anúncios. Exigir token, Business ID e allowlist antes do login OAuth misturava
  responsabilidades e bloqueava o fluxo oficial.
- **Segurança:** o App Secret permanece cifrado no cofre; o callback usa estado
  descartável, troca o código somente no servidor e exige seleção explícita das
  contas acessíveis.
- **Compatibilidade:** configurações legadas completas em `meta_ads` continuam
  elegíveis como origem do App ID e App Secret durante a transição.

## D-118 — Dashboards personalizáveis como fundação transversal

- **Data:** 29/07/2026.
- **Status:** direção de produto aprovada; implementação pendente.
- **Decisão:** dashboards deixam de ser uma página fixa e passam a ser uma
  capacidade versionada por projeto, composta por widgets, layout, filtros,
  templates e permissões.
- **Governança:** widgets consomem apenas métricas canônicas registradas, com
  fonte, fórmula, período, fuso, moeda e versão. Não haverá SQL livre no
  navegador nem fórmulas arbitrárias sem validação.
- **Versionamento:** edição ocorre em rascunho; uma versão publicada é imutável
  e pode ser restaurada sem apagar versões posteriores.
- **IA:** a assistência pode propor composição e filtros, mas precisa apresentar
  prévia e não publica mudanças automaticamente.
- **Consequência:** Gerenciador de Anúncios, Campanhas, Funis, Criativos,
  Lançamentos e Relatórios devem reutilizar o catálogo de métricas e os
  componentes de visualização, evitando regras divergentes.

## D-119 — Operação de anúncios separada da análise de campanhas

- **Data:** 29/07/2026.
- **Status:** separação inicial implementada; escrita externa continua pendente.
- **Decisão:** o Gerenciador de Anúncios será a superfície operacional para
  contas, campanhas, conjuntos, anúncios e criativos. A tela de Campanhas será
  dedicada à análise, comparação, detalhe e diagnóstico.
- **Continuidade:** projeto, conexão, conta, período, nível e filtros devem ser
  preservados na alternância entre as duas superfícies.
- **Guardrail:** alternâncias visuais não executam pausa, reativação ou mudança
  de orçamento sem permissão Meta de escrita, snapshot, aprovação humana,
  idempotência, auditoria e reconciliação.
- **Implementação inicial:** `/dashboard/gerenciador-anuncios` concentra a
  navegação operacional em modo somente leitura nos níveis conta, campanha,
  conjunto e anúncio. A preparação de mudanças encaminha para o fluxo auditado
  de aprovação; a análise comparativa permanece em `/dashboard/campanhas`.

## D-120 — Filtros globais pertencem à versão do dashboard

- **Data:** 29/07/2026.
- **Status:** implementada.
- **Decisão:** período, produto, conta de anúncios e campanha são armazenados
  em `global_filters` da versão. O modo visualizar consulta a última versão
  publicada; o modo editar consulta e altera exclusivamente o rascunho atual.
- **Integridade:** produto, conta e campanha precisam pertencer ao projeto; uma
  campanha informada junto de uma conta precisa estar vinculada a ela.
- **Consultas:** produto restringe fatos financeiros pela presença do item no
  pedido; conta e campanha restringem os fatos normalizados da Meta. Filtros
  ausentes mantêm a abrangência do projeto.
- **Motivo:** impedir que ajustes de exploração alterem silenciosamente uma
  visão publicada e manter reprodução e auditoria de cada versão.

## D-123 — Projeto ativo como contexto global validado no servidor

- **Data:** 30/07/2026.
- **Status:** implementada incrementalmente.
- **Decisão:** manter temporariamente as URLs `/dashboard/...` e usar o cookie
  HTTP-only `funil_metrics_project` como preferência de projeto, sempre
  resolvida no servidor contra organização, membership ativa e restrições de
  projeto.
- **Segurança:** uma seleção persistida sem acesso não é substituída
  silenciosamente por outro projeto e não autoriza consultas. O seletor recebe
  exclusivamente projetos já autorizados.
- **UX:** o seletor passa a viver na lateral, troca sem botão intermediário e
  preserva pathname e query string. O logout remove o cookie.
- **Evolução:** rotas explícitas `/dashboard/[projectId]/...` poderão ser
  adotadas posteriormente com redirecionamentos, sem serem requisito para o
  isolamento atual.
- **Domínio:** produto permanece uma dimensão interna do projeto; por padrão as
  métricas abrangem todos os produtos do projeto e filtros nunca atravessam seu
  escopo.

## D-121 — Acesso a dashboards herda o projeto até existir compartilhamento

- **Data:** 30/07/2026.
- **Status:** implementada.
- **Decisão:** um dashboard sem registros em `dashboard_access` herda o acesso
  do projeto. Quando recebe a primeira concessão individual, passa a ser
  visível somente para membros listados e para `owner` e `administrator`.
- **Edição:** `owner` e `administrator` administram acessos e editam qualquer
  dashboard do projeto. `editor` edita por herança ou quando recebe nível
  `edit`; nível `view` nunca autoriza mutações.
- **Segurança:** ações do servidor revalidam projeto, associação do membro,
  papel e ACL; ocultar controles na interface não é considerado autorização.
- **Auditoria:** concessão, alteração e revogação registram ator e estado
  anterior ou posterior sem apagar versões ou métricas.

## D-124 — Personalização altera somente o rascunho versionado

- **Data:** 30/07/2026.
- **Status:** implementada incrementalmente.
- **Decisão:** reorganização, redimensionamento, edição, duplicação e remoção de
  widgets operam exclusivamente sobre a versão `draft`. Uma versão publicada
  nunca é alterada silenciosamente.
- **Grade:** a interface usa doze colunas no desktop, tamanhos semânticos
  pequeno, médio, grande e largura total, redução progressiva no tablet e uma
  coluna no celular.
- **Configuração:** tipo, título e métrica são validados contra allowlists do
  servidor. Configurações do navegador não produzem SQL nem ampliam o escopo da
  consulta.
- **Auditoria:** criação, alteração, duplicação, remoção e layout registram ator,
  projeto e estado. Remover do rascunho preserva versões publicadas.
- **Identidade:** o construtor mantém linguagem própria do Funil Metrics e usa
  referências externas somente como inspiração de experiência.

## D-122 — IA compõe apenas rascunhos com métricas governadas

- **Data:** 30/07/2026.
- **Status:** implementada.
- **Decisão:** a OpenAI pode propor título, período, widgets, métricas e
  dimensões de layout, mas somente a partir do catálogo mantido pelo sistema.
- **Validação:** a resposta usa JSON Schema estrito e passa por uma segunda
  validação local. Métrica, tipo ou dimensão desconhecidos invalidam a proposta
  inteira.
- **Guardrail:** uma proposta válida cria exclusivamente uma nova versão
  `draft`; publicação continua sendo uma ação humana separada.
- **Custos e evidência:** cada solicitação registra prompt, proposta, modelo,
  tokens e custo estimado quando houver preço ativo, respeitando o teto mensal
  configurado para o projeto.
# 2026-08-01 — Grade e gráficos do dashboard personalizável

- O editor usa `react-grid-layout` para movimento, colisão, redimensionamento e
  posições determinísticas. A alternativa móvel por botões permanece
  obrigatória; arrastar não é o único meio de reorganização.
- Os gráficos governados usam `Recharts` e recebem somente séries normalizadas,
  nunca payload bruto.
- O editor mantém até trinta passos locais de desfazer/refazer. Somente o layout
  confirmado é validado no servidor e salvo no rascunho; versões publicadas
  continuam imutáveis.
- Templates não introduzem dados de demonstração. Sem cobertura real, o widget
  apresenta indisponibilidade em vez de zero.
# Dashboard V2 isolado antes da substituição da experiência atual

Data: 01/08/2026  
Status: em implementação

- A nova experiência de dashboards será construída inicialmente em
  `/dashboard-v2`; `/dashboard/dashboards` permanece intacta até aprovação
  visual e funcional.
- O shell possui somente menu lateral e área principal. A biblioteca fixa
  intermediária não faz parte do V2.
- As ações de dashboards ficam em menu cascata ancorado à navegação lateral.
- Autenticação, escopo por projeto, métricas governadas, consultas e
  persistência versionada existentes devem ser reaproveitados; o layout visual
  anterior não deve ser reutilizado.
- Dados financeiros ou de mídia ausentes são apresentados como indisponíveis
  ou parciais. Valores demonstrativos não são permitidos.
- A substituição da rota atual depende de comparação visual, grade
  arrastável e redimensionável, persistência por projeto e aprovação humana.
# D-125 — Consolidação financeira exige conversão histórica auditável

- **Data:** 02/08/2026.
- **Status:** implementada incrementalmente.
- **Decisão:** valores recebidos nunca são substituídos por valores convertidos.
  A moeda-base pertence ao projeto e a moeda original à conta e ao insight.
- **Fonte inicial:** PTAX de fechamento do Banco Central do Brasil, por uma
  abstração substituível de provedor. Fim de semana ou feriado usa somente o
  fechamento anterior e registra a data efetiva.
- **Segurança financeira:** moeda ausente, não confirmada, sem suporte, sem taxa
  ou com erro bloqueia agregados consolidados. Não há conversão silenciosa nem
  fallback futuro.
- **Reprocessamento:** mudança manual de moeda é auditada, preserva a origem e
  recoloca as linhas derivadas na fila. Regra e execução são versionadas.
- **Backfill:** nenhuma execução histórica em produção ocorre antes de
  estimativa, amostra reconciliada e plano aprovado.
- **Endurecimento posterior:** cálculo e recálculo usam exclusivamente
  `spend_original`. Mudança de gasto ou moeda invalida valor-base, taxa, fonte,
  data efetiva e instante de conversão anteriores antes da nova tentativa.

## D-126 — Editor visual unificado do Dashboard V2

- **Data:** 02/08/2026.
- **Status:** implementada incrementalmente.
- **Decisão:** KPIs, gráfico financeiro e widgets analíticos compartilham a
  grade de doze colunas baseada em `react-grid-layout`.
- **Biblioteca:** aparece somente no modo de edição, dentro da área principal,
  com busca, categorias, templates e arraste externo. Não é um menu permanente.
- **Rascunho:** movimento, resize, inclusão, remoção, templates e undo/redo são
  locais. Cancelar restaura o snapshot; salvar valida allowlist, limites e
  escopo do projeto no servidor antes de persistir a versão draft.
- **Responsividade:** desktop usa grade; no celular os widgets formam uma coluna
  e a biblioteca fica acima do canvas. Arraste não é a única forma de adicionar.
- **Configuração governada:** título, granularidade, comparação, legenda,
  tooltip e etapas do funil são validados por allowlist no servidor. Consultas,
  SQL e JavaScript livres não fazem parte do contrato do editor.
- **Funil:** cada etapa referencia uma métrica governada e só calcula conversão
  quando as duas etapas envolvidas possuem dado disponível e comprovado.
- **Instâncias:** cada widget possui `v2InstanceId` independente do seu tipo.
  Isso permite duplicar o mesmo tipo sem compartilhar posição, título ou
  configuração; o servidor valida a unicidade da instância no rascunho.
### 2026-08-02 — Configuração por instância no editor de dashboards

O editor persiste e aplica configurações por instância, incluindo granularidade independente, comparação governada, visualização, ordenação, limite e cores. A comparação considera o intervalo imediatamente anterior com a mesma duração e não fabrica valores quando a métrica não está disponível.

## D-127 — Continuidade visual durante sincronização de investimento

- **Data:** 04/08/2026.
- **Status:** implementada.
- **Decisão:** quando a Meta atualiza apenas o gasto de uma linha cuja data,
  moeda original e taxa histórica governada permanecem iguais, o valor-base é
  recalculado na mesma gravação usando a taxa já auditada. Os metadados da taxa
  não são descartados.
- **Cobertura parcial:** linhas novas que ainda aguardam taxa não são somadas
  como zero. O painel mantém visível somente o investimento convertido, marca
  o card como `Atualizando` e informa as linhas pendentes.
- **Guardrail:** lucro, ROAS e CPA exigem cobertura cambial completa. Portanto,
  o valor parcial de investimento não contamina métricas derivadas.

## D-128 — Funil agregado governado entre Meta Ads e Lastlink

- **Data:** 04/08/2026.
- **Status:** implementada.
- **Decisão:** o widget de funil pode usar impressões, cliques e ações comprovadas em `meta_ad_insights_daily.actions`, seguidas de pagamentos pendentes, vendas aprovadas e faturamento normalizados da Lastlink.
- **Autoridade:** a Meta governa as etapas de mídia e navegação; a Lastlink governa pagamento e receita. `purchase` da Meta não é tratado como venda aprovada.
- **Interpretação:** percentuais são razões agregadas entre etapas no período, não uma reconstrução individual da jornada.
- **Indisponibilidade:** quando `actions` não foi recebido, a etapa é marcada como indisponível em vez de assumir zero.

## D-129 — Clique no link como etapa governada do funil

- **Data:** 04/08/2026.
- **Status:** implementada.
- **Decisão:** a etapa entre impressões e visualizações da página usa exclusivamente a ação Meta Ads `link_click`. O campo agregado `clicks`, que inclui outras interações com o anúncio, não é usado no funil.
- **Compatibilidade:** configurações salvas que ainda referenciam `meta_clicks` são migradas em leitura para `meta_link_clicks`.
- **Guardrail:** ausência do array `actions` é exibida como dado indisponível; não é interpretada como zero.

## D-130 — Gerenciador Meta Ads como plano de controle auditável

- **Data:** 04/08/2026.
- **Status:** implementada incrementalmente.
- **Decisão:** o gerenciador expõe contas, campanhas, conjuntos e anúncios
  sincronizados, com filtros e preferências de colunas por usuário, projeto e
  nível da hierarquia.
- **Persistência:** busca, conta, status e período são guardados por usuário,
  projeto e nível. Parâmetros explícitos da URL prevalecem, preservando links
  reproduzíveis e compartilháveis sem misturar preferências entre projetos.
- **Ações:** pausar ou ativar campanha, conjunto ou anúncio cria uma
  solicitação idempotente com estado anterior, estado desejado, justificativa,
  ator e trilha de auditoria.
- **Aprovação:** proprietário ou administrador aprova ou rejeita a intenção.
  Aprovar não executa automaticamente a alteração na Meta nesta fase.
- **Próxima barreira:** a escrita externa dependerá de adaptador dedicado,
  permissões Meta comprovadas, idempotência de envio, reconciliação posterior
  e tratamento explícito de falha parcial.
- **Métricas:** o gerenciador usa exclusivamente a ação governada `link_click`
  para `Cliques no link`, CTR e CPC. O campo agregado `clicks` da Meta representa
  cliques de todos os tipos e não é usado nesses indicadores.
- **Navegação analítica:** nomes de campanhas, conjuntos e anúncios abrem o
  detalhe da campanha correspondente sem criar uma segunda superfície paralela.
## D-131 - Execução externa separada da aprovação

- Uma solicitação do gerenciador Meta exige aprovação humana e um segundo comando explícito de execução.
- O executor usa reivindicação atômica, idempotência, resposta sanitizada e releitura do estado na Graph API.
- O catálogo local só é atualizado depois que `status` retornado pela Meta coincide com o estado desejado.
- Falha ou divergência preserva a solicitação e a trilha de auditoria para nova tentativa controlada.

## D-132 — Ações em lote preservam aprovação por entidade

- **Data:** 04/08/2026.
- **Status:** implementada.
- **Decisão:** uma seleção múltipla de campanhas, conjuntos ou anúncios cria
  um agrupamento auditável e uma solicitação individual por entidade.
- **Guardrail:** o lote não executa alterações diretamente e não elimina
  aprovação humana, idempotência nem verificação posterior do estado na Meta.
## D-133 — Edições do gerenciador usam solicitação imutável antes de qualquer escrita externa

- Nome e orçamento são registrados como estado desejado em `meta_manager_action_requests`.
- A aprovação humana não executa automaticamente a edição.
- O executor externo de edição permanece bloqueado até validação específica por tipo de entidade e reconciliação posterior com a Meta.

## D-134 — Executor governado para nome e orçamento no gerenciador Meta

- **Data:** 05/08/2026.
- **Status:** implementada.
- **Decisão:** solicitações aprovadas de alteração de nome e orçamento diário
  podem ser executadas por proprietário ou administrador somente após um
  segundo comando humano explícito.
- **Guardrails:** a execução usa reivindicação atômica, idempotência, resposta
  sanitizada e releitura exata na Graph API. O catálogo local só é atualizado
  quando nome ou orçamento confirmado coincide com o estado desejado.
- **Orçamento:** campanhas e conjuntos preservam orçamento diário e total em
  unidade monetária mínima. Anúncios não aceitam orçamento direto.
- **Limite:** cada solicitação permanece sujeita ao teto monetário governado e
  à aprovação individual. A implementação não adiciona automação de orçamento.
- **Fora do escopo:** publicação de anúncio/campanha e execução automática
  continuam bloqueadas.

## D-135 — Filtros comerciais não são projetados artificialmente sobre a Meta

- **Data:** 05/08/2026.
- **Status:** implementada.
- **Decisão:** o dashboard oferece filtros governados por oferta, source/canal,
  mídia, método de pagamento, estado financeiro e primeira compra versus
  recorrência usando somente dados normalizados e comprovados do comércio.
- **Guardrail:** ao aplicar uma dimensão que existe apenas no pedido, as
  métricas Meta são marcadas como indisponíveis até existir uma reconciliação
  auditável para a mesma população. O sistema não mantém investimento global
  ao lado de receita comercial filtrada como se ambos tivessem o mesmo escopo.
- **Identidade:** recorrência é calculada por pessoa dentro do projeto e por
  pagamentos aprovados distintos observados em produção; não reduz a jornada
  a campanha, produto ou evento isolado.

## D-136 — Colunas do gerenciador usam somente insights Meta comprovados

- **Data:** 05/08/2026.
- **Status:** implementada.
- **Decisão:** alcance, impressões e investimento usam os campos normalizados
  de insights; cliques no link, visualizações da página de destino e checkouts
  iniciados usam exclusivamente os respectivos `action_type` recebidos no
  array `actions` da Meta.
- **Derivações:** frequência operacional, CPM, CTR e custos unitários são
  calculados somente quando numerador, denominador e cobertura cambial estão
  disponíveis. Denominador zero resulta em dado indisponível.
- **Limite de interpretação:** a soma de alcance diário pode repetir pessoas
  entre dias; por isso a frequência derivada é identificada como agregada e
  não substitui a frequência oficial única do período.
- **Guardrail:** o campo Meta `clicks` não substitui `link_click`; compras,
  receita e conversões comerciais não são inferidas a partir desses insights.
- **Persistência:** o servidor aceita exatamente o mesmo catálogo governado
  exibido no seletor de colunas. Campos desconhecidos e duplicados são
  descartados, sem remover silenciosamente métricas válidas selecionadas pelo
  usuário.

## D-137 — Dashboard Inteligente: visão por anúncio cruzando vendas e Meta

- **Data:** 29/10/2026.
- **Status:** implementada (v1 local).
- **Origem:** curso "Dashboard Inteligente" (Comunidade Growth Hackers/Cademi) e
  call "Dashboard com IA"; menu novo no grupo Visão geral, rota
  `/dashboard/dashboard-inteligente`. Os dashboards existentes não mudam.
- **Decisão:** a tela é uma VISÃO de leitura que cruza vendas em produção
  (Lastlink, mesma base financeira do Resumo executivo) com insights diários da
  Meta pelo ID exato do anúncio. NÃO altera o modelo de atribuição do produto
  (jornada multi-toque preservada): é uma régua adicional, last click por
  anúncio, restrita a esta tela.
- **Chave de cruzamento:** `utm_content` da primeira atribuição registrada do
  pedido (`order_attributions`), extraído por `extractAdId`
  (`apps/web/lib/dashboard-inteligente.ts`): ID numérico de 5 a 25 dígitos,
  aceito limpo ou como último trecho válido de pacote composto. Sem ID válido,
  a venda entra nos totais e na linha "Orgânico / sem anúncio" da tabela.
- **Regiões:** a Lastlink não envia cidade/UF do comprador (verificado em
  1.000 payloads reais: comprador traz nome, e-mail, telefone e documento).
  A UF exibida no mapa é ESTIMADA pelo DDD do telefone do comprador
  (`dddToUf`), e a tela rotula a estimativa. Venda sem telefone fica fora do
  mapa e é contada na nota do bloco.
- **Guardrails:** cliques no link vêm só do `action_type` `link_click` do
  array `actions` (D-136); métrica derivada com denominador zero é exibida
  como indisponível ("—"), nunca zero fabricado; escopo sempre `production`
  e projeto acessível ao usuário, como nas demais telas.

## D-138 — Blocos do Dashboard Inteligente como widgets do Meus dashboards

- **Data:** 30/10/2026.
- **Status:** implementada (v1 local).
- **Origem:** pedido do Fábio. O Meus dashboards (`/dashboard-v2`) já é a tela
  mais completa do painel; os blocos exclusivos do Dashboard Inteligente
  passam a existir lá como widgets do layout personalizável.
- **Decisão:** três novos tipos de widget no catálogo do v2: `region_sales`
  (mapa do Brasil + ranking por UF), `ad_performance` (tabela por anúncio) e
  `recent_sales` (últimas vendas aprovadas). Eles entram pela biblioteca do
  modo "Personalizar layout": podem ser incluídos, removidos, duplicados,
  movidos e salvos em templates, como os demais. O `allowedKinds` do servidor
  (`dashboard-v2/actions.ts`) foi liberado pros três tipos. A página
  standalone `/dashboard/dashboard-inteligente` (D-137) permanece como a
  visão completa e dedicada do cruzamento.
- **Dados:** as consultas dos blocos seguem as convenções do v2: intervalo de
  datas dos filtros da tela, base de receita selecionada (comissão do
  produtor ou valor total), gasto convertido (`spend_base`, somente linhas
  `converted`/`not_required`) e reuso de `extractAdId`/`dddToUf` da lib do
  Dashboard Inteligente. O filtro de produtos se aplica às vendas; o de
  conta, ao gasto. Os filtros comerciais avançados (origem, mídia, método e
  estado de pagamento, perfil do comprador) ainda não se aplicam aos três
  blocos.
