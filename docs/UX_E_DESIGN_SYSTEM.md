# UX e design system

## Objetivo

Transformar dados complexos em decisões claras para usuários não técnicos.

## Navegação proposta

- Visão geral
- Campanhas
- Central de Criativos
- Funis
  - Perpétuo
  - Lançamentos
  - Jornada híbrida
- Pessoas e jornadas
- Produtos e ascensão
- Experimentos
- Relatórios e alertas
- Assistente de IA
- Integrações
- Qualidade dos dados
- Configurações

### Configuração da Lastlink

A área de Integrações deverá oferecer uma lista de produtos/endpoints da
Lastlink. Cada item mostra nome do produto, estado, URL do webhook, último evento
e ações permitidas.

O card diferencia o rótulo interno da conexão do nome do produto. Para conexões
antigas sem produto cadastrado, mostra os nomes comprovados nos eventos
normalizados. Quando cadastro e evento estiverem disponíveis, ambos são
exibidos para permitir conferência de divergências.

Produtos oriundos apenas de eventos de teste não aparecem no card operacional.
O resumo de saúde mostra separadamente volume de produção, volume de testes,
backlog, falhas e quarentena. “Atrasada” só será exibido depois da aprovação de
uma janela esperada por conexão; até lá, a interface apresenta o instante do
último evento sem inferir atraso.

O formulário de inclusão solicita rótulo, produto e token gerado pela Lastlink.
O token é entrada mascarada, pode ser colado e testado, mas não é revelado
novamente depois de salvo. Rotação e revogação exigem confirmação e trilha de
auditoria. A tela inclui estados de carregamento, vazio, erro, falta de permissão
e teste de conexão malsucedido.

## Padrões

- Cards com comparação e contexto, não números isolados.
- Filtros globais de projeto, período, produto e origem.
- Tabelas com colunas configuráveis e exportação controlada.
- Gráficos com definição da métrica acessível.
- Linha do tempo para a jornada individual.
- Funil para perdas entre etapas.
- Caminhos/Sankey apenas quando facilitar análise de ascensão.

## Tokens legados implementados

Os tokens abaixo consolidam os valores ainda aplicados em
`apps/web/app/styles.css`. Eles passam a ser considerados legados e serão
substituídos progressivamente pela direção visual aprovada em 27/07/2026:

| Papel | Valor |
|---|---|
| Fundo principal | `#07100d` |
| Fundo de entrada | `#08130f` |
| Superfície lateral | `#091510` |
| Superfície de card | `#0a1712` |
| Superfície elevada | `#0c1b15` |
| Texto principal | `#eefcf5` / `#f2fff8` |
| Texto secundário | `#b9d2c6` |
| Texto discreto | `#6e9080` / `#87a99a` |
| Ação e identidade | `#65e5aa` |
| Estado saudável | `#52df9d` |
| Tipografia | `Inter`, com fallback `ui-sans-serif`, `system-ui` |
| Raio de card | `0.9rem` |
| Raio de controle | `0.65rem` a `0.75rem` |
| Conteúdo máximo | `92rem` |
| Lateral desktop | `15.5rem` |
| Breakpoint mobile | `760px` |

Vermelho e âmbar permanecem reservados a falha, reversão e atenção. Verde não
deve ser usado para comunicar erro, ação destrutiva ou dado incompleto. Depois
da migração, será reservado a sucesso, crescimento e estados saudáveis,
deixando de ser a cor principal da marca.

## Direção visual de referência aprovada

A interface adotará como referência dominante a aplicação demonstrada no vídeo
analisado em
[`ANALISE_REFERENCIA_VIDEO_2026-07-27.md`](ANALISE_REFERENCIA_VIDEO_2026-07-27.md).
A meta de 98% representa proximidade perceptiva e funcional nas telas
equivalentes: densidade, hierarquia, navegação, composição, padrões de interação
e fluidez devem ser reconhecivelmente equivalentes.

Não fazem parte dessa meta o nome, logotipo, código, textos, ilustrações,
fotografias, ícones proprietários ou outros ativos de terceiros. O Funil
Metrics terá implementação e componentes próprios, mantendo as regras de
métrica, jornada, segurança, auditoria e acessibilidade do projeto.

### Paleta-alvo

Os valores finais serão aferidos em protótipo visual e contraste, usando como
base:

| Papel | Direção inicial |
|---|---|
| Fundo principal | azul-preto profundo, próximo de `#080A12` |
| Fundo secundário | azul-marinho muito escuro, próximo de `#0D1020` |
| Superfície de card | `#111526` a `#171B2D` |
| Superfície elevada | `#1A1F35` |
| Borda discreta | violeta acinzentado com baixa opacidade |
| Texto principal | branco frio, próximo de `#F4F3FA` |
| Texto secundário | cinza-lilás, próximo de `#A6A3B8` |
| Ação principal | violeta elétrico, próximo de `#8B2CF5` |
| Ação em destaque | gradiente violeta, apenas quando funcional |
| Estado saudável | verde |
| Atenção | âmbar |
| Erro ou queda | vermelho |

Esses valores são tokens de migração, não licença para depender somente de cor.
Contraste, texto, ícone e estado devem continuar acessíveis.

### Composição-alvo

- Navegação lateral estreita, escura e recolhível.
- A lateral expõe no máximo seis módulos principais. Funções, relatórios e
  configurações relacionadas aparecem como itens internos do módulo aberto.
- Somente o módulo atual abre automaticamente; os demais permanecem compactos
  para evitar uma lista única e extensa de rotas.
- Barra superior compacta com busca, projeto, período e ações globais.
- Títulos menores em telas analíticas densas.
- Cards com raio discreto, borda suave e baixa elevação.
- Violeta concentrado em seleção, ação primária, séries e destaques.
- Tabelas densas com cabeçalho fixo, colunas configuráveis e rolagem controlada.
- Filtros em linha e painéis laterais para configurações avançadas.
- Assistente contextual em painel lateral sem cobrir a análise principal.
- Gráficos escuros com hierarquia de séries e tooltips legíveis.
- Mapas de funil em canvas com nós, conexões e indicadores compactos.

### Critério de paridade visual

Cada tela migrada será comparada lado a lado com a referência nas mesmas
dimensões. A revisão considera:

1. estrutura e proporção;
2. densidade e espaçamento;
3. tipografia e hierarquia;
4. paleta, bordas e superfícies;
5. estados e interações;
6. responsividade;
7. acessibilidade;
8. conteúdo e métricas reais do Funil Metrics.

A porcentagem não será apresentada como medição científica. O aceite de 98% é
uma meta de equivalência percebida, comprovada por checklist e revisão visual,
sem autorizar cópia de ativos protegidos.

## Componentes canônicos

- `app-layout`, `app-sidebar`, `app-topbar` e `dashboard-main`: estrutura.
- `dashboard-titlebar`: contexto, título, descrição e ação/período.
- `kpi-card`: rótulo, valor observado e contexto.
- `dashboard-card`: conteúdo analítico ou operacional.
- `notice-success` e `notice-error`: retorno de ação.
- `compact-empty`, `loading-state` e `permission-state`: estados obrigatórios.
- `period-filter` e `inline-filter-form`: recorte da consulta.
- `sales-table` e `table-scroll`: tabelas responsivas.

Os wireframes oficiais e critérios de aceite estão em
[`WIREFRAMES.md`](WIREFRAMES.md).

## Estados obrigatórios

- Carregando.
- Sem dados.
- Sem permissão.
- Integração atrasada.
- Erro recuperável.
- Dado parcial.
- Filtro sem resultado.

## Biblioteca de criativos

A biblioteca oferece busca por nome, filtros combináveis de status, tipo e
pasta, paginação e limpeza explícita. Filtros sem resultado exibem estado vazio
sem sugerir que os arquivos foram removidos. Os cards representam a versão
atual; o detalhe preserva e apresenta o histórico completo.

### Visão da biblioteca

Estado implementado da fundação: a rota `/dashboard/criativos` apresenta
contadores reais, biblioteca vazia, permissão do usuário e sequência de
prontidão. O botão de conexão permanece desabilitado enquanto OAuth, R2 e
antimalware não estiverem configurados; a interface não usa arquivos ou
métricas simulados para aparentar uma integração inexistente.

Card deve exibir:

- Prévia de imagem, thumbnail ou reprodução de vídeo.
- Nome e versão atual.
- Projeto, marca, produto e pasta de origem.
- Status.
- Tags manuais e automáticas.
- Estado da sincronização e análise.
- Investimento, resultado, LTV e fadiga quando houver publicação.

Na implementação inicial, cards reais usam a versão atual e exibem imagem ou
vídeo por rota autenticada. Documentos recebem placeholder identificado até a
extração ou renderização correspondente. Se o armazenamento privado estiver
indisponível, o card preserva nome, versão, pasta, MIME type, tamanho e status,
sem simular uma prévia.

Filtros:

- Projeto, marca e produto.
- Pasta do Drive.
- Tipo de arquivo.
- Status.
- Tag.
- Campanha, anúncio e público.
- Aprovador.
- Data de importação, alteração ou publicação.

### Detalhe do criativo

- Ativos e versões.
- Origem e caminho conhecido no Drive.
- Histórico de sincronização.
- Copy, headline, CTA, destino e observações.
- Transcrição e texto extraído.
- Gancho, promessa, mecanismo, prova, objeções e estrutura.
- Tags e análise de IA com confiança.
- Aprovações e rejeições.
- Públicos, campanhas, anúncios, investimento, receita, LTV e fadiga.
- Linha do tempo de mudanças e publicações.

Resultados de IA são exibidos em blocos separados: transcrição e texto extraído
podem ser expandidos; análise mostra gancho, promessa, mecanismo, CTA, modelo,
versão do prompt e confiança. Evidências técnicas ficam recolhidas por padrão.
Toda análise informa explicitamente que não equivale a aprovação humana.

Estado implementado inicial: a rota individual do criativo apresenta a versão
atual, prévia privada quando disponível, arquivo e pasta de origem, tipo,
tamanho, status no Drive, resultado antimalware, hash abreviado, todas as
versões imutáveis e eventos de importação/versionamento. O hash completo
permanece no banco; a interface usa forma abreviada para conferência sem poluir
a leitura.

### Fluxo de importação

1. Conectar Google Drive por OAuth.
2. Selecionar organização e projeto.
3. Escolher uma ou mais pastas autorizadas.
4. Conferir inventário, formatos e tamanho.
5. Iniciar importação.
6. Acompanhar progresso, ignorados, erros e retentativas.

O passo 3 usa o seletor oficial do Google, aceita múltiplas pastas e informa
explicitamente que autorizar uma pasta não inicia a importação. A tela lista a
conta conectada, as pastas já autorizadas, inclusão de subpastas e o estado de
cada autorização. Sem configuração do Picker, sem papel administrativo ou com
falha ao renovar a credencial, a ação fica bloqueada com motivo visível.

### Fluxo de aprovação e publicação

1. Conferir mídia, versão, copy e análise.
2. Aprovar ou rejeitar com comentário.
3. Selecionar conta, campanha, público, destino e orçamento.
4. Gerar prévia.
5. Revisar diferenças e permissões.
6. Aprovar a ação externa.
7. Publicar e mostrar IDs/resultado retornados.

Aprovar o criativo não aprova automaticamente uma configuração de publicação.

### Status

- Novo.
- Importado.
- Em análise.
- Aguardando aprovação.
- Aprovado.
- Pronto para publicar.
- Publicado.
- Pausado.
- Vencedor.
- Em fadiga.
- Arquivado.

Status operacional, status editorial e classificação de desempenho devem ser
exibidos sem ocultar o histórico. “Vencedor” e “em fadiga” dependem de regra,
janela e evidência acessíveis.

### Estados específicos

- Pasta vazia.
- Pasta sem permissão.
- Permissão removida.
- Arquivo ausente ou removido na origem.
- Formato inválido.
- Tamanho ou codec incompatível.
- Sincronização em andamento, atrasada ou com falha.
- Importação parcial.
- Transcrição ou análise indisponível.
- Versão nova aguardando conferência.
- Publicação bloqueada por falta de aprovação ou permissão.

## Acessibilidade e responsividade

- Contraste suficiente.
- Navegação por teclado.
- Texto alternativo.
- Não depender apenas de cor.
- Tabelas adaptadas ao celular.
- Informações críticas legíveis sem hover.

## Processo de design

1. Mapa de telas.
2. Wireframes.
3. Três direções visuais comparáveis.
4. Escolha da direção.
5. Tokens e componentes.
6. Protótipo com dados realistas.
7. Validação responsiva.

## Direção visual aprovada para dashboards

O painel adota uma interface operacional escura, azulada, violeta, densa e
escaneável, tendo a referência aprovada como direção dominante de experiência.
Marca, implementação e ativos continuam próprios.

- Navegação lateral persistente no desktop e simplificada em telas menores.
- Barra superior para contexto do projeto, ambiente e ações da sessão.
- Primeira dobra com título, período e quatro indicadores prioritários.
- Séries temporais e análises ocupam maior área que controles secundários.
- Violeta passa a ser a cor de identidade e ação principal. Verde comunica
  sucesso ou crescimento; vermelho e âmbar são reservados a falhas, reversões e
  atenção.
- Funcionalidades sem fonte conectada devem aparecer como indisponíveis ou
  futuras, nunca com números simulados.
- Todo indicador informa fonte, período, moeda, fuso e regra aplicável.
- Cards devem apresentar hierarquia consistente: rótulo, valor, contexto e ação.
- Estados de carregamento usam skeleton; vazio explica a ausência; erros permitem
  nova tentativa; falta de permissão não revela dados.

### Visualização e edição de dashboards

- Na aba `Templates` do editor, a pessoa pode nomear e salvar a composição atual como template reutilizável do projeto.
- Aplicar um template altera somente o rascunho local. O dashboard ativo só muda após a ação explícita `Salvar layout`.
- Templates exibem nome, quantidade de widgets e data de criação, incluindo estados vazio, sucesso e erro.

- O modo `Visualizar` apresenta a última versão publicada e não oferece
  controles capazes de alterar layout, widgets ou filtros.
- O modo `Editar` é permitido somente a papéis autorizados e trabalha sobre o
  rascunho atual, identificado explicitamente na interface.
- Período, produto, conta de anúncios e campanha fazem parte da versão do
  dashboard. Publicar congela também esses filtros; alterar o rascunho não muda
  silenciosamente a visão publicada.
- A campanha selecionada deve pertencer à conta de anúncios escolhida. Opções
  sempre respeitam organização e projeto atuais.
- Dashboards sem versão publicada exibem uma prévia identificada do rascunho,
  sem apresentá-la como conteúdo publicado.

### Visões planejadas

- Executivo: receita, vendas, ticket, reversões e evolução diária.
- Funil: etapas, taxas e volumes, com denominadores visíveis.
- Campanhas e criativos: investimento, conversão, receita, fadiga e histórico.
- Jornada: pessoas, eventos, produtos e ascensão ao longo do tempo.
- Qualidade: integrações, latência, falhas, cobertura de identidade e UTMs.
### Estados de validação das integrações

Integrações testáveis apresentam `Pendente`, `Salva · não validada`, `Validada`
ou `Inválida`. Quando disponível, a interface mostra somente a data do último
sucesso ou da última falha. Mensagens nunca exibem host interno, porta, bucket,
token, segredo, stack ou resposta bruta do provedor.

Ações dependentes não desaparecem sem explicação: o contexto do lote mostra o
controle bloqueado, o motivo sanitizado e, para perfis autorizados, um caminho
direto até a configuração necessária.

### Instruções de domínio personalizado

A tela diferencia claramente cadastro, TXT de propriedade, provisionamento,
destino de tráfego, TLS e ativação. Enquanto a hospedagem não fornecer um
destino operacional, o painel orienta a publicar somente o TXT e proíbe sugerir
um CNAME fixo. Nome e valor devem ser exibidos em formato copiável por domínio.
## Domínios personalizados

- A tela deve distinguir visualmente o TXT de propriedade do Funil Metrics dos
  registros de roteamento e validação exigidos pela hospedagem.
- Hostnames, tokens e destinos DNS devem quebrar linha sem provocar rolagem
  horizontal da página.
- Ações devem aparecer conforme o estado: verificar propriedade, provisionar,
  verificar ativação, desativar ou restaurar.
- O estado ativo só pode ser exibido depois de CNAME, validação da hospedagem e
  HTTPS funcionais.

## Operação de mídia e análise

- `Gerenciador de anúncios` é a superfície operacional hierárquica para contas,
  campanhas, conjuntos e anúncios; `Campanhas` é a superfície analítica.
- A troca entre as superfícies preserva projeto, conta e período sempre que
  esses filtros forem compatíveis.
- Controles de status exibidos enquanto a integração está em leitura são
  explicitamente não interativos. Uma mudança deve começar em `Preparar ação`
  e seguir prévia, aprovação, auditoria e reconciliação.
- As duas superfícies devem oferecer carregamento, vazio, erro e falta de
  permissão sem confundir ausência de métricas com ausência de entidades.

## Seletor global de projeto

- O seletor compacto aparece na lateral, abaixo da marca e antes da navegação.
- A área principal não repete um seletor nem apresenta o botão grande `Trocar`;
  pode mostrar somente breadcrumb ou contexto textual discreto.
- Selecionar um item inicia a troca imediatamente, mantém a rota e os parâmetros
  atuais, indica carregamento e fecha a lista.
- A lista contém somente projetos permitidos, identifica a seleção atual,
  oferece busca quando houver mais de cinco opções e liga à gestão de projetos.
- Sem projeto e sem produto são estados distintos. O primeiro bloqueia dados e
  orienta criação ou concessão de acesso; o segundo mantém o projeto navegável.
- No celular, o seletor permanece dentro da navegação lateral compacta e abre a
  lista acima da barra para não sair da viewport.
- Teclado, foco, Escape, clique externo e semântica de listbox fazem parte do
  comportamento obrigatório.
# Dashboard personalizável premium — adendo de 2026-08-01

O canvas analítico usa uma grade de doze colunas no desktop e uma coluna no
celular. No modo de personalização, widgets exibem alça, configuração,
duplicação, exclusão, redimensionamento e comandos de mover para cima ou para
baixo. No modo de visualização, esses controles são removidos.

Gráficos usam Recharts a partir de séries governadas. Tooltips e estados
textuais complementam a representação visual. O editor usa react-grid-layout,
com salvamento explícito, desfazer/refazer local e posições validadas no
servidor. A paleta segue o azul-preto profundo e concentra violeta em ação,
seleção e séries.

No Dashboard V2, KPIs, gráfico financeiro e blocos analíticos pertencem à
mesma grade. Ao iniciar a personalização, uma biblioteca temporária ocupa a
esquerda da área principal, sem criar navegação permanente. Ela oferece busca,
abas `Widgets` e `Templates`, categorias e arraste para a posição desejada.
Placeholder, colisão e reflow são exibidos durante o gesto. Cancelar restaura o
snapshot anterior; salvar envia somente o rascunho validado e auditável.
O diálogo de configuração aceita somente opções governadas: título,
granularidade, comparação, legenda, tooltip e, no funil, etapas selecionadas de
uma allowlist de métricas. O funil nunca aceita SQL ou JavaScript livre e
apresenta `Dado indisponível` quando uma etapa não tem cobertura comprovada.
# Estados de dados financeiros multimoeda

- Valores consolidados mostram a moeda-base do projeto e tooltip com cobertura,
  regra, fonte e data efetiva quando aplicável.
- Se houver linha bloqueada, investimento, lucro, ROAS, CPA e CAC apresentam
  estado parcial/indisponível; não exibem zero nem misturam moedas.
- Integrações lista moeda e estado de confirmação por conta. Somente owner ou
  administrator pode corrigi-la; a ação explica que haverá reprocessamento.
- Alertas distinguem `moeda não confirmada`, `cotação pendente`, `não suportada`
  e `erro de conversão`, sempre com carregamento, vazio, erro e permissão.
### Configuração avançada dos widgets do dashboard

- Cada instância preserva título, descrição, granularidade, comparação, legenda, tooltip, cores e, quando aplicável, tipo de gráfico, ordenação e limite.
- Cópias do mesmo widget são independentes: alterar uma instância não modifica as demais.
- Comparações usam exclusivamente o período anterior equivalente e são omitidas quando a cobertura governada não permite cálculo confiável.
- O servidor valida listas permitidas, limites e cores; não são aceitos SQL ou JavaScript livres.
- A biblioteca inclui receita líquida, ticket médio, CPA e saúde financeira. Receita líquida preserva reversões observadas; ticket e CPA exibem seus denominadores; saúde financeira não simula pendências quando essa cobertura não existe.
- Legenda e tooltip aparecem como opções somente em visualizações gráficas que efetivamente as utilizam, não em cards numéricos.
