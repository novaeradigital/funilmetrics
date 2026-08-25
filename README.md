# Plataforma de Inteligência de Funis e Jornada do Cliente

Sistema próprio para consolidar dados de anúncios, leads, vendas, webinars e comportamento, preservando o histórico e acompanhando a pessoa desde o primeiro contato até compras e ascensões posteriores.

## Diferencial central

O sistema não analisa apenas campanhas ou produtos isolados. Ele mantém uma jornada única por pessoa, mesmo quando ela atravessa funis perpétuos, webinars, lançamentos, low tickets, upsells e mentorias.

## Estado atual

O produto e a arquitetura inicial estão documentados e a fundação técnica do
monorepo foi iniciada. Há aplicações para interface, API e worker. A primeira
recepção externa funcional é o webhook da Lastlink, publicado na Railway e
ligado ao armazenamento bruto no Supabase. Os oito eventos confirmados já são
normalizados em identidade, pedidos, pagamentos e atribuição por um worker em
lotes; dados de teste são isolados e não produzem efeito financeiro. As demais fontes previstas são Meta
Ads, Sendflow, Hotwebinar, Datacrazy e formulários próprios.
Rebrandly não faz parte do escopo.

Ambiente publicado:

- Painel: `https://web-production-a818d.up.railway.app`
- API: `https://api-production-682c.up.railway.app`
- Worker: serviço privado contínuo na Railway.

## Desenvolvimento local

Requisitos:

- Node.js 22 ou superior.
- npm 11 ou superior.

Comandos:

```text
npm install
npm run dev
npm run check
npm run db:check
npm run db:verify
```

Aplicações:

- `apps/web`: interface Next.js, porta padrão 3000.
- `apps/api`: API Fastify, porta padrão 3001.
- `apps/worker`: processamento assíncrono.
- `packages/domain`: contratos de domínio compartilhados.

A interface já possui autenticação Supabase por cookies, bootstrap único do
primeiro proprietário, pré-autorização de novos membros por e-mail e papel e
dashboard protegido. Cada novo membro cria a própria senha e confirma o e-mail
pelo fluxo oficial do Supabase.

A Central de Criativos possui a fundação física privada para conexões do Drive,
pastas autorizadas, arquivos observados, ativos no armazenamento próprio,
versões imutáveis e jobs idempotentes. O fluxo OAuth e a seleção explícita de
pastas pelo Google Picker estão implementados e permanecem desligados enquanto
as credenciais do ambiente não forem configuradas. Os adaptadores de R2 e
ClamAV também operam em modo seguro desabilitado sem credenciais; nenhuma
importação ou publicação automática foi habilitada.

Copie `.env.example` para `.env.local` somente quando precisar configurar um
ambiente. Nunca versione segredos reais.

O ambiente de desenvolvimento possui um projeto Supabase remoto vinculado. As
migrações oficiais aplicáveis ao ambiente estão em `supabase/migrations`.
`db:verify` consulta somente a presença das tabelas e políticas esperadas.

A API de ingestão usa imagem Docker própria e healthcheck em `/health`. No
ambiente Railway, conecta ao Supabase pelo pooler de sessão IPv4 e valida TLS
com a CA oficial armazenada em `certs/`.

## Documentação

- [PRD](docs/PRD.md): visão, escopo e requisitos do produto.
- [Glossário](docs/GLOSSARIO.md): linguagem comum do projeto.
- [Regras de negócio](docs/REGRAS_DE_NEGOCIO.md): regras essenciais e casos especiais.
- [Atribuição e jornada](docs/ATRIBUICAO_E_JORNADA.md): identidade, influência e ascensão.
- [Arquitetura](docs/ARQUITETURA.md): desenho técnico proposto.
- [Modelo de dados](docs/MODELO_DE_DADOS.md): entidades e relacionamentos.
- [Integrações](docs/INTEGRACOES.md): fontes externas e responsabilidades.
- [Especificação da ingestão Lastlink](docs/especificacoes/INGESTAO_LASTLINK.md): contratos, segurança, idempotência e normalização propostos.
- [Central de Criativos — Drive — Fase 1](docs/especificacoes/CENTRAL_CRIATIVOS_DRIVE_FASE_1.md): importação manual, OAuth, arquivos e versionamento propostos.
- [Matriz de decisão da Central de Criativos](docs/especificacoes/MATRIZ_DECISAO_CENTRAL_CRIATIVOS_FASE_1.md): OAuth, armazenamento, retenção e antimalware.
- [Eventos e tracking](docs/EVENTOS_E_TRACKING.md): taxonomia de eventos.
- [Métricas](docs/METRICAS.md): definições e fórmulas.
- [Teste A/B](docs/TESTE_AB.md): links inteligentes e experimentação.
- [IA e automações](docs/IA_E_AUTOMACOES.md): análise e operação segura.
- [UX e design system](docs/UX_E_DESIGN_SYSTEM.md): navegação e padrões visuais.
- [Wireframes](docs/WIREFRAMES.md): hierarquia responsiva e estados das telas.
- [Roadmap](docs/ROADMAP.md): fases de entrega.
- [Decisões](docs/DECISOES.md): registro das escolhas relevantes.
- [Contexto para IA](docs/CONTEXTO_PARA_IA.md): resumo para iniciar outra conversa ou agente.
- [Fontes originais](docs/fontes-originais/README.md): arquivos técnicos, logs e conversas usados como evidência.

## Princípios

1. Histórico próprio e permanente.
2. Identidade única do cliente.
3. Métricas explicáveis e reproduzíveis.
4. IA com evidências, limites e auditoria.
5. Integrações idempotentes e observáveis.
6. Interface simples para usuários não técnicos.
