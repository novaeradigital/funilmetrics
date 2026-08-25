# Atribuição, jornada e ascensão

## Objetivo

Representar a história completa da pessoa e separar dois conceitos:

- **Jornada:** o que aconteceu.
- **Atribuição:** como o sistema distribui crédito por uma conversão.

## Exemplo

```text
Meta Ads / Criativo X
→ cadastro
→ compra do low ticket
→ mensagens no Sendflow
→ webinar ao vivo
→ compra do Produto Y
→ mentoria
```

O anúncio iniciou a aquisição. O Sendflow e o webinar podem ter assistido a compra seguinte. Cada compra tem sua própria atribuição, enquanto a pessoa mantém uma única jornada.

## Estrutura

- Pessoa
  - Identidades
  - Sessões
  - Touchpoints
  - Eventos
  - Participações em funis
  - Pedidos e pagamentos
  - Ascensões

## Modelos de leitura

- Primeiro toque.
- Último toque.
- Último toque não direto.
- Linear.
- Baseado em posição.
- Direto versus assistido.
- Modelo futuro orientado por dados.

O sistema deve guardar os touchpoints uma vez e calcular diferentes modelos sem reimportar dados.

## Janelas

As janelas serão configuráveis. Valores definitivos ainda precisam ser aprovados. Toda tela deve mostrar qual janela foi usada.

Possíveis dimensões:

- Dias entre touchpoint e conversão.
- Janela específica por produto.
- Janela pós-webinar.
- Janela de ascensão após primeira compra.

## Origem e influência

Para cada venda, mostrar:

- Origem de aquisição da pessoa.
- Touchpoint com crédito direto.
- Touchpoints assistentes.
- Funil em que ocorreu.
- Campanha/evento específico.
- Tempo desde aquisição e desde compra anterior.

## Ascensão

Uma ascensão liga:

- Compra anterior.
- Compra posterior.
- Produtos de origem e destino.
- Intervalo.
- Funis atravessados.
- Influências conhecidas.

Métricas:

- Taxa de ascensão.
- Tempo médio/mediano para ascender.
- Receita de ascensão.
- LTV por origem.
- Caminhos mais comuns.
- Caminhos de maior valor.

## Confiança

Cada vínculo de identidade e atribuição deve informar confiança:

- Confirmado: identificador forte ou dado transacional.
- Provável: combinação consistente de sinais.
- Possível: evidência insuficiente para consolidação automática.

## Casos especiais

- Uma pessoa pode usar mais de um e-mail ou telefone.
- Dispositivos diferentes podem ser ligados após identificação.
- Uma pessoa pode participar de vários webinars.
- Um mesmo pedido pode conter produto principal, bump e upsell.
- Reembolso altera o valor líquido, não apaga a jornada.

