# Contexto resumido para outra IA

## O projeto

Estamos criando uma plataforma de inteligência de marketing e vendas para infoprodutos. Ela consolida anúncios, leads, páginas, mensagens, webinars e pagamentos. O diferencial central é acompanhar uma pessoa por toda a jornada, inclusive quando ela atravessa funis diferentes e compra produtos posteriores.

## Exemplo essencial

```text
Lead entra pelo Criativo X
→ compra low ticket no perpétuo
→ recebe mensagens
→ participa de webinar ao vivo
→ compra Produto Y
→ entra em mentoria
```

O sistema precisa preservar a origem inicial, registrar influências intermediárias, atribuir cada venda e calcular o LTV acumulado.

## Conceitos obrigatórios

- Pessoa possui jornada única.
- Funil, campanha, lançamento e pessoa são conceitos separados.
- Jornada híbrida atravessa múltiplos modelos de funil.
- Conversão direta e assistida aparecem separadamente.
- Histórico fica salvo mesmo se uma conta de anúncio cair.
- Métricas e IA devem ser explicáveis.

## Fontes iniciais

- Lastlink: vendas, produtos, pagamentos e UTMs.
- Meta Ads: campanhas, anúncios, criativos e métricas.
- Sendflow: comunicação.
- Hotwebinar: webinar.
- Datacrazy: escopo a validar.
- Formulários próprios.
- Google Drive: fonte autorizada da Central de Criativos.

Rebrandly não faz parte do projeto.

## Módulos

- Dashboards executivo, campanhas, perpétuo, lançamento e híbrido.
- Pessoas, jornadas e ascensão.
- Central de Criativos integrada ao Google Drive, com cópia própria,
  versionamento, transcrição, tags, análise por IA e aprovação humana.
- Testes A/B por links inteligentes e domínios personalizados.
- Lead scoring e pesquisa de persona.
- VSL e webinar.
- Relatórios e alertas.
- Assistente para conversar com dados.
- Futuras ações em anúncios com aprovação e auditoria.
- Publicação assistida futura na Meta Ads usando uma versão aprovada e uma
  prévia explícita.

## Central de Criativos

Fluxo:

```text
Google Drive autorizado
→ detectar novo/alterado/movido/removido
→ importar e copiar para armazenamento próprio
→ criar versão imutável
→ transcrever, extrair texto e analisar com IA
→ conferir e aprovar
→ preparar conta, campanha, público, destino e orçamento
→ gerar prévia e aprovar ação
→ publicar na Meta e guardar IDs
→ acompanhar desempenho e histórico
```

Conceitos obrigatoriamente separados:

- Pasta e arquivo no Drive.
- Ativo armazenado pelo Funil Metrics.
- Criativo.
- Versão do criativo.
- Aprovação.
- Solicitação de publicação.
- Anúncio publicado.

Entrada no Drive nunca autoriza publicação. Alteração na origem nunca substitui
silenciosamente uma versão publicada. O histórico deve continuar disponível
quando o Drive ou a Meta ficarem indisponíveis, dentro das permissões e políticas
de retenção.

## Tecnologia proposta

- TypeScript.
- Next.js/React.
- Backend TypeScript modular.
- Supabase/PostgreSQL.
- Drizzle ORM.
- Railway inicialmente.
- Workers e filas para tarefas assíncronas.
- Armazenamento de objetos para mídia e versões de criativos.

## Estado

O MVP técnico está em desenvolvimento e já possui autenticação, ingestão e
normalização Lastlink, dashboards, qualidade, alertas e administração inicial
de equipe. Regras ainda não confirmadas continuam explicitamente pendentes.

A Central de Criativos foi aprovada como funcionalidade oficial e sua fundação
física privada já existe: conexão, pasta, arquivo observado, ativo, criativo,
versão e jobs de importação idempotentes. A integração OAuth com Google Drive,
o adaptador R2, o ClamAV, a importação real e a publicação na Meta ainda não
foram habilitados.

## Como trabalhar

Leia o `README.md`, o `AGENTS.md` e os documentos em `docs/`. Não invente regras ausentes: marque pressupostos e registre decisões relevantes. Não trate dashboards isolados como fonte da verdade; a fonte são eventos normalizados, identidade e regras versionadas.
