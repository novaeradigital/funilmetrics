# Especificação técnica — Ingestão de webhooks da Lastlink

Versão: 0.3  
Status: recepção bruta e normalização em lotes implementadas  
Data: 24/07/2026

## 1. Objetivo

Receber webhooks da Lastlink com segurança, preservar a evidência original,
impedir duplicidades e transformar eventos externos em fatos normalizados de
pedidos e pagamentos.

Esta especificação orienta os contratos, o armazenamento e os testes da
integração. A recepção autenticada, a preservação bruta e a normalização
idempotente em lotes já foram implementadas.

### Estado da implementação

Implementado:

- endpoint `POST /webhooks/lastlink/:connectionPublicId`;
- limite de 1 MiB e exigência de JSON;
- autenticação por `x-lastlink-token` com hash scrypt e janela para rotação;
- preservação do corpo original, JSON válido, hash e headers permitidos;
- idempotência pelo `Id` externo, com hash canônico como fallback;
- validação tolerante com Zod e preservação de campos desconhecidos;
- quarentena de JSON inválido, evento desconhecido e payload parcial;
- testes anonimizados dos oito eventos confirmados;
- RLS e bloqueio de acesso direto aos eventos brutos pelo navegador;
- implantação HTTPS na Railway, conectada ao Supabase pelo pooler de sessão
  IPv4 com validação da CA oficial;
- teste ponta a ponta de entrega e reentrega idempotente em produção.
- normalização dos oito eventos em pessoas, produtos, ofertas, pedidos,
  pagamentos, eventos financeiros e atribuição;
- separação física entre dados de produção, teste e escopo desconhecido;
- efeito financeiro zero para `IsTest: true` e para escopo desconhecido;
- aprovação positiva uma única vez e primeira reversão negativa uma única vez,
  exigindo `PaymentId`;
- processamento concorrente com `FOR UPDATE SKIP LOCKED`, retentativa e
  quarentena para bloqueios de regra;
- worker contínuo separado na Railway, com polling inicial de cinco segundos,
  lotes de 25 eventos, até cinco tentativas e encerramento gracioso;
- preservação de todos os produtos e de UTMs, `src`, `sck`, `vtid` e URL de
  origem no bruto e no normalizado;
- RLS conservadora na camada normalizada, acessível inicialmente só pelo backend.

Ainda não implementado:

- tela de provisionamento e rotação administrativa da conexão;
- política de backoff exponencial e alertas operacionais;
- projeções agregadas e atualização dos dashboards de métricas;
- tela de saúde da integração.

## 2. Fontes da especificação

- `docs/REGRAS_DE_NEGOCIO.md`
- `docs/ARQUITETURA.md`
- `docs/MODELO_DE_DADOS.md`
- `docs/INTEGRACOES.md`
- `docs/EVENTOS_E_TRACKING.md`
- `docs/METRICAS.md`
- `docs/analises/lastlink/ANALISE_WEBHOOKS_2026-07-23.md`
- `docs/payloads/lastlink/`

Os logs reais determinam combinações observadas em produção. Os fixtures com
`IsTest: true` demonstram estrutura possível, mas não obrigatoriedade nem
coerência financeira.

## 3. Escopo inicial

Eventos inicialmente aceitos:

- `Abandoned_Cart`
- `Purchase_Request_Confirmed`
- `Purchase_Order_Confirmed`
- `Purchase_Request_Expired`
- `Purchase_Request_Canceled`
- `Refund_Requested`
- `Payment_Refund`
- `Payment_Chargeback`

Fora desta versão:

- Renovação e ciclo completo de assinatura.
- Liberação e remoção de acesso.
- Reconciliação por API de consulta da Lastlink.
- Edição de dados na Lastlink.
- Fórmulas definitivas de comissão.
- Regras definitivas de order bump e upsell.

Eventos desconhecidos devem ser armazenados, sinalizados e não descartados.

## 4. Princípios

1. O corpo recebido é imutável.
2. Validação ou normalização não altera o dado bruto.
3. Reentrega não cria outro fato financeiro.
4. Eventos diferentes do mesmo pagamento permanecem separados.
5. Campos desconhecidos são preservados.
6. `IsTest: true` nunca alimenta métricas de produção.
7. Falha de normalização não impede a guarda do payload autenticado.
8. Nenhuma métrica depende diretamente do JSON bruto.

## 5. Fluxo

```text
POST da Lastlink
→ resolver organização, projeto e conexão pelo endpoint
→ limitar tamanho e método
→ verificar x-lastlink-token
→ capturar received_at
→ calcular hash do corpo recebido
→ persistir raw_event
→ responder rapidamente
→ processar em fila
→ validar envelope
→ deduplicar
→ validar Data conforme Event
→ normalizar identidades e entidades
→ produzir evento interno
→ aplicar transição financeira idempotente
→ registrar qualidade, sucesso ou falha
```

O endpoint não deve executar reconciliação financeira síncrona antes da
resposta.

## 6. Endpoint proposto

```text
POST /webhooks/lastlink/:connectionPublicId
```

Regras:

- `connectionPublicId` é opaco e não revela IDs internos.
- Aceitar somente HTTPS em produção.
- Aceitar somente `POST`.
- Exigir `Content-Type: application/json`.
- Definir limite inicial de corpo; proposta: 1 MiB.
- Não registrar corpo, token ou query string em logs de aplicação.
- Responder sucesso somente depois de persistir o bruto ou enfileirar de forma
  durável.

Respostas propostas:

| Situação | HTTP | Corpo |
|---|---:|---|
| Recebido e persistido | 202 | identificador de recebimento sem dados pessoais |
| Duplicidade reconhecida | 200 | confirmação idempotente |
| Token inválido | 401 | mensagem genérica |
| Conexão inexistente/inativa | 404 | mensagem genérica |
| Método inválido | 405 | mensagem genérica |
| Tipo ou tamanho inválido | 415/413 | mensagem genérica |
| JSON inválido | 400 | mensagem genérica |
| Falha temporária antes da persistência | 503 | mensagem genérica |

Não devolver detalhes do schema, dados do cliente ou estado financeiro.

## 7. Autenticação

O webhook observado envia:

```text
x-lastlink-token: <segredo>
```

Regras:

- A Lastlink gera o segredo automaticamente na configuração do webhook.
- Produtos diferentes podem possuir tokens diferentes.
- Manter um segredo diferente por conexão ou endpoint de produto.
- Armazenar somente hash do token quando não for necessário recuperá-lo.
- Comparar em tempo constante.
- Permitir token atual e token anterior durante uma janela curta de rotação.
- Registrar criação, rotação, revogação e último uso, nunca o valor.
- Mascarar o header em proxy, observabilidade e rastreamento distribuído.
- Aplicar rate limit por conexão e IP sem usar IP como prova de origem.

Pendências:

- Confirmar se o token muda ao recriar o webhook do mesmo produto.
- Confirmar a granularidade exata entre produto, oferta e webhook.
- Confirmar se a Lastlink oferece assinatura criptográfica do corpo.

Até essa confirmação, o token autentica a conexão, mas não substitui controles
de replay e idempotência.

## 8. Contratos TypeScript propostos

Os contratos abaixo orientam a implementação futura. A biblioteca de validação
em runtime ainda será escolhida; Zod é a opção inicial proposta.

```ts
type LastlinkWebhookEnvelope = {
  Id?: string;
  IsTest?: boolean;
  Event: string;
  CreatedAt: string;
  Data: unknown;
};

type LastlinkMoney = {
  Value: number;
};

type LastlinkProduct = {
  Id: string;
  Name: string;
  Price?: number;
};

type LastlinkAddress = {
  ZipCode?: string;
  Street?: string;
  StreetNumber?: string;
  Complement?: string;
  District?: string;
  City?: string;
  State?: string;
};

type LastlinkBuyer = {
  Id?: string;
  Email: string;
  Name?: string;
  PhoneNumber?: string;
  Document?: string;
  Address?: LastlinkAddress;
};

type LastlinkUtm = {
  UtmSource?: string;
  UtmMedium?: string;
  UtmCampaign?: string;
  UtmTerm?: string;
  UtmContent?: string;
  UtmId?: string;
  Src?: string;
  Sck?: string;
  Vtid?: string;
};
```

Os tipos devem permitir campos adicionais para evitar descarte quando a
Lastlink ampliar o schema.

### 8.1 Compra

```ts
type LastlinkPurchase = {
  PaymentId?: string;
  Recurrency?: number;
  IsRenewal?: boolean;
  RecurrenceNumber?: number;
  PaymentDate?: string;
  RefundDate?: string;
  ChargebackDate?: string;
  NextBilling?: string;
  OriginalPrice?: LastlinkMoney;
  Price?: LastlinkMoney;
  Payment?: {
    NumberOfInstallments?: number;
    PaymentMethod?: string;
    InterestRateAmount?: number;
  };
  Coupon?: string;
  Affiliate?: {
    Id?: string;
    Email?: string;
  };
  Pix?: {
    QrCode?: string;
    QrCodeText?: string;
  };
  BankSlip?: {
    DigitableLine?: string;
    BarCodeData?: string;
    BarCode?: string;
  };
  InvoiceUrl?: string;
  OriginUrl?: string;
  IsUpsell?: boolean;
  IsSmartInstallment?: boolean;
  SmartInstallment?: {
    CurrentInstallment?: number;
    TotalInstallments?: number;
    Type?: string;
  };
};
```

### 8.2 Dados do evento

```ts
type LastlinkEventData = {
  Products: LastlinkProduct[];
  Buyer: LastlinkBuyer;
  Seller?: {
    Id?: string;
    Email?: string;
  };
  Commissions?: Array<{
    Value?: number;
    Source?: string;
    Details?: Array<{
      ReceiverId?: string;
      Amount?: number;
      ReceiverEmail?: string;
    }>;
  }>;
  Purchase?: LastlinkPurchase;
  Subscriptions?: Array<{
    Id?: string;
    ProductId?: string;
    Cycle?: string | number;
    ExpiredDate?: string;
    CanceledDate?: string;
    CancellationReason?: string;
  }>;
  Offer: {
    Id: string;
    Name: string;
    Url?: string;
  };
  Utm?: LastlinkUtm;
  DeviceInfo?: {
    UserAgent?: string;
    ip?: string;
  };
};
```

### 8.3 Estratégia de validação

Dois níveis:

1. **Envelope mínimo:** `Event`, `CreatedAt` e `Data`. `Id` e `IsTest` são
   esperados no contrato observado; ausência gera qualidade parcial e ativa
   tratamento conservador.
2. **Schema por evento:** valida os campos necessários para normalizar aquele
   fato, mantendo campos adicionais.

Resultado:

```ts
type ValidationOutcome =
  | { status: "valid"; warnings: ValidationWarning[] }
  | { status: "partial"; warnings: ValidationWarning[] }
  | { status: "invalid"; errors: ValidationError[] };
```

`partial` não é igual a inválido. Exemplo: `Payment_Refund` sem `RefundDate` pode
ser guardado e normalizado com qualidade parcial.

## 9. Matriz mínima por evento

| Evento | Mínimo para normalizar | Campos financeiros preferidos |
|---|---|---|
| `Abandoned_Cart` | `Id`, `CreatedAt`, `Buyer.Email`, `Products`, `Offer` | nenhum |
| `Purchase_Request_Confirmed` | envelope, `Buyer.Email`, `Products`, `Offer` | `PaymentId`, preço e método quando presentes |
| `Purchase_Order_Confirmed` | envelope, `Buyer.Email`, `Products`, `Offer` | `PaymentId`, `PaymentDate`, `Price.Value` |
| `Purchase_Request_Expired` | envelope, `Buyer.Email`, `Products`, `Offer` | `PaymentId` quando presente |
| `Purchase_Request_Canceled` | envelope, `Buyer.Email`, `Products`, `Offer` | `PaymentId` quando presente |
| `Refund_Requested` | envelope, `Buyer.Email`, `Products`, `Offer` | `PaymentId` |
| `Payment_Refund` | envelope, `Buyer.Email`, `Products`, `Offer` | `PaymentId`, `RefundDate`, `Price.Value` |
| `Payment_Chargeback` | envelope, `Buyer.Email`, `Products`, `Offer` | `PaymentId`, `ChargebackDate`, `Price.Value` |

Ausência de um campo preferido gera qualidade parcial, não descarte automático.

## 10. Armazenamento bruto

Registro mínimo proposto em `raw_events`:

- ID interno.
- Organização, projeto e conexão.
- Fonte `lastlink`.
- Método, tipo de conteúdo e headers permitidos.
- Corpo bruto exato.
- Hash do corpo bruto.
- `received_at` em UTC.
- `external_event_id`, quando extraído.
- `external_event_name`, quando extraído.
- `is_test`, quando extraído.
- Estado de autenticação.
- Estado de validação e processamento.
- Versão do parser.
- Número de tentativas.
- Erro sanitizado, quando houver.

Headers armazenados devem seguir lista permitida. `x-lastlink-token`, cookies,
autorização e dados equivalentes nunca são persistidos em texto.

O corpo bruto contém dados pessoais e financeiros e deve ser criptografado em
repouso, isolado por organização/projeto e acessível apenas por perfis
autorizados com auditoria.

## 11. Idempotência

### 11.1 Chave principal

Quando `Id` for válido:

```text
organization_id + project_id + source + connection_id + Id
```

Restrição única no armazenamento bruto e no fato normalizado.

### 11.2 Fallback

Quando `Id` estiver ausente:

```text
sha256(
  source
  + connection_id
  + Event
  + CreatedAt bruto
  + PaymentId quando presente
  + hash canônico de Data
  + versão da estratégia
)
```

O hash canônico:

- Ordena chaves de objetos.
- Preserva ordem de arrays.
- Diferencia número, string, booleano e nulo.
- Não remove campos desconhecidos.
- Não normaliza valores pessoais antes do cálculo.

### 11.3 Reentrega e reprocessamento

- Mesmo `Id`: confirmar idempotentemente, sem novo fato.
- Mesmo hash de fallback: confirmar idempotentemente.
- Mesmo `PaymentId`, eventos diferentes: preservar todos.
- Mesmo `PaymentId + Event`, IDs diferentes: guardar as entregas, mas criar no
  máximo um efeito financeiro equivalente até reconciliação.
- Reprocessamento usa o mesmo bruto e registra nova tentativa/versionamento.

## 12. Datas

Guardar:

- Valor textual original.
- Valor convertido, quando possível.
- Fuso ou regra usada na conversão.
- Qualidade da data.

Prioridade:

| Evento | `occurred_at` preferido |
|---|---|
| `payment_approved` | `Purchase.PaymentDate` |
| `payment_refunded` | `Purchase.RefundDate` |
| `payment_chargeback` | `Purchase.ChargebackDate` |
| expiração/cancelamento | data específica da assinatura quando semanticamente compatível |
| demais | `CreatedAt` |

`CreatedAt` sem fuso:

- Preservar a string.
- Não anexar `Z` por suposição.
- Usar fuso configurado da conexão somente quando essa regra for aprovada.
- Enquanto não houver regra, usar `received_at` como fallback operacional e
  marcar `occurred_at_basis = received_at_fallback`.

Uma data incompatível com o evento gera aviso. Exemplo:
`Payment_Refund` com `ChargebackDate` não transforma o evento em chargeback.

## 13. Normalização de identidade

Sinais:

- E-mail normalizado.
- Telefone normalizado.
- `Buyer.Id` escopado pela conexão/fonte.
- Documento, quando houver base legal e acesso permitido.

Regras:

- Preservar valores brutos.
- Normalizar telefone para comparação, sem substituir o original.
- Normalizar e-mail para comparação, sem alterar o valor recebido.
- Não usar nome ou endereço como chave automática forte.
- Não criar fusão automática apenas por telefone ou e-mail ambíguo.
- Toda fusão permanece auditável e reversível.

## 14. Normalização comercial

Separar:

- Pedido.
- Itens do pedido.
- Transação/pagamento.
- Evento financeiro.
- Produto.
- Oferta.
- Assinatura.
- Pessoa.

`Products` é uma lista e não pode ser reduzida ao primeiro item. Produto e oferta
continuam entidades distintas mesmo quando seus IDs coincidirem.

`OriginalPrice.Value` e `Price.Value` são preservados separadamente. Até a
semântica ser confirmada, `Price.Value` é candidato ao valor pago, mas deve ser
reconciliado com o evento e os relatórios.

## 15. Mapeamento de eventos

| Lastlink | Interno |
|---|---|
| `Abandoned_Cart` | `checkout_abandoned` |
| `Purchase_Request_Confirmed` | `payment_pending` |
| `Purchase_Order_Confirmed` | `payment_approved` |
| `Purchase_Request_Expired` | `payment_request_expired` |
| `Purchase_Request_Canceled` | `payment_request_cancelled` |
| `Refund_Requested` | `refund_requested` |
| `Payment_Refund` | `payment_refunded` |
| `Payment_Chargeback` | `payment_chargeback` |

O evento interno referencia o nome externo e o `raw_event`.

## 16. Regras financeiras

### 16.1 Reconhecimento

- `payment_pending`: receita zero.
- `payment_approved`: reconhece receita bruta uma vez.
- `payment_request_expired`: receita zero.
- `payment_request_cancelled`: receita zero.
- `refund_requested`: não altera receita.
- `payment_refunded`: reduz receita líquida.
- `payment_chargeback`: reduz receita líquida.

### 16.2 Reconciliação

Para cada `PaymentId`, manter histórico de eventos e estado derivado.

Regras:

- Um evento novo não apaga eventos anteriores.
- Reentrega não reaplica efeito financeiro.
- Reembolso e chargeback do mesmo valor não geram dupla dedução automática.
- Valores divergentes geram pendência de reconciliação.
- Ausência de `PaymentId` impede alteração financeira automática quando não
  houver outro vínculo confiável.

### 16.3 Dados de teste

Eventos com `IsTest: true`:

- Ficam isolados da produção.
- Não criam receita, LTV ou conversão.
- Podem alimentar testes de contrato em ambiente de homologação.

Eventos com `IsTest` ausente ficam com qualidade parcial. Na primeira versão,
não aplicam efeito financeiro automático até revisão ou confirmação por uma
regra versionada da conexão.

## 17. UTMs

Preservar no bruto e normalizar individualmente:

- `utm_source`
- `utm_medium`
- `utm_campaign`
- `utm_term`
- `utm_content`
- `utm_id`
- `src`
- `sck`
- `vtid`

Regras:

- Não substituir ausência por string vazia.
- Diferenciar ausente, vazio e valor presente.
- Não consolidar campos sem regra documentada.
- Guardar também `OriginUrl` com acesso controlado.
- Não registrar query strings completas em logs.

## 18. Privacidade

Classificação inicial:

| Categoria | Exemplos | Tratamento |
|---|---|---|
| Identidade | nome, e-mail, telefone, documento | acesso restrito e mascaramento |
| Endereço | CEP, rua, número, cidade | bruto restrito; normalizar somente se necessário |
| Financeiro sensível | PIX, boleto, fatura | bruto restrito; nunca em logs |
| Técnico identificável | IP e user agent | retenção definida e acesso restrito |
| Segredo | `x-lastlink-token` | nunca persistir em texto ou registrar |

Exportações e acesso a payload bruto devem ser auditados.

## 19. Falhas e quarentena

Estados propostos:

```text
received
authenticated
duplicate
queued
validated
partial
normalized
quarantined
failed_retryable
failed_terminal
```

Quarentena:

- Token válido, mas JSON inválido.
- Envelope incompleto.
- Evento conhecido sem dados mínimos.
- Evento desconhecido aguardando mapeamento.
- Inconsistência financeira que impeça aplicação segura.

Quarentena não apaga o payload. Deve permitir reprocessamento após correção de
regra ou parser.

## 20. Observabilidade

Métricas:

- Webhooks recebidos por evento e conexão.
- Autenticações recusadas.
- Duplicidades por `Id` e fallback.
- Tempo entre `CreatedAt` e `received_at`, quando comparável.
- Tempo até normalização.
- Eventos parciais, desconhecidos e em quarentena.
- Falhas e retentativas.
- Cobertura de `PaymentId`, comprador e UTMs.
- Divergências financeiras.

Logs:

- IDs internos e técnicos permitidos.
- Nunca incluir corpo, token, documento, e-mail, telefone, PIX, boleto ou URL
  completa.

Alertas:

- Crescimento de 401/404/429/5xx.
- Evento externo desconhecido.
- Alteração relevante do schema.
- Integração sem eventos no período esperado.
- Aumento de duplicidades.
- Fila ou normalização atrasada.

## 21. Estados de interface obrigatórios

Painel da integração:

- Carregando.
- Sem webhooks.
- Integração saudável.
- Integração atrasada.
- Erro recuperável.
- Dados parciais.
- Eventos em quarentena.
- Sem permissão.

Cada estado deve mostrar última entrega, último processamento e ação segura
disponível.

## 22. Testes de contrato

Usar os oito fixtures em `docs/payloads/lastlink/`.

Casos mínimos:

1. Aceitar cada envelope conhecido.
2. Isolar todos os eventos `IsTest: true`.
3. Rejeitar token inválido sem persistir segredo.
4. Aceitar campos adicionais.
5. Marcar ausência de campo preferido como parcial.
6. Não contar `Purchase_Request_Confirmed` como receita.
7. Contar `Purchase_Order_Confirmed` uma única vez.
8. Não reduzir receita em `Refund_Requested`.
9. Reduzir receita em `Payment_Refund`.
10. Reduzir receita em `Payment_Chargeback`.
11. Não deduzir duas vezes em reentrega.
12. Preservar reembolso e chargeback como eventos distintos.
13. Detectar `Payment_Refund` com `ChargebackDate` como aviso.
14. Preservar todas as UTMs e parâmetros.
15. Preservar vários produtos.
16. Quarentenar JSON inválido sem descarte.
17. Armazenar evento desconhecido sem normalização destrutiva.
18. Reprocessar o mesmo bruto com nova versão do parser.

## 23. Critérios de aceite da implementação futura

- Nenhum payload autenticado é perdido.
- Nenhuma reentrega cria outra receita ou dedução.
- `IsTest: true` não aparece em métricas de produção.
- Eventos externos e normalizados permanecem auditáveis.
- Campos desconhecidos são preservados.
- Dados sensíveis não aparecem em logs.
- Falhas podem ser reprocessadas.
- A interface diferencia atraso, parcialidade, erro e ausência real.
- Métricas financeiras reconciliam por `PaymentId` quando disponível.
- O mesmo pagamento mantém histórico completo de estados.

## 24. Decisões pendentes antes da implementação

- Aprovar Zod ou outra biblioteca de validação.
- Aprovar limite de corpo.
- Confirmar armazenamento do hash do token e processo de rotação.
- Definir fuso da conexão Lastlink.
- Definir retenção de payload bruto e dados sensíveis.
- Aprovar fallback idempotente e sua versão inicial.
- Definir resposta HTTP preferida pela política de retentativas da Lastlink.
- Definir quando uma inconsistência apenas alerta e quando bloqueia efeito
  financeiro.
