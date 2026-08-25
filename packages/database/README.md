# Banco de dados

Schema PostgreSQL do Funil Metrics, mantido com Drizzle ORM.

## Conteúdo inicial

- `organizations`: isolamento principal.
- `projects`: marcas, operações ou unidades dentro da organização.
- `users`: perfil interno ligado futuramente ao Supabase Auth.
- `memberships`: papel do usuário na organização.
- `project_memberships`: restrição e possível papel específico por projeto.
- `audit_logs`: registro imutável de ações relevantes.

As chaves compostas de `project_memberships` impedem relacionar membros e
projetos de organizações diferentes.

## Comandos

```text
npm run db:generate
npm run db:check
```

Gerar uma migração não a aplica automaticamente. A aplicação em Supabase será
configurada quando houver um projeto e uma `DATABASE_URL` próprios para o
ambiente.
