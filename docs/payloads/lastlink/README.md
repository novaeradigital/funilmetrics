# Payloads anonimizados da Lastlink

Captura: 23/07/2026  
Origem: botão **Testar** da integração de webhook da Lastlink  
Condição: todos os exemplos possuem `IsTest: true`

## Uso

Os arquivos preservam nomes de campos, estrutura e tipos observados. Dados
pessoais, financeiros, URLs sensíveis, IPs e identificadores foram substituídos.

Esses fixtures comprovam campos possíveis, mas não obrigatoriedade nem coerência
financeira. O simulador combina dados sintéticos e apresentou campos
incompatíveis com alguns eventos. Consulte
`docs/analises/lastlink/ANALISE_WEBHOOKS_2026-07-23.md`.

## Exemplos

- `abandoned_cart.json`
- `purchase_request_confirmed.json`
- `purchase_order_confirmed.json`
- `refund_requested.json`
- `payment_refund.json`
- `payment_chargeback.json`
- `purchase_request_expired.json`
- `purchase_request_canceled.json`

