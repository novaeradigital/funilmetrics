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
