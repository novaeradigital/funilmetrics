# Análise da referência VK Metrics — 29/07/2026

Fonte analisada: `2026-07-29 13-10-12.mp4`  
Duração: 1 h 04 min 56 s  
Escopo: referência funcional e visual para o Funil Metrics

## Método e limites

- O vídeo original não foi alterado.
- Foram gerados quadros derivados fora do repositório para inspeção das telas.
- A análise diferencia capacidade visível, interpretação e recomendação.
- A transcrição automática integral está sendo produzida localmente. Este
  documento usa somente o que já pôde ser confirmado visualmente; a versão
  anonimizada da transcrição complementará os detalhes verbais.
- A referência orienta hierarquia, densidade e padrões de interação. Marca,
  código, textos e ativos proprietários não serão copiados.

## Conclusão principal

O vídeo reforça três superfícies que devem ser tratadas como produtos conectados:

1. **Gerenciador de anúncios:** operação hierárquica de contas, campanhas,
   conjuntos, anúncios e criativos.
2. **Análise de campanhas:** leitura de métricas, tendências, detalhamento e
   comparação sem misturar a operação cotidiana.
3. **Dashboards personalizáveis:** composição de indicadores, gráficos, tabelas
   e funis em layouts salvos por projeto.

O construtor de dashboards deve ser uma fundação transversal, e não apenas mais
uma página. Gerenciador, campanhas, funis, criativos, lançamentos e relatórios
devem consumir o mesmo catálogo governado de métricas, filtros e componentes.

## Capacidades comprovadas

### Gerenciador de anúncios

- Integrações e contas de anúncios separadas por plataforma.
- Níveis de navegação para conta, campanha, conjunto e anúncio.
- Pesquisa, período e filtros compactos.
- Tabela densa com alternância de estado por linha.
- Colunas de orçamento, gasto, faturamento, ROAS e outros indicadores.
- Personalização de colunas.
- Totalização no rodapé da tabela.
- Drill-down hierárquico sem abandonar o contexto da tela.
- Visão de criativos em cards, com miniatura e métricas.
- Detalhe do criativo em modal ou painel contextual.

O vídeo mostra o controle visual de estado, mas não comprova por si só os
guardrails, permissões, idempotência ou reconciliação usados pela plataforma.

### Análise de campanhas

- Tabela comparável por período e nível da hierarquia Meta.
- Métricas de mídia, conversão, receita e retorno lado a lado.
- Valores positivos e negativos destacados.
- Acesso ao detalhe sem perder filtros.
- Modais ou painéis com informações adicionais do item selecionado.
- Exportação e atualização contextual.

No Funil Metrics, métricas de receita e retorno somente podem aparecer quando a
ligação entre mídia, evento e efeito financeiro for comprovada. Ausência dessa
ligação deve ser exibida como indisponibilidade, não como zero.

### Dashboards personalizáveis

- Dashboards com KPIs, séries temporais, tabelas, barras, roscas e funis.
- Vários widgets organizados no mesmo espaço.
- Alteração da composição e inclusão de blocos.
- Filtros e período aplicados ao contexto do dashboard.
- Visões especializadas para operação, produto, lançamento e pesquisa.
- Assistência contextual durante a exploração ou composição.

O vídeo não comprova o modelo de permissão, versionamento, validação de fórmulas,
publicação, restauração ou auditoria. Esses requisitos precisam ser próprios do
Funil Metrics.

### Funis, testes e pesquisa

- Mapa de funil em nós conectados, com métricas por etapa.
- Configuração de variações e divisão de tráfego para testes.
- Comparação das variações em um painel lateral.
- Pesquisa com perguntas e respostas agregadas.
- Modelos de influência, detratores e impulsionadores.
- Segmentos, distribuição e conversão comparada.

Resultados de influência e segmentação observados na referência não comprovam
causalidade nem revelam a fórmula empregada.

## Direção funcional recomendada

### 1. Separar operação e análise

O menu Performance deve oferecer duas experiências relacionadas:

- **Gerenciador de anúncios:** alteração de estado e, futuramente, orçamento;
- **Campanhas:** análise, comparação, detalhe, exportação e diagnóstico.

Os filtros de projeto, conexão, conta, período e nível devem ser preservados ao
alternar entre elas.

### 2. Tornar dashboards uma capacidade central

Entidades recomendadas:

- `dashboard`
- `dashboard_version`
- `dashboard_widget`
- `dashboard_layout_item`
- `dashboard_filter`
- `dashboard_template`
- `dashboard_access`
- `saved_metric_view`

Cada dashboard pertence a um projeto. Uma versão publicada é imutável; alterações
ocorrem em rascunho e podem ser restauradas. Widgets só usam métricas registradas
em `docs/METRICAS.md`, com fonte, fórmula, moeda, fuso, período e versão da regra.
Não haverá SQL livre no navegador nem fórmula arbitrária sem validação.

Tipos iniciais de widget:

- KPI e KPI com tendência;
- série temporal;
- barras horizontais e verticais;
- rosca;
- funil;
- tabela analítica;
- comparação de períodos;
- texto ou observação metodológica.

### 3. Detalhe contextual de campanha

O detalhe deve abrir em modal amplo ou painel lateral e conter:

- identidade, estado, objetivo, conta e orçamento;
- métricas e série temporal no período ativo;
- conjuntos, anúncios e criativos vinculados;
- eventos e conversões disponíveis;
- qualidade, cobertura e limitações dos dados;
- histórico de sincronização e auditoria;
- ações disponíveis conforme papel e permissão.

### 4. Escrita na Meta com segurança

Pausa, reativação ou orçamento exigem:

- permissão Meta de escrita e conta em allowlist;
- snapshot do estado atual;
- intenção explícita e resumo do impacto;
- aprovação humana;
- chave idempotente;
- auditoria antes/depois;
- reconciliação posterior;
- estado de falha e tentativa controlada.

Uma alternância na tabela nunca deve significar escrita silenciosa.

## Direção visual

- Base azul-preta, painéis discretos e violeta como ação principal.
- Verde reservado a sucesso ou desempenho positivo; vermelho a falha ou risco.
- Navegação lateral compacta por ícones e módulos.
- Tipografia pequena e densa nas telas operacionais.
- Bordas finas, raios moderados e baixa elevação.
- Tabela como elemento principal do gerenciador.
- Modais e painéis laterais para detalhe sem perder contexto.
- Dashboards em grade modular, com alinhamento rigoroso e respiro consistente.

## Ordem recomendada

### P0 — Fundação de dashboards

1. catálogo governado de métricas;
2. modelo de dashboard, versão, widget e layout;
3. modo visualizar e modo editar;
4. salvar rascunho, publicar e restaurar;
5. filtros globais e estados de carregamento, vazio, erro e permissão;
6. templates iniciais de Visão executiva, Campanhas e Funil.

### P0 — Gerenciador de anúncios

1. separar a rota operacional da análise de campanhas;
2. tabela hierárquica com conjuntos de colunas;
3. seleção, busca, período e filtros persistentes;
4. modal de inspeção da ação;
5. pausa e reativação somente após concluir guardrails e escrita Meta.

### P1 — Detalhe analítico de campanha

1. modal/painel de resumo;
2. série temporal e comparação;
3. conjuntos, anúncios e criativos;
4. eventos, receita e limitações;
5. auditoria e exportação.

### P1 — Personalização assistida

1. biblioteca de widgets;
2. reorganização e redimensionamento;
3. duplicação de dashboard;
4. criação assistida por IA usando somente métricas governadas;
5. prévia das mudanças antes de salvar.

## Critérios de aceite

- Todos os dados e widgets respeitam o projeto ativo e RLS.
- Métrica não comprovada aparece como indisponível.
- Filtros e período são preservados entre visão e detalhe.
- Dashboard publicado pode ser restaurado sem perder histórico.
- Mudanças em anúncios geram aprovação, auditoria e reconciliação.
- Nenhuma ação externa ocorre por clique acidental ou atualização da página.
- A interface inclui carregamento, vazio, erro e falta de permissão.
- A proximidade visual é validada lado a lado, sem copiar ativos proprietários.

## Pontos a validar na transcrição

- comportamento exato ao alternar estado de uma campanha ou anúncio;
- conjuntos de colunas fornecidos por padrão;
- regras de atualização e latência das métricas;
- limites de personalização do dashboard;
- permissões para editar, publicar e compartilhar dashboards;
- funcionamento do assistente durante a criação de widgets;
- detalhes exibidos nos modais de campanha e criativo.
