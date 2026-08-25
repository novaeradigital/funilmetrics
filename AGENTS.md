# Instruções para agentes e desenvolvedores

Antes de alterar o produto, leia `README.md`, `docs/PRD.md`, `docs/GLOSSARIO.md`, `docs/REGRAS_DE_NEGOCIO.md` e o documento específico da área afetada.

## Regras permanentes

- Não reduzir a jornada do cliente a uma única campanha, funil ou produto.
- Pessoa, jornada, funil, campanha e evento são conceitos diferentes.
- Preservar dados históricos recebidos; correções devem ser auditáveis.
- Webhooks e sincronizações precisam ser idempotentes.
- Métricas devem seguir `docs/METRICAS.md`.
- Mudanças em campanhas exigem trilha de auditoria e guardrails.
- Não introduzir o Rebrandly no projeto.
- UTMs recebidas da Lastlink devem ser preservadas no dado bruto e normalizado.
- Novas decisões arquiteturais relevantes devem ser registradas em `docs/DECISOES.md`.
- Novos eventos precisam ser documentados em `docs/EVENTOS_E_TRACKING.md`.
- Toda funcionalidade deve incluir estados de carregamento, vazio, erro e falta de permissão.
- Os arquivos de `docs/fontes-originais/` são evidências imutáveis: leia-os quando necessário, mas não os edite.
- Antes de compartilhar logs ou payloads, produza uma cópia anonimizada em `docs/payloads/<fonte>/`.

## Tecnologias propostas

- TypeScript em toda a aplicação.
- Next.js/React para a interface.
- Backend TypeScript modular, inicialmente no mesmo repositório.
- PostgreSQL no Supabase.
- Drizzle ORM.
- Railway para a primeira hospedagem.
- Filas para webhooks, sincronizações, IA e relatórios.

Essas escolhas são propostas aceitas até o momento, mas qualquer alteração deve ser justificada no registro de decisões.
