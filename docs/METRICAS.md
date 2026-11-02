# Métricas operacionais do Gerenciador Meta Ads

As colunas operacionais abaixo usam somente campos comprovados nos insights
diários sincronizados da Meta. Elas não substituem cliques no link por cliques
de todos os tipos e não inferem receita ou compras.

- **Alcance:** soma do campo diário `reach`. Em intervalos com mais de um dia,
  não representa pessoas únicas no período, pois uma mesma pessoa pode aparecer
  em dias diferentes.
- **Frequência operacional:** `impressões / soma do alcance diário`. Deve ser
  identificada como aproximação agregada e não como a frequência oficial única
  do período.
- **CPM:** `investimento convertido / impressões * 1.000`.
- **Cliques no link:** soma exclusiva de `actions` cujo `action_type` seja
  `link_click`.
- **CTR de link:** `cliques no link / impressões * 100`.
- **CPC de link:** `investimento convertido / cliques no link`.
- **Visualizações da página de destino:** soma exclusiva de `actions` cujo
  `action_type` seja `landing_page_view`.
- **Custo por visualização da página:** `investimento convertido /
  visualizações da página de destino`.
- **Checkouts iniciados:** soma exclusiva de `actions` cujo `action_type` seja
  `initiate_checkout`.
- **Custo por checkout iniciado:** `investimento convertido / checkouts
  iniciados`.

Quando o denominador for zero, a ação não tiver sido recebida ou a cobertura
cambial estiver incompleta, a métrica derivada deve aparecer como indisponível,
nunca como zero fabricado.

## Dashboard Inteligente (cruzamento vendas × Meta, por anúncio)

Base de venda: eventos de pagamento em produção com `financial_effect > 0`
(mesma base do Resumo executivo). Base de gasto: `meta_ad_insights_daily`
do projeto, na moeda do projeto. Janela: período selecionado; a variação
compara com a janela imediatamente anterior de mesma duração.

- **Faturamento bruto:** soma dos efeitos financeiros positivos do período.
- **Gasto com ads:** soma de `spend` dos insights diários do período.
- **Lucro (Dashboard Inteligente):** `faturamento bruto - gasto com ads`.
  Não desconta taxas da plataforma nem comissões; não confundir com a
  receita líquida do Resumo executivo.
- **Vendas aprovadas:** pagamentos distintos com efeito positivo.
- **ROAS:** `faturamento / gasto`. Sem gasto no período: indisponível.
- **CPA:** `gasto / vendas aprovadas`. Sem vendas: indisponível.
- **Ticket médio:** `faturamento / vendas aprovadas`. Sem vendas:
  indisponível.
- **Por anúncio:** vendas e faturamento agrupados pelo ID extraído do
  `utm_content`; gasto, impressões e cliques no link agrupados por
  `external_ad_id`. **CTR de link:** `cliques no link / impressões * 100`.
  **CPC de link:** `gasto / cliques no link`. Denominador zero ou ausência
  de `link_click` resulta em indisponível, nunca zero fabricado.
- **Participação regional:** vendas da UF / total de vendas do período,
  com UF estimada pelo DDD do telefone do comprador (ver D-137).

## Taxa de aprovacao por metodo de pagamento

Pagamentos aprovados do metodo divididos pelos pagamentos concluidos
do metodo no periodo. Concluido e o pagamento que chegou a um desfecho:
aprovado, recusado (failed), expirado ou cancelado. Pendente e em
analise ficam fora dos dois lados da divisao. Sem nenhum pagamento
concluido no periodo, a taxa e indisponivel e o bloco mostra N/A, nunca
zero. Os metodos crus das fontes sao agrupados em Pix, Cartao, Boleto e
Outros. Por isso o Pix tende a mostrar taxa menor que o cartao: o PIX
gerado e nao pago entra como concluido nao aprovado.

## Gasto da Meta com filtros comerciais (D-151)

O gasto e as demais metricas da Meta pertencem ao escopo das
contas de anuncios selecionadas no filtro de contas. Filtros
comerciais (produto, oferta, canal, meio, metodo, status de
pagamento, segmento de comprador) recortam as vendas, mas nao
escondem o gasto: ele continua visivel para comparacao no mesmo
periodo, sempre rotulado como gasto das contas selecionadas.

## Funil de conversao (formatos do widget)

- Formato Classico: barras empilhadas com o valor de cada etapa e a taxa em relacao a etapa anterior.
- Formato Etapas: conversao geral (ultima etapa dividida pela primeira) e, por etapa, taxa de passagem (etapa dividida pela anterior; a primeira vale 100%), quantidade e barra proporcional a primeira etapa, com a perda da etapa indicada.
- As etapas e a ordem vem da configuracao do widget (metricas governadas, na ordem salva). Metrica indisponivel nao gera taxa.
## Lucro por conta (widget do Dashboard)

- Investimento da conta: soma de spend_base no periodo, mesma base do widget Investimento por conta, respeitando o filtro de contas.
- Faturamento da conta: receita das vendas aprovadas atribuidas aos anuncios da conta (primeira atribuicao, ID do anuncio no utm_content), na base de receita selecionada no Dashboard.
- Lucro = faturamento atribuido menos investimento (lucro de midia, sem taxas do gateway nem custo de produto). ROAS = faturamento dividido pelo investimento; sem investimento no periodo, ROAS indisponivel.
- Vendas sem anuncio identificado nao sao atribuidas a nenhuma conta; a soma das contas pode ficar abaixo do faturamento total do painel.
## Melhores anuncios (ranking, funil invertido e retencao de video)

Ranking de anuncios do periodo. A metrica principal e a **venda real
atribuida**: pagamentos em producao com efeito positivo, agrupados pelo
ID do anuncio extraido do `utm_content` (mesma regua do Dashboard
Inteligente). O gasto e a soma de `spend_base` dos insights diarios com
conversao cambial concluida ou desnecessaria. Vendas sem ID de anuncio
ficam fora do ranking e sao informadas a parte.

- **Funil invertido (por anuncio e do periodo):** impressoes, cliques
  no link (`link_click`), visualizacoes da pagina de destino
  (`landing_page_view`), checkouts iniciados (`initiate_checkout`) e
  vendas reais atribuidas. As quatro primeiras etapas sao numeros da
  Meta; a ultima e a venda registrada no Funil Metrics. A taxa entre
  etapas vizinhas e `etapa seguinte / etapa anterior * 100`; etapa
  anterior zerada torna a taxa indisponivel.
- **Hook rate:** `visualizacoes de 3 segundos / impressoes * 100`. A
  visualizacao de 3 segundos e a acao `video_view` dos insights,
  gravada na sincronizacao em `video_views_3s`.
- **Body rate:** `thruplay / visualizacoes de 3 segundos * 100`, com o
  thruplay gravado em `video_thruplay_views` a partir de
  `video_thruplay_watched_actions`.
- **Segurou ate 75%:** `video_p75_views / visualizacoes de 3 segundos
  * 100` (a sincronizacao tambem grava os marcos de 25%, 50% e 100%).
- **Regua visual de retencao:** 30% e apenas referencia de exibicao
  (verde a partir dela, atencao entre 20% e 30%, critico abaixo de
  20%); nao e meta e nao muda o calculo.
- Anuncio sem metrica de video sincronizada, ou com denominador zero,
  mostra a taxa como indisponivel, nunca como zero fabricado. A
  frequencia segue a regua operacional (impressoes / alcance diario).
