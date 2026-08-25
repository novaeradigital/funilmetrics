# Plano de backfill cambial

Status: concluído em produção em 2 de agosto de 2026.

## Procedimento aprovado

1. Inventariar por projeto, conta, moeda e data: total de linhas, primeira e
   última data, volume financeiro e estados de moeda.
2. Bloquear contas sem moeda confirmada e solicitar correção humana auditada.
3. Estimar quantidade de pares/data, chamadas ao provedor, duração, espaço e
   tamanho dos lotes. Registrar a versão da regra.
4. Selecionar amostra estratificada: BRL, USD, EUR, fim de semana, feriado,
   conversão cruzada, taxa ausente e valores extremos.
5. Executar a amostra fora dos agregados publicados e reconciliar valor
   original, taxa, data efetiva, convertido e arredondamento.
6. Apresentar estimativa e reconciliação para aprovação. Só então liberar lotes
   idempotentes por projeto, com checkpoint, pausa e retomada.
7. Após cada lote, comparar contagens e somas, registrar cobertura e manter
   rollback lógico: derivados podem ser invalidados e recalculados; originais
   nunca são removidos ou sobrescritos.

## Execução em produção

- Execução auditada: `e6ac398e-ea5a-4a28-b971-764d072f88cd`.
- Estimativa aprovada: 1.085 linhas legadas, duas contas, moeda original USD e
  moeda-base BRL, entre 27/06/2026 e 31/07/2026.
- As moedas das contas foram confirmadas pela sincronização oficial da Meta
  antes da liberação dos lotes.
- Durante a execução chegaram 27 linhas novas pela sincronização da Meta. Elas
  foram incluídas idempotentemente no mesmo processamento, totalizando 1.112
  linhas convertidas.
- Total original reconciliado: USD 25.309,12.
- Total convertido reconciliado: BRL 129.596,965924 antes do arredondamento de
  apresentação.
- Regra aplicada: `fx-v1-ptax-closing-sale`, com taxas PTAX do Banco Central.
- 338 linhas de fins de semana ou dias sem cotação utilizaram o dia útil
  anterior; nenhuma linha utilizou taxa futura.
- Resultado final: 1.112 convertidas, zero pendentes, zero falhas, zero taxas
  não oficiais e zero divergências de reconciliação.

## Critério de aceite

Cumprido: 100% das contas envolvidas com moeda confirmada; nenhuma taxa futura;
amostra e totais reconciliados; zero alteração dos valores originais; cobertura
completa para as linhas processadas. Métricas financeiras consolidadas usam
somente valores convertidos na moeda-base do projeto.
