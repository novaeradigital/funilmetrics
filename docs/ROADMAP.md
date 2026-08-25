# Roadmap

Status: proposta inicial. Prioridades podem mudar após validar payloads e necessidades operacionais.

## Fase 0 — Fundação e descoberta

- [x] Visão inicial e documentação.
- [ ] Validar payloads reais da Lastlink.
- [ ] Mapear APIs/webhooks das demais fontes.
- [ ] Aprovar regras de identidade e atribuição.
- [x] Criar wireframes e design system.
- [ ] Validar escopos OAuth, limites e exportações do Google Drive.
- [x] Aprovar formatos, tamanhos e armazenamento próprio de mídia.
- [ ] Aprovar retenção e exclusão da cópia própria de mídia.
- [x] Montar estrutura inicial do repositório e qualidade local.
- [ ] Configurar ambientes externos de desenvolvimento, homologação e produção.
  - [x] Supabase de desenvolvimento.
  - [ ] Railway, R2, homologação e produção.
  - [x] API, worker e painel web iniciais publicados na Railway.

## Fase 1 — MVP de dados e jornada

- [x] Organizações, projetos, usuários e permissões.
  - [x] Criação de projeto, seletor persistente e isolamento explícito da visão
    geral, integrações, Lastlink, Central de Criativos, vendas, produtos,
    funil, clientes e atribuição.
  - [x] Edição auditável de nome, moeda e fuso horário do projeto ativo.
  - [x] Schema físico inicial e migração.
  - [x] RLS inicial conservadora.
  - [x] Supabase Auth, sessão e bootstrap do primeiro proprietário.
  - [x] Convites, administração de membros, serviços e endpoints.
    - [x] Convite oficial por e-mail, papéis organizacionais, ativação no
      primeiro acesso e auditoria.
    - [x] Alteração e remoção de acesso, reenvio de convite e escopo por projeto.
      - [x] Alteração de papel e remoção confirmada com proteção do proprietário
        e trilha de auditoria.
      - [x] Escopo explícito por projeto, incluindo acesso total ou lista
        restrita.
      - [x] Reenvio manual e auditável das instruções de convite, sem
        compartilhamento de senha.
- [x] Ingestão idempotente e armazenamento bruto.
  - [x] Recepção autenticada, preservação do corpo e deduplicação da Lastlink.
  - [x] Quarentena de JSON inválido, evento desconhecido e payload parcial.
  - [x] Worker contínuo, lotes concorrentes, reprocessamento e normalização
    Lastlink em eventos internos.
- [x] Lastlink.
  - [x] Endpoint e contratos dos oito eventos confirmados.
  - [x] Provisionamento técnico da conexão e publicação HTTPS do endpoint.
  - [x] Tela administrativa para cadastrar produtos/endpoints e seus tokens,
    testar, rotacionar e revogar conexões.
    - [x] Listagem e cadastro inicial com token armazenado somente como hash.
    - [x] Validação de token, rotação com transição e revogação confirmada.
    - [x] Indicadores detalhados de saúde e alertas: janela de 24 horas,
      normalização, duplicidade, parcialidade, backlog e ocorrências abertas.
  - [x] Pedidos, pagamentos, estornos e identidade normalizados.
- [x] Meta Ads em modo leitura.
  - [x] OAuth por projeto e credencial de usuário do sistema, sem compartilhar
    senha.
  - [x] Seleção explícita de contas autorizadas, catálogo de campanhas e
    conjuntos, revogação e auditoria.
  - [x] Validação do projeto ativo e do papel administrativo nas rotas de
    conexão e seleção de contas.
  - [x] Sincronização idempotente de anúncios, criativos e insights diários dos
    últimos 30 dias, executada somente sob solicitação administrativa.
  - [x] Schema de agenda e histórico de execuções automáticas por conexão,
    desativado por padrão.
  - [x] Agendador concorrente no worker para criar execuções idempotentes,
    mantendo todas as agendas desativadas.
  - [x] Executor Meta paginado no worker com backoff, limite de tentativas e
    atualização idempotente do catálogo.
  - [x] Controle administrativo auditado para ativar, desativar e escolher o
    intervalo da agenda por conexão.
  - [x] Execução manual enfileirada, auditada e protegida contra concorrência por
    conexão.
  - [x] Histórico das últimas execuções Meta por conexão, com origem, tentativas,
    volumes e erro sanitizado.
  - [x] Monitoramento de agenda atrasada, fila parada e falha terminal da
    sincronização Meta no painel de qualidade.
  - [x] Resumo Meta na visão geral do projeto com estrutura, investimento por
    moeda, última métrica e estado da fila.
- [x] Pessoas e resolução inicial de identidade da Lastlink.
- [x] Pedidos, pagamentos e reembolsos da Lastlink.
- [x] UTMs da Lastlink preservadas no bruto e normalizadas por pedido.
- [x] Jornada individual e ascensão.
  - [x] Lista inicial de pessoas, receita líquida e pedidos aprovados.
  - [x] Linha do tempo comercial individual com eventos, produtos e UTMs.
  - [x] Hierarquia de produtos e classificação auditável de ascensão.
- [x] Dashboard executivo e de campanhas.
  - [x] Resumo financeiro inicial da Lastlink com escopo de produção.
  - [x] Filtros móveis de 7, 30, 90 dias e todo o histórico.
  - [x] Visão detalhada de pedidos e produtos, sem atribuição indevida de receita
    por item.
  - [x] Funil inicial por volumes de eventos comprovados da Lastlink, sem taxas
    sequenciais não demonstradas.
  - [x] Análise de origem registrada por fonte, mídia e campanha UTM, com
    cobertura e receita observada.
  - [x] Painel Meta por campanha com investimento, impressões, cliques, CTR,
    CPC e estrutura sincronizada, sempre em modo de leitura.
  - [x] Comparação com período anterior equivalente e série diária no consolidado
    Meta e no detalhe de cada campanha.
  - [x] Busca e filtros de conta e status aplicados de forma consistente aos
    cartões, série diária e tabela de campanhas Meta.
  - [x] Exportação CSV auditada respeitando os filtros ativos do painel Meta.
  - [x] Exportação CSV auditada no detalhe da campanha, preservando a janela
    selecionada na navegação.
  - [x] Ordenação por métricas observadas e indicação factual da última data
    disponível em cada campanha.
  - [x] Paginação da tabela de campanhas com totais e filtros preservados.
  - [x] Paginação dos anúncios no detalhe da campanha sem alterar os totais do
    período.
  - [x] Resumo da última sincronização Meta por conexão, com volumes importados,
    janela e versão da Graph API.
  - [x] Ranking de criativos Meta e ligação manual auditável com a versão
    correspondente da biblioteca própria.
  - [x] Visão de produtos por presença em pedidos, aprovações, pessoas e
    reversões, sem rateio artificial de receita.
  - [x] Filtro de produto, série temporal diária e comparação por presença,
    pedidos, aprovações e pessoas.
  - Alocação financeira por item permanece condicionada a uma fonte que forneça
    valor confiável por produto; não bloqueia a entrega atual e não será
    inferida a partir do valor total do pedido.
- [x] Saúde inicial das integrações: recepção, normalização, duplicidade,
  backlog, falhas e quarentena.
- [ ] Fundação de armazenamento de objetos, jobs de mídia e auditoria de ações.
  - [x] Schema físico de Drive, ativos, versões e jobs idempotentes com RLS.
  - [x] Adaptador R2 com configuração validada, chaves imutáveis, quarentena e
    promoção permitida somente para resultado limpo.
  - [x] Cliente ClamAV por streaming com timeout, limite de bytes e resultados
    sanitizados.
  - [ ] Credenciais R2 e serviço ClamAV isolado em produção.

## Fase 2 — Funis e criativos

- [ ] Convergência visual com a referência aprovada de 27/07/2026.
  - [x] Migrar tokens do verde dominante para azul-preto e violeta.
  - [ ] Criar shell compacto com lateral recolhível e barra global de contexto.
    - [x] Navegação lateral canônica, densa, agrupada, recolhível e com
      preferência persistida no navegador.
    - [x] Reduzir a lateral a seis módulos principais com funções internas
      reveladas somente no contexto ativo.
    - [x] Shell canônico aplicado à Visão Geral, Campanhas, Criativos,
      Integrações, Vendas, Clientes, Produtos, Qualidade, Domínios, Projetos,
      Funil, Atribuição, Segmentos, Scoring, Simulador, Assistente, Relatórios,
      Alertas, Auditoria, Debriefing, Equipe, Testes A/B, LTV, Persona e
      Tracking.
    - [x] Substituir as barras laterais legadas restantes e habilitar o estado
      canônico nas telas secundárias e de detalhe.
    - [x] Criar barra global canônica e fixa para projeto, estado operacional,
      ações contextuais e encerramento da sessão.
    - [ ] Migrar para a barra global canônica os cabeçalhos analíticos que ainda
      possuem filtros e ações específicas embutidos.
      - [x] Período global aplicado a Vendas, Clientes, Produtos e Atribuição,
        preservando filtros ativos e removendo controles duplicados do corpo.
      - [x] Período, estado e ações globais aplicados a Qualidade, Alertas,
        Relatórios e LTV, incluindo sinalização de atenção e exportações.
  - [ ] Padronizar período, filtros persistentes, painel lateral e estados.
    - [x] Mover o período da Visão Geral para a barra global e reduzir a
      primeira dobra ao contexto e aos indicadores operacionais.
  - [ ] Criar componentes canônicos de tabela analítica, cards de criativos,
    canvas de funil e assistente contextual.
    - [x] Reorganizar o gerenciador de campanhas para priorizar filtros, KPIs e
      tabela, mantendo recomendações e série diária em painéis expansíveis.
    - [x] Reorganizar a Central de Criativos para priorizar biblioteca e filtros,
      mantendo Drive, inventários e prontidão em configuração expansível.
    - [x] Migrar o funil observado para canvas compacto com nós conectados,
      volumes reais e limitação metodológica explícita, sem inferir taxas entre
      eventos não comprovados.
    - [x] Reorganizar o Assistente como workspace contextual compacto, com
      perguntas governadas, período global, guardrail de somente leitura e
      caminho explícito para as evidências.
  - [ ] Validar lado a lado desktop e mobile conforme checklist de paridade
    perceptiva, acessibilidade e conteúdo real.
- [x] Funis perpétuos v1 com definição, etapas, fontes explícitas e volumes
  observados.
- [x] Lançamentos v1 com janela obrigatória, etapas e volumes observados.
- [x] Jornada híbrida v1 como classificação explícita de funil, sem classificar
  permanentemente a pessoa.
  - [x] Modelo e tela auditável de definições perpétuas, lançamento e híbridas,
    com janela e etapas governadas, sem inscrição automática de pessoas.
- [ ] Sendflow.
- [ ] Hotwebinar.
- [x] VSL/tracking próprio v1 com fonte por projeto, allowlist de origens, tag
  instalável, eventos idempotentes e coleta sem conteúdo de formulário.
- [ ] Central de Criativos — fase 1: importação manual de uma pasta do Drive.
  - [x] Fundação privada e tela inicial com estado vazio e prontidão real.
  - [x] Fundação OAuth web server com `drive.file`, estado assinado, token
      criptografado e auditoria.
    - [x] Google Picker e validação server-side para seleção explícita de
      múltiplas pastas.
    - [x] Inventário manual idempotente, paginado e recursivo dos metadados.
    - [x] Fluxo de confirmação, download em streaming, quarentena, ClamAV,
      promoção privada e versão imutável.
    - [x] Biblioteca real com versão atual e prévia autenticada de imagem e
      vídeo no armazenamento privado.
    - [x] Detalhe do criativo com origem, integridade, versões e auditoria.
    - [x] Metadados editoriais e tags manuais por versão, com auditoria.
    - [ ] Configuração operacional das credenciais Google, R2 e ClamAV no
      ambiente de produção.
- [x] Central de Criativos — fase 2: sincronização automática e versionamento.
  - [x] Agendamento persistente e idempotente por pasta autorizada.
  - [x] Detecção e classificação de alterações, movimentos e remoções.
  - [x] Controle de frequência e estado na interface.
- [x] Central de Criativos — fase 3: transcrição, extração, tags e análise por IA.
  - [x] Fundação de jobs, transcrições, extrações e análises versionadas.
  - [x] Executor OpenAI, transcrição, análise estruturada, tags e solicitação humana.
  - [x] Extração local e idempotente de TXT e documentos Google exportados
    como DOCX, sem chamada paga de IA.
  - [x] Registro automático de tokens usados por análise.
  - [x] Precificação por projeto versionada em BRL, custo medido e bloqueio
    automático quando o limite mensal estiver esgotado.
- [x] Biblioteca privada com busca, filtros, paginação, prévia autenticada e
  histórico próprio de versões.
- [x] Debriefing operacional por período com métricas observadas, origens,
  produtos e limitações explícitas.

## Fase 3 — Qualificação e experimentação

- [x] Pesquisa quantitativa inicial de persona com recorrência, reversões,
  produtos e origens agregadas, sem inferir atributos não coletados.
- [x] Lead scoring operacional explicável por recência, frequência, valor
  relativo e reversões, sem inferência de propensão.
- [x] Segmentos iniciais explicáveis de primeira compra, recorrência, atividade,
  inatividade e reversão, sem ativação externa.
- [ ] Domínios personalizados.
  - [x] Cadastro por projeto, validação segura de hostname e verificação de
    propriedade por TXT com auditoria.
  - [x] Solicitação e cancelamento idempotentes de provisionamento, sem
    alteração automática de DNS, hospedagem ou TLS.
  - [x] Desativação reversível com bloqueio imediato dos links e restauração
    obrigatoriamente anterior a uma nova ativação.
  - [x] Rotação auditável do código de propriedade sem registrar os valores
    anterior ou novo na trilha de auditoria.
  - [ ] Provisionamento operacional na hospedagem, certificado TLS e ativação
    somente após verificação externa.
- [x] Links inteligentes no domínio padrão com split ponderado, persistência,
  UTMs preservadas e exposições idempotentes.
- [x] Testes A/B.
  - [x] Distribuição observada por variante, indicação de amostra inicial e
    pausa ou reativação auditável, sem vencedor automático.
  - [x] Ligação idempotente entre exposição, pedido e receita líquida observada
    quando `sck` está disponível, sem sobrescrever atribuição existente.
  - [x] Taxa observada de visitantes com pedido e intervalo de Wilson de 95% por
    variante, sem declaração automática de vencedor.
- [x] Avaliação inicial por LTV líquido observado em 30, 90 e 365 dias, com
  marco explícito, coortes mensais e exclusão de janelas incompletas.
- [ ] Reports e alertas automáticos.
  - [x] Relatório financeiro diário na interface e exportação CSV auditada.
  - [x] Diagnósticos sob demanda com evidência, impacto e recomendação.
  - [x] Monitor persistente de falhas, quarentena e backlog parado, com abertura
    e resolução idempotentes.
  - [x] Alertas de agenda Drive atrasada e reconciliação Meta pendente.
  - [ ] Agendamento e entrega por canal externo.
  - [x] Agendamento diário ou semanal e snapshots imutáveis dentro do painel.
- [x] Central de Criativos — fase 4: conferência, revisão e aprovação humana.

## Fase 4 — Inteligência e operação

- [x] Consolidar o projeto selecionado como contexto global da aplicação.
  - [x] Mover o seletor compacto para a lateral e remover a troca da área
    principal.
  - [x] Persistir em cookie HTTP-only, validar acesso no servidor e impedir
    fallback silencioso de seleção sem permissão.
  - [x] Preservar rota e parâmetros durante a troca, com loading e suporte
    responsivo.
  - [x] Diferenciar ausência de projeto de ausência de produtos e manter produto
    como dimensão interna do projeto.
  - [x] Manter URLs atuais por compatibilidade e documentar a evolução opcional
    para rotas com projeto explícito.

- [x] Fundação de dashboards personalizáveis por projeto.
  - [x] Catálogo governado inicial de métricas e dimensões.
  - [x] Dashboard, versão imutável, widgets, layout, filtros e templates.
  - [x] Modos visualizar e editar, com rascunho, publicação e restauração.
    - [x] Editor inicial com reorganização, largura, salvamento em lote e
      publicação que deriva um novo rascunho.
    - [x] Edição de título, métrica e visualização, duplicação e remoção
      auditáveis restritas ao rascunho.
    - [x] Tamanhos semânticos pequeno, médio, grande e largura total.
    - [x] Restauração explícita de uma versão publicada para o rascunho atual.
    - [x] Filtros versionados por produto, conta de anúncios e campanha,
      aplicados às consultas financeiras e de mídia paga.
  - [x] Widgets iniciais de KPI, série, barras, rosca, funil, tabela e texto.
  - [x] Templates iniciais de Visão executiva, Mídia paga e Financeiro.
  - [x] Permissões, auditoria e estados de carregamento, vazio, erro e acesso.
  - [x] Criação assistida por IA com prévia e sem publicação automática.
  - [x] Expandir filtros globais governados para oferta, origem, mídia, forma
    de pagamento, estado financeiro e comprador novo ou recorrente.
  - [ ] Comparação completa de períodos com semântica por métrica, exportação e
    drill-down preservando filtros.
  - [ ] Biblioteca avançada de widgets operacionais, tabelas, rankings e estados
    de dado parcial, atrasado e em processamento.
- [x] Separar Gerenciador de Anúncios e análise de Campanhas.
  - [x] Tabela operacional hierárquica por conta, campanha, conjunto e anúncio.
  - [x] Conjuntos de colunas e filtros persistentes.
    - [x] Conjuntos de colunas persistentes por usuário, projeto e nível.
    - [x] Persistência dos filtros operacionais além da URL ativa.
    - [x] Colunas governadas de alcance, frequência agregada, CPM, cliques no
      link, CTR e CPC de link, visualizações da página de destino, custo por
      visualização, checkouts iniciados e custo por checkout.
  - [x] Modal seguro para preparar pausa, reativação e orçamento.
  - [x] Detalhe analítico de campanha acessível a partir de campanhas,
    conjuntos e anúncios.

- [x] Assistente inicial conectado a consultas governadas de receita, vendas,
  UTMs e campanhas, sem SQL livre ou ação externa.
- [x] Detecção inicial e informativa de anomalias de volume, com histórico
  mínimo, evidência e resolução idempotente.
- [x] Simulação matemática de orçamento com premissas explícitas, fórmulas
  visíveis e nenhuma escrita em plataformas externas.
- [x] Recomendações observadas de campanhas com regras determinísticas,
  evidência, volume mínimo e nenhuma escrita externa.
- [x] Aprovação humana de intenções de pausa ou orçamento com snapshot imutável,
  hash e auditoria, ainda sem execução externa.
- [x] Simulação idempotente e reconciliação do estado atual contra a ação
  aprovada, sem chamada de escrita à Meta.
- [ ] Pausa e alteração de orçamento.
- [ ] Central de Criativos — fase 5: publicação assistida na Meta Ads.
  - [x] Cofre de credencial Meta com allowlist de contas.
  - [x] Fundação de solicitação, snapshot, hash e aprovação da publicação.
  - [x] Validação server-side da credencial e leitura das contas autorizadas.
  - [x] Sincronização paginada de campanhas e conjuntos das contas autorizadas.
  - [x] Modelo de autorização separado para OAuth e usuário do sistema.
  - [x] Configuração do aplicativo OAuth separada da credencial operacional de
    usuário do sistema, sem exigir token, Business ID ou allowlist para iniciar
    o login do cliente.
  - [x] Fluxo OAuth Meta com callback seguro e identidade isolada.
  - [x] Seleção e confirmação explícita das contas acessíveis após OAuth.
  - [x] Múltiplas conexões Meta administráveis e revogáveis por projeto.
  - [x] Geração de prévia imutável na interface.
  - [x] Aprovação visual e imutável da prévia.
  - [x] Simulação idempotente e reconciliação de hash, ativo, conexão e
    hierarquia Meta, sem escrita externa.
  - [ ] Envio assistido após aprovação final explícita.
- [ ] Central de Criativos — fase 6: modelos de campanha e automações
  controladas.
- [ ] Criação assistida de anúncios usando versão aprovada do criativo.
- [ ] Políticas limitadas de automação.

## Critério para avançar

Uma fase não deve avançar por aparência de completude. Entradas precisam ser reconciliadas, métricas reproduzíveis e falhas observáveis.

Para a Central de Criativos:

- Fase 1 exige importação manual idempotente e cópia própria verificável.
  Limites operacionais de 1.000 arquivos e 20 GB por execução já são aplicados
  antes do download, sem importação parcial silenciosa.
- Fase 2 exige detecção de mudanças sem sobrescrever versões.
- Fase 3 exige resultados de IA versionados e conferíveis.
- Fase 4 exige papéis, estados e auditoria de aprovação.
- Fase 5 exige Meta em modo de escrita autorizado, prévia e aprovação da ação.
- Fase 6 só avança após volume, políticas, limites e mecanismo de interrupção.
# Entrega incremental do dashboard premium — 2026-08-01

- [x] Grade madura com arraste, colisão, redimensionamento, alternativa móvel e
  persistência das posições no rascunho.
- [x] Gráficos reutilizáveis de indicador, barras, linha, área e rosca ligados
  ao catálogo governado, com estados vazios e indisponíveis.
- [x] Histórico local de desfazer e refazer para movimento e tamanho.
- [x] Templates de Visão geral, Performance, Executivo, Vendas, Produtos,
  Aquisição, Financeiro, Qualidade e Em branco.
- [ ] Completar filtros múltiplos, comparação de períodos, biblioteca avançada,
  funil configurável e widgets analíticos de produto, origem, horário e estorno.
# Camada financeira multimoeda

- [x] Modelo aditivo de moeda original, moeda-base, taxa, fonte, regra e status.
- [x] Provedor PTAX BCB e processamento idempotente por projeto.
- [x] Bloqueio de agregados incompletos e indicador de cobertura no dashboard.
- [x] Correção manual auditada da moeda da conta e reprocessamento automático.
- [x] Alertas de moeda não confirmada e conversão bloqueada.
- [ ] Executar o plano de backfill somente após inventário, amostra e
  reconciliação descritos em `docs/planos/BACKFILL_CAMBIAL.md`.
- [ ] Adicionar provedores alternativos apenas com decisão e evidência de fonte.
