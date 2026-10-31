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

