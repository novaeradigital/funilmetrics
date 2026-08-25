# Análise da referência em vídeo — 27/07/2026

Fonte analisada: `2026-07-27 09-27-48.mp4`  
Duração: 36 min 37 s  
Uso: referência funcional e de experiência para o Funil Metrics

## Método e limites

- O vídeo original não foi alterado nem copiado para a documentação.
- A gravação foi inspecionada integralmente por quadros distribuídos a cada dez
  segundos e por amostras mais próximas nas mudanças de tela.
- Somente capacidades visíveis foram tratadas como comprovadas.
- Comportamentos não demonstrados de ponta a ponta são identificados como
  inferência e precisam ser validados antes de virarem regra de negócio.
- A referência orienta capacidade, hierarquia e fluidez. Marca, textos, ícones,
  cores e composição exata não devem ser copiados.

## Resumo executivo

A referência reúne cinco experiências principais em uma única aplicação:

1. gerenciador de mídia paga com visão tabular altamente configurável;
2. mapa visual de funis com indicadores por etapa e período;
3. análise de criativos em cards, detalhe de mídia e análise assistida por IA;
4. visões especializadas para lançamentos, segmentação e testes A/B;
5. construtor de dashboards com widgets e assistente contextual.

O Funil Metrics já possui boa parte da fundação necessária: projetos isolados,
integrações, eventos, vendas, campanhas, atribuição, funis, criativos, IA,
segmentos, experimentos, relatórios e auditoria. A maior diferença não é a
quantidade de módulos, mas o nível de consolidação visual e a continuidade entre
eles. A referência permite partir de um indicador e avançar para campanha,
criativo, etapa do funil ou explicação da IA sem perder o período e os filtros.

## Capacidades comprovadas no vídeo

### 1. Gerenciador de anúncios

- Alternância entre plataformas de mídia e seleção de contas.
- Hierarquia por contas, campanhas, conjuntos e anúncios.
- Tabela com ativação visual e busca.
- Filtro por período.
- Personalização de colunas.
- Grupos de métricas salvos ou selecionáveis.
- Métricas de mídia, conversão, receita e retorno na mesma tabela.
- Indicadores de tendência de ROAS em diferentes janelas.
- Exploração do resultado sem sair do contexto da tabela.

### 2. Biblioteca de funis

- Catálogo de funis em cards.
- Acesso individual a cada funil.
- Filtro por intervalo de datas com atalhos temporais.
- Visualização em mapa horizontal.
- Etapas representadas como nós conectados.
- Indicadores dentro de cada etapa, incluindo tráfego, leads, vendas,
  faturamento e ticket médio quando aplicáveis.
- Detalhamento de tráfego por campanha, conjunto, anúncio e criativo.
- Comparação do desempenho do mesmo funil em períodos diferentes.

### 3. Análise de criativos

- Biblioteca em cards com imagem ou vídeo.
- Pesquisa, ordenação, filtros e agrupamentos.
- Métricas visíveis diretamente no card.
- Destaque visual para indicadores positivos e negativos.
- Detalhe do criativo com reprodução de vídeo.
- Métricas de mídia e conversão junto da mídia.
- Classificação estrutural do criativo em campos.
- Transcrição disponível no detalhe.
- Assistente de IA contextual à tela.
- Comparação de vários criativos e geração de análise textual.
- Recomendações de padrões vencedores, hipóteses e variações.

### 4. Lançamentos

- Catálogo separado de lançamentos.
- Dashboard específico de lançamento.
- Navegação por captação, eventos, outras etapas, debriefing, relatórios e
  configurações.
- KPIs de faturamento, leads e ROAS.
- Série temporal com investimento e retorno.
- Distribuição por produtos.
- Indicador de qualidade.
- Ranking de origens.
- Funil visual da operação.
- Visão de principais criativos.

### 5. Modelo, influência e segmentos

- Mapa de influência com fatores negativos e positivos.
- Listas de detratores e impulsionadores.
- Pontuação ou impacto por fator.
- Distribuição das pessoas por segmentos.
- Comparação da taxa de conversão por segmento.

O vídeo demonstra o resultado analítico, mas não comprova como o modelo é
treinado, quais dados entram, qual fórmula gera a pontuação nem quais volumes
mínimos são exigidos.

### 6. Testes A/B

- Catálogo de testes.
- Lista de variações com miniatura.
- Visitas, conversões, taxa e tendência temporal por variação.
- Filtro por período.
- Fluxo em etapas para configurar o teste.
- Inclusão de URLs das variações.
- Distribuição percentual do tráfego.
- Indicação visual de distribuição completa.

O vídeo não comprova persistência de variante, regra estatística, atribuição de
receita, tratamento de bots, reconciliação ou seleção automática de vencedor.
Essas regras devem continuar seguindo a especificação própria do Funil Metrics.

### 7. Construtor de dashboards

- Catálogo de dashboards.
- Criação de novo dashboard.
- Layout personalizável.
- Inclusão de widgets.
- KPIs, gráficos e tabelas combinados na mesma tela.
- Assistente lateral contextual.
- Construção ou alteração orientada por conversa.
- Sugestões de produtos, métricas e visões durante a conversa.

O vídeo sugere geração assistida de widgets, mas não comprova permissões,
versionamento, auditoria, validação de fórmulas ou publicação automática.

## Padrões de experiência que devem orientar o Funil Metrics

- Filtro de período global e persistente por tela.
- Drill-down progressivo: resumo, tabela ou mapa, detalhe e evidência.
- Mesmos filtros preservados ao navegar entre módulos relacionados.
- Métricas configuráveis sem perder definições canônicas.
- Estados positivos, negativos e neutros distinguíveis sem depender apenas de
  cor.
- Cards para descoberta; tabelas para comparação; mapas para relações; detalhe
  para decisão.
- IA contextual, conhecendo projeto, período, filtros, entidade e métricas
  visíveis.
- Resposta da IA com evidências e links para os elementos analisados.
- Navegação lateral compacta e agrupada por objetivo, não por fonte técnica.
- Ações avançadas dentro de painéis laterais ou modais sem interromper a
  investigação.

## Comparação com o Funil Metrics atual

| Área | Fundação atual | Principal lacuna |
|---|---|---|
| Projetos e integrações | Implementada e isolada por projeto | Tornar contexto e saúde sempre visíveis sem dominar a tela |
| Campanhas | Listagem, detalhe, exportação e ações preparadas | Tabela configurável, níveis conta/campanha/conjunto/anúncio e tendências |
| Funis | Rotas, exportação e visão de funil existentes | Editor e mapa operacional mais rico, com drill-down por nó |
| Criativos | Drive, R2, versões, vídeo, transcrição, IA e revisão | Cards orientados a desempenho, comparação múltipla e análise contextual |
| Lançamentos | Conceito previsto no PRD | Visão especializada e debriefing integrado |
| Segmentos | Rota existente | Modelo explicável, fatores, distribuição e conversão comparada |
| Experimentos | Links e fluxo de experimentos existentes | Tela comparativa mais visual e evolução temporal por variação |
| Dashboards | Visão geral e relatórios existentes | Construtor de widgets, layouts salvos e dashboards por projeto |
| Assistente | Rota própria existente | Assistente contextual embutido em cada superfície |

## Direção recomendada de produto

O Funil Metrics deve buscar paridade perceptiva e funcional com a referência,
mantendo marca, ativos, código e regras próprios. A direção aprovada é:

- substituir progressivamente o verde dominante por fundo azul-preto e violeta;
- aproximar composição, densidade, proporções e padrões de interação da
  referência nas telas equivalentes;
- reduzir títulos excessivamente grandes em telas densas;
- usar fundo escuro, painéis discretos e cor de destaque com parcimônia;
- criar uma barra de contexto comum com projeto, período, filtros ativos,
  atualização e qualidade dos dados;
- adotar uma tabela analítica canônica para mídia paga;
- adotar um canvas canônico para mapas de funil;
- adotar cards de criativos com mídia, métricas e estado;
- embutir o assistente em painel lateral reutilizável;
- permitir salvar visões, colunas, filtros e dashboards por projeto e usuário.

A meta indicada pelo responsável do produto é de 98% de proximidade percebida.
Ela será verificada por comparação visual e checklist, sem representar cópia de
marca, ativos, textos, código ou elementos proprietários.

## Sequência de implementação recomendada

### Bloco A — Experiência analítica comum

1. barra global de contexto e período;
2. filtros persistentes e compartilháveis;
3. definições de métricas acessíveis;
4. painel lateral de detalhes;
5. assistente contextual reutilizável.

Esse bloco deve vir primeiro porque reduz retrabalho nos demais módulos.

### Bloco B — Gerenciador de mídia paga

1. níveis conta, campanha, conjunto, anúncio e criativo;
2. tabela configurável;
3. conjuntos de colunas salvos;
4. tendências por janela;
5. drill-down e exportação coerentes com os filtros.

### Bloco C — Mapa operacional de funis

1. catálogo de funis;
2. canvas com nós tipados;
3. métricas por etapa;
4. detalhe de origens e transições;
5. comparação de períodos;
6. visão de jornada entre funis, diferencial próprio do Funil Metrics.

### Bloco D — Criativos orientados a desempenho

1. filtros e agrupamentos;
2. cards com métricas canônicas;
3. comparação múltipla;
4. análise de padrões com evidências;
5. sugestões de variação ligadas à versão analisada;
6. aprovação humana e publicação assistida já previstas.

### Bloco E — Visões especializadas

1. lançamentos;
2. perpétuo;
3. webinar e VSL;
4. segmentos e scoring;
5. experimentos.

### Bloco F — Construtor de dashboards

1. biblioteca de widgets aprovados;
2. layouts salvos;
3. permissões por projeto;
4. criação assistida por IA;
5. versionamento e auditoria;
6. compartilhamento e exportação.

## Diferenciais que não devem ser perdidos

Mesmo usando a referência como direção, o Funil Metrics deve continuar superior
nos pontos que já orientam o produto:

- jornada permanente por pessoa entre vários funis e produtos;
- separação entre pessoa, jornada, funil, campanha e evento;
- histórico próprio independente das plataformas;
- Lastlink com bruto e normalizado auditáveis;
- UTMs preservadas;
- identidade e ascensão entre produtos;
- métricas reproduzíveis;
- criativos versionados e aprovação humana;
- ações externas com guardrails e auditoria;
- qualidade dos dados visível.

## Pontos que precisam de confirmação futura

- Quais conjuntos de colunas devem vir prontos no gerenciador de anúncios.
- Quais tipos de nó o editor de funil permitirá criar manualmente.
- Se lançamentos serão uma entidade própria ou uma configuração especializada
  de funil e período.
- Fórmula, entradas e volume mínimo do mapa de influência e dos segmentos.
- Biblioteca inicial de widgets do construtor de dashboards.
- Quais alterações de dashboard poderão ser executadas diretamente pela IA.
- Regras estatísticas definitivas para testes A/B.
- Prioridade entre gerenciador de anúncios, mapa de funil e construtor de
  dashboards depois da camada de experiência comum.

## Recomendação imediata

Incorporar esta referência ao roadmap como uma frente de consolidação de
experiência, começando pela camada comum e pelo gerenciador de mídia paga. O
construtor de dashboards deve vir depois que métricas, filtros e widgets
canônicos estiverem estáveis; antecipá-lo faria o produto multiplicar
visualizações inconsistentes.
