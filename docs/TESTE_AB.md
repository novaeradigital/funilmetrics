# Testes A/B e links inteligentes

## Fluxo principal

```text
Anúncio
→ https://go.marca.com/oferta
→ sistema escolhe uma variante
→ registra designação e exposição
→ preserva UTMs e click IDs
→ redireciona para a página A ou B
→ liga comportamento, lead e compras à variante
```

## Domínios

- Domínio padrão para testes rápidos.
- Um ou vários domínios personalizados por projeto.
- Recomendação: subdomínio como `go.marca.com`.
- Um domínio pode hospedar vários caminhos.
- Destinos podem estar em domínios diferentes.

Configuração típica:

```text
Tipo: CNAME
Nome: go
Destino: links.plataforma.com
```

O sistema deve verificar propriedade/configuração, emitir HTTPS e monitorar saúde.

## Split

- Pesos configuráveis: 50/50, 70/30 etc.
- Designação determinística/persistente por visitante.
- Cookie e identificador próprio.
- Fallback documentado quando cookies não estiverem disponíveis.
- Mudanças de peso auditadas.
- A primeira designação persistida prevalece: mudanças posteriores de peso não
  trocam silenciosamente a variante de visitantes já expostos.

## Medição

- Visitantes e exposições.
- Leads.
- Checkout.
- Compra aprovada.
- Receita bruta e líquida.
- Reembolso.
- Ascensão.
- LTV por janela.

## Estatística

- Definir previamente métrica primária e guardrails.
- Exibir intervalo de confiança/probabilidade conforme método adotado.
- Evitar encerramento precoce por oscilação.
- Alertar sobre amostra insuficiente e desequilíbrio de tráfego.
- Separar resultado exploratório de decisão conclusiva.

## Script opcional

Segunda etapa:

- Registrar eventos internos.
- Trocar elementos numa mesma página.
- Medir VSL, CTA e formulário.
- Permitir editor futuro.

## Segurança e confiabilidade

- Proteção contra redirecionamento malicioso e loops.
- Filtro de bots.
- Alta disponibilidade e baixa latência.
- Página de contingência.
- Preservação de query string com lista de bloqueio para campos sensíveis.
- Não expor IDs internos.
- O identificador opaco do experimento usa `sck` somente quando esse parâmetro
  não existe; um `sck` recebido nunca é sobrescrito.

## Operação em alto volume

- O Cloudflare Worker é o ponto de entrada recomendado para `/r/:slug`.
- A configuração do experimento fica em cache curto na borda; pausas e mudanças
  propagam após o TTL configurado.
- A resposta `302` não espera PostgreSQL nem ingestão analítica.
- Exposições são enviadas por fila e gravadas em lotes idempotentes.
- Um cookie específico do experimento preserva a primeira variante no navegador.
- Sem cookies, a designação determinística é o fallback; uma mudança posterior
  de pesos pode alterar a variante nesse caso e deve ser considerada na análise.
- Falha de configuração na borda encaminha a solicitação à rota Railway
  existente, sem criar loop no domínio personalizado.

### Homologação inicial da borda

Em 27/07/2026, o Worker e a Queue foram homologados em `workers.dev` com 2.000
visitantes técnicos distintos: todos receberam `302`, a distribuição observada
foi 1.003/997 e todas as 2.000 exposições chegaram ao PostgreSQL. O experimento
técnico foi arquivado e os registros foram preservados para auditoria.
