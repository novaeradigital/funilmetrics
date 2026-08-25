# Análise dos webhooks da Lastlink

Data da análise: 23/07/2026  
Status: evidência inicial; não representa contrato definitivo da Lastlink

## Fontes

- `docs/fontes-originais/lastlink/webhook_logs_2026-07-23.xlsx`
- `docs/fontes-originais/lastlink/webhook_logs_2026-07-23-parte-2.xlsx`
- Testes manuais realizados pelo botão **Testar** da Lastlink em 23/07/2026.
- Documentação oficial da Lastlink consultada em 23/07/2026.

Os arquivos originais não foram modificados. Os exemplos em
`docs/payloads/lastlink/` foram anonimizados.

## Níveis de evidência

1. **Produção observada:** campo ou combinação presente nos 2.000 registros
   exportados.
2. **Simulador observado:** campo presente em payload com `IsTest: true`.
3. **Documentação oficial:** semântica publicada pela Lastlink.
4. **Hipótese:** interpretação ainda não confirmada.

Os logs reais têm precedência para frequência e combinações observadas. O
simulador comprova que um campo pode existir, mas não comprova obrigatoriedade
nem coerência entre valores.

## Envelope comprovado pelo simulador

- `Id`: UUID do evento/entrega; candidato a chave de idempotência.
- `IsTest`: booleano que distingue simulações.
- `Event`: nome externo do evento.
- `CreatedAt`: timestamp sem fuso explícito nos exemplos.
- `Data`: objeto específico do evento.

Os exports transformam `Event`, `CreatedAt` e `Data` em colunas separadas. `Id`
e `IsTest` não aparecem dentro da coluna `Payload` exportada.

## Eventos encontrados nos logs reais

| Evento | Registros | Semântica sustentada |
|---|---:|---|
| `Purchase_Order_Confirmed` | 1.371 | pagamento confirmado |
| `Purchase_Request_Confirmed` | 419 | fatura criada |
| `Purchase_Request_Expired` | 55 | fatura não paga e expirada |
| `Abandoned_Cart` | 144 | abandono de checkout |
| `Payment_Refund` | 8 | reembolso efetivado |
| `Payment_Chargeback` | 2 | chargeback efetivado |
| `Refund_Requested` | 1 | solicitação de reembolso |

`Purchase_Request_Canceled` foi comprovado apenas pelo simulador e pela
documentação oficial.

## Campos observados

### Comuns ou recorrentes

- `Data.Products[].Id`
- `Data.Products[].Name`
- `Data.Products[].Price`, ausente nos carrinhos observados
- `Data.Buyer.Id`, ausente nos carrinhos observados
- `Data.Buyer.Email`
- `Data.Buyer.Name`
- `Data.Buyer.PhoneNumber`
- `Data.Buyer.Document`
- `Data.Seller.Id`
- `Data.Seller.Email`
- `Data.Offer.Id`
- `Data.Offer.Name`
- `Data.Offer.Url`
- `Data.DeviceInfo.UserAgent`
- `Data.DeviceInfo.ip`

### Compra e pagamento

- `Data.Purchase.PaymentId`
- `Data.Purchase.Recurrency`
- `Data.Purchase.IsRenewal`
- `Data.Purchase.RecurrenceNumber`
- `Data.Purchase.PaymentDate`
- `Data.Purchase.RefundDate`
- `Data.Purchase.ChargebackDate`
- `Data.Purchase.NextBilling`, somente no simulador
- `Data.Purchase.OriginalPrice.Value`
- `Data.Purchase.Price.Value`
- `Data.Purchase.Payment.NumberOfInstallments`
- `Data.Purchase.Payment.PaymentMethod`
- `Data.Purchase.Payment.InterestRateAmount`
- `Data.Purchase.InvoiceUrl`
- `Data.Purchase.OriginUrl`
- `Data.Purchase.IsUpsell`
- `Data.Purchase.IsSmartInstallment`
- `Data.Purchase.Coupon`, somente no simulador
- `Data.Purchase.Affiliate.Id`
- `Data.Purchase.Affiliate.Email`

### Meios de pagamento

- `Data.Purchase.Pix.QrCode`
- `Data.Purchase.Pix.QrCodeText`
- `Data.Purchase.BankSlip.DigitableLine`, somente no simulador
- `Data.Purchase.BankSlip.BarCodeData`, somente no simulador
- `Data.Purchase.BankSlip.BarCode`, somente no simulador

### Parcelamento inteligente

- `Data.Purchase.SmartInstallment.CurrentInstallment`
- `Data.Purchase.SmartInstallment.TotalInstallments`
- `Data.Purchase.SmartInstallment.Type`

Valores observados no simulador para `Type`: `direct` e `recovery`. A semântica
exata ainda não foi confirmada.

### Assinaturas

- `Data.Subscriptions[].Id`
- `Data.Subscriptions[].ProductId`
- `Data.Subscriptions[].Cycle`, somente nos logs reais
- `Data.Subscriptions[].ExpiredDate`, somente no simulador
- `Data.Subscriptions[].CanceledDate`, somente no simulador
- `Data.Subscriptions[].CancellationReason`, somente no simulador

### Comissões

- `Data.Commissions[].Value`
- `Data.Commissions[].Source`
- `Data.Commissions[].Details[].ReceiverId`
- `Data.Commissions[].Details[].Amount`
- `Data.Commissions[].Details[].ReceiverEmail`

Fontes vistas no simulador: `MARKETPLACE`, `PRODUCER`, `COPRODUCER` e
`AFFILIATE`. Os valores do fixture não reconciliam com o preço e não devem
fundamentar fórmulas.

### Comprador no simulador

- `Data.Buyer.Address.ZipCode`
- `Data.Buyer.Address.Street`
- `Data.Buyer.Address.StreetNumber`
- `Data.Buyer.Address.Complement`
- `Data.Buyer.Address.District`
- `Data.Buyer.Address.City`
- `Data.Buyer.Address.State`

Esses dados não são necessários para métricas básicas e exigem acesso e
retenção restritos.

## UTMs e parâmetros

Campos comprovados:

- `Data.Utm.UtmSource`
- `Data.Utm.UtmMedium`
- `Data.Utm.UtmCampaign`
- `Data.Utm.UtmTerm`
- `Data.Utm.UtmContent`
- `Data.Utm.UtmId`, somente nos logs reais
- `Data.Utm.Src`
- `Data.Utm.Sck`
- `Data.Utm.Vtid`, somente no simulador

Não consolidar `Src`, `Sck`, `UtmId` ou `Vtid` em outro campo sem regra
confirmada. Preservar todos no bruto e no modelo normalizado.

## Identificadores

- `Id` é o único identificador do envelope comprovado pelo simulador.
- `Purchase.PaymentId` liga eventos do ciclo financeiro quando presente.
- `Buyer.Id` não apareceu nos carrinhos abandonados dos logs reais.
- `Buyer.Email` foi o único identificador pessoal presente em todos os 2.000
  registros.
- `Subscriptions[].Id`, `Products[].Id` e `Offer.Id` identificam entidades
  diferentes e não podem substituir `PaymentId`.

Ainda é necessário confirmar se uma reentrega mantém o mesmo `Id`.

## Duplicidades observadas

- 3 linhas exatamente iguais na combinação dos dois arquivos.
- 369 grupos de payloads idênticos, com 371 ocorrências adicionais.
- 368 repetições do mesmo par `PaymentId + Event`.
- 421 `PaymentId` aparecem em mais de uma linha.
- Um `PaymentId` aparece em até 5 linhas.

Repetições de `PaymentId` podem representar transições legítimas. Repetições do
mesmo `PaymentId + Event` são fortes candidatas a reentrega. A ingestão não deve
usar apenas `PaymentId` como chave única do evento.

## Inconsistências do simulador

- `Refund_Requested` e `Payment_Refund` receberam `ChargebackDate`.
- O `Payment_Refund` simulado não recebeu `RefundDate`; os oito eventos reais
  receberam.
- Fixtures de eventos diferentes usam IDs independentes e não formam uma mesma
  transação.
- `IsUpsell` e dados de parcelamento mudam arbitrariamente entre fixtures.
- Comissões não reconciliam com o preço.
- Alguns fixtures combinam PIX, assinatura, afiliado, cupom, coprodução e
  parcelamento inteligente de forma pouco realista.

Conclusão: o simulador serve para descobrir estrutura, não para derivar fórmulas
ou transições.

## Efeito financeiro provisório

| Evento externo | Efeito |
|---|---|
| `Purchase_Request_Confirmed` | não reconhecer receita |
| `Purchase_Order_Confirmed` | reconhecer receita bruta aprovada |
| `Purchase_Request_Expired` | não reconhecer nem reduzir receita |
| `Purchase_Request_Canceled` | não reconhecer nem reduzir receita |
| `Refund_Requested` | não reduzir receita; registrar solicitação |
| `Payment_Refund` | reduzir receita líquida sem apagar a compra |
| `Payment_Chargeback` | reduzir receita líquida sem apagar a compra |

Reembolso e chargeback para o mesmo `PaymentId` exigem reconciliação para evitar
dupla dedução.

## Pendências

- Confirmar estabilidade de `Id` em reentregas.
- Confirmar autenticação e rotação de `x-lastlink-token`.
- Confirmar fuso de `CreatedAt`.
- Confirmar moeda e significado exato de preços.
- Confirmar semântica de `Subscriptions` e `Cycle`.
- Confirmar order bump e upsell em eventos reais.
- Confirmar `SmartInstallment.Type`.
- Confirmar política de retentativas e limite dos exports.

