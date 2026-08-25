# Wireframes operacionais

Versão: 1.0  
Escopo: painel autenticado do Funil Metrics.

Estes wireframes documentam a hierarquia já adotada no produto. Eles não
prescrevem números simulados: cada bloco deve usar dados reais, estado vazio ou
indisponibilidade explícita.

## 1. Estrutura principal — desktop

```text
┌───────────────┬──────────────────────────────────────────────────────────┐
│ Marca         │ Projeto atual                         Estado / Sessão    │
│               ├──────────────────────────────────────────────────────────┤
│ Visão geral   │ Contexto + título                      Período / ação    │
│ Vendas        │ Explicação da fonte, regra, moeda e fuso                │
│ Produtos      ├───────────┬───────────┬───────────┬───────────┤          │
│ Funis         │ KPI 1     │ KPI 2     │ KPI 3     │ KPI 4     │          │
│ Clientes      ├────────────────────────────┬───────────────────┤          │
│ Campanhas     │ Série/tabela principal     │ Resumo/contexto   │          │
│ Criativos     ├────────────────────────────┴───────────────────┤          │
│ Relatórios    │ Tabela, histórico ou próximos passos          │          │
│ Integrações   │                                                │          │
│ Qualidade     │ Fonte · período · versão da regra             │          │
└───────────────┴────────────────────────────────────────────────┘
```

Regras:

- lateral persistente com largura de `15.5rem`;
- barra superior fixa com projeto ativo e ações da sessão;
- conteúdo limitado a `92rem`;
- primeira dobra reserva quatro indicadores quando a visão for executiva;
- tabela ou série ocupa mais espaço que controles secundários.

## 2. Lista e configuração

Usado em projetos, equipe, integrações, funis, domínios e agendas.

```text
┌───────────────────────────────┬──────────────────────────────────┐
│ Criar / configurar            │ Itens existentes                 │
│                               │                                  │
│ Campo                          │ Nome                 STATUS      │
│ Campo                          │ Contexto                         │
│ Campo                          │ Última atividade                 │
│ [Salvar]                       │ [Detalhes] [Ação permitida]      │
│                               │                                  │
│ Ajuda e guardrail              │ Estado vazio ou próxima linha   │
└───────────────────────────────┴──────────────────────────────────┘
```

- Segredos usam entrada mascarada e nunca são reapresentados.
- Ações destrutivas ou externas não compartilham o botão primário.
- Falta de permissão substitui o formulário; não revela dados restritos.

## 3. Biblioteca de criativos

```text
┌──────────────────────────────────────────────────────────────────┐
│ Busca | status | tipo | pasta | tags | limpar                   │
├──────────────┬──────────────┬──────────────┬──────────────┤      │
│ Prévia       │ Prévia       │ Prévia       │ Prévia       │      │
│ status vN    │ status vN    │ status vN    │ status vN    │      │
│ nome         │ nome         │ nome         │ nome         │      │
│ origem/tipo  │ origem/tipo  │ origem/tipo  │ origem/tipo  │      │
│ detalhes     │ detalhes     │ detalhes     │ detalhes     │      │
└──────────────┴──────────────┴──────────────┴──────────────┘      │
```

- O card representa a versão atual, nunca substitui o histórico.
- Vídeo é reproduzido por rota autenticada e armazenamento privado.
- Prévia indisponível preserva metadados e explica a causa.

## 4. Detalhe e histórico

```text
┌────────────────────────────────────┬─────────────────────────────┐
│ Mídia / reprodução                 │ Versão atual                │
│                                    │ origem, tipo, tamanho       │
│                                    │ hash, antimalware, status   │
├────────────────────────────────────┴─────────────────────────────┤
│ Processamento assistido: transcrição, extração, análise          │
├──────────────────────────────────────────────────────────────────┤
│ Histórico imutável de versões                                    │
├──────────────────────────────────────────────────────────────────┤
│ Copy, CTA, destino, tags e observações                           │
├──────────────────────────────────────────────────────────────────┤
│ Aprovações, publicações e auditoria                              │
└──────────────────────────────────────────────────────────────────┘
```

## 5. Mobile

```text
┌────────────────────────────┐
│ Projeto atual       Sessão │
├────────────────────────────┤
│ Título e contexto          │
│ [período rolável]          │
│ KPI 1                      │
│ KPI 2                      │
│ Gráfico / tabela rolável   │
│ Cards em uma coluna        │
├────────────────────────────┤
│  ⌂   ◇   ▦   ⇄   ○        │
└────────────────────────────┘
```

- Até `760px`, navegação vira barra inferior.
- Grades executiva e analítica passam para uma coluna.
- Filtros passam para uma coluna; períodos permitem rolagem horizontal.
- Conteúdo recebe espaço inferior para não ficar oculto pela navegação.

## 6. Estados obrigatórios

| Estado | Tratamento |
|---|---|
| Carregando | skeleton ou texto de progresso sem deslocamento destrutivo |
| Vazio | explica o que falta e apresenta próxima ação válida |
| Sem permissão | informa o papel necessário sem revelar o conteúdo |
| Erro recuperável | mensagem sanitizada e opção de tentar novamente |
| Integração ausente | bloqueio explícito com link para configuração |
| Dado parcial | mantém fatos disponíveis e identifica a limitação |
| Filtro sem resultado | preserva filtros e oferece limpeza |
| Ação externa pendente | mostra aprovação, alvo e guardrails |

## 7. Critérios de aceite visual

- foco de teclado visível;
- contraste mínimo compatível com WCAG AA;
- significado não depende somente de cor;
- números financeiros usam algarismos tabulares;
- status, fonte, período e versão da regra permanecem legíveis;
- nenhuma tela usa dados fictícios para preencher estado vazio;
- tabelas mantêm cabeçalhos e rolagem utilizável em telas estreitas.
