# PRD — Plataforma de Inteligência de Funis e Jornada

Versão: 1.1  
Status: aprovado como base do produto  
Data-base: 23/07/2026  
Responsável pelo produto: Fabio

## 1. Visão

Criar uma plataforma própria que centralize aquisição, comportamento, vendas e relacionamento. O produto deve mostrar não apenas qual anúncio gerou uma venda, mas como uma pessoa evoluiu entre diferentes campanhas, funis e produtos ao longo do tempo.

## 2. Problema

Dados relevantes estão distribuídos entre anúncios, páginas, formulários, WhatsApp, webinars e plataformas de pagamento. As ferramentas normalmente analisam cada campanha ou produto isoladamente, perdem contexto quando uma conta é bloqueada e não revelam adequadamente a ascensão do cliente.

## 3. Proposta de valor

> Acompanhar cada cliente desde o primeiro anúncio até a última compra, preservando o histórico e transformando dados em decisões e ações seguras.

## 3.1 Posicionamento

O produto não será apenas um painel de anúncios nem um clone do VK Metrics. Será uma plataforma própria de inteligência de aquisição, comportamento, vendas e ascensão, construída inicialmente para a operação do responsável pelo produto e preparada para futuramente atender outras organizações.

## 4. Usuários

- Dono ou gestor do negócio.
- Gestor de tráfego.
- Estrategista de funil ou lançamento.
- Analista de dados.
- Equipe comercial e atendimento.
- Cliente de agência, com acesso restrito.
- Administrador técnico.

## 5. Objetivos

- Centralizar informações de tráfego, leads, comportamento e pagamentos.
- Criar uma identidade única e uma linha do tempo por pessoa.
- Medir aquisição, conversão, ascensão e LTV.
- Preservar dados mesmo após perda de acesso a contas de anúncio.
- Identificar criativos vencedores e explicar seus padrões.
- Centralizar criativos vindos de pastas autorizadas do Google Drive, com cópia
  própria, versões, análise e aprovação.
- Comparar perpétuo, lançamento e jornadas híbridas.
- Permitir testes A/B por conversão, receita e LTV.
- Gerar alertas, relatórios, diagnósticos e recomendações por IA.
- Futuramente operar anúncios com limites, aprovação e auditoria.

## 6. Escopo funcional

### Gestão de projetos

- Proprietários e administradores podem criar projetos na organização.
- O projeto ativo é selecionado explicitamente e persistido por navegador.
- Visão geral, integrações, webhooks e criativos usam o projeto ativo como
  parte obrigatória do escopo.
- Trocar de projeto não copia credenciais, tokens, contas, pastas ou dados.

### 6.1 Dados e identidade

- Receber webhooks e sincronizar APIs.
- Guardar payload bruto e representação normalizada.
- Deduplicar eventos.
- Resolver identidades por identificadores disponíveis.
- Manter histórico de alterações e falhas.

### 6.2 Jornada

- Linha do tempo do visitante/lead/cliente.
- Passagem por múltiplos funis.
- Compras, reembolsos, webinars, mensagens e comportamento.
- Ascensão entre produtos.
- Atribuição direta, assistida, primeiro e último toque.

### 6.3 Dashboards

- Executivo.
- Campanhas e anúncios.
- Criativos.
- Perpétuo.
- Lançamento.
- Jornada híbrida.
- VSL e webinar.
- Produtos e receita.
- Qualidade dos dados e integrações.

### 6.4 Criativos

- Central de Criativos integrada a uma ou mais pastas autorizadas do Google
  Drive por OAuth, sem compartilhamento de senha.
- Suporte a múltiplas pastas por organização, projeto, marca e produto.
- Importação de imagem, vídeo, texto e documentos do Google compatíveis.
- Detecção de arquivos novos, alterados, movidos ou removidos.
- Sincronização manual e automática, com estado, checkpoint e reprocessamento.
- Preservação de ID, nome, pasta, tipo, tamanho e data de modificação do Drive.
- Cópia autorizada e versionada em armazenamento próprio.
- Separação entre criativo, arquivo de origem, versão do criativo e anúncio
  publicado.
- Uma alteração no Drive cria nova versão e nunca substitui silenciosamente uma
  versão publicada.
- Exibir imagem, thumbnail ou reprodução de vídeo.
- Guardar copy, headline, CTA, destino, observações, texto extraído e
  transcrição.
- Tags manuais e por IA.
- Analisar gancho, promessa, mecanismo, prova, objeções, CTA, estrutura e
  hipóteses de desempenho.
- Relacionar desempenho, público, campanha, venda e LTV.
- Detectar fadiga e manter histórico mesmo se a conta cair.
- Explicar estrutura, elementos e hipóteses do desempenho.
- Fluxo de conferência, aprovação humana e preparação para publicação.
- Publicação assistida futura na Meta Ads, com seleção de conta, campanha,
  público, destino e orçamento, seguida de prévia e aprovação.
- Registrar IDs retornados pela Meta, autor, aprovador, configuração publicada,
  resposta externa e histórico posterior.
- Nunca publicar automaticamente apenas porque um arquivo entrou no Drive.

### 6.5 Experimentação

- Links inteligentes em domínio padrão ou personalizado.
- Split ponderado e persistência da variante.
- Preservação das UTMs e identificadores.
- Conversões intermediárias e finais.
- Avaliação por receita, reembolso, ascensão e LTV.

### 6.6 IA e operação

- Perguntas em linguagem natural.
- Diagnósticos com evidências.
- Recomendações de orçamento, pausa e criativos.
- Execução futura com aprovação e limites.
- Auditoria e reversão quando tecnicamente possível.

### 6.7 Integrações e qualidade dos dados

- Painel com estado, última sincronização, atraso e erros de cada integração.
- Recepção de webhooks com idempotência e possibilidade de reprocessamento.
- Reconciliação entre pagamentos, receita atribuída e métricas de anúncios.
- Alertas para UTMs ausentes, dados incompletos, credenciais vencidas e divergências.
- Importação histórica quando a API ou a fonte permitir.
- Preservação do payload original para auditoria.
- Alertas para arquivo ausente, formato inválido, tamanho incompatível,
  permissão removida e falha de sincronização do Drive.
- O Drive é fonte de entrada e organização, não dependência permanente para
  exibição de versões já importadas.

### 6.8 Usuários, organizações e projetos

- Uma organização pode possuir um ou mais projetos.
- Projetos podem representar marcas, experts, operações ou unidades de negócio.
- Papéis iniciais: proprietário, administrador, editor, analista e visualizador.
- Permissões podem limitar projetos, dashboards e ações.
- Ações críticas e exportações devem ser auditadas.

### 6.9 Relatórios e alertas

- Relatório diário e semanal.
- Alertas de venda, queda de conversão, aumento de custo, fadiga e falha de integração.
- Entrega inicial por interface e canal externo a definir.
- Cada alerta deve informar evidência, impacto e recomendação.

## 7. Requisitos não funcionais

- Segurança por organização e projeto.
- Criptografia de credenciais.
- Privacidade e base legal compatíveis com LGPD.
- Idempotência em todas as entradas.
- Observabilidade de webhooks e sincronizações.
- Backup e recuperação testados.
- Interface responsiva e não técnica.
- Cálculos reproduzíveis e versionados.
- Arquivos importados e suas versões devem possuir integridade verificável.
- Escala inicial confortável para pelo menos 8 mil vendas/mês, sem modelagem que impeça crescimento.

## 8. Fora do MVP

- Autopiloto irrestrito de campanhas.
- Editor visual completo de páginas.
- Aplicativo móvel nativo.
- Todas as redes de anúncios e gateways do mercado.
- Modelos estatísticos avançados sem volume mínimo.
- Google Ads e integrações não listadas como fontes iniciais.
- Publicação automática de criativos ou campanhas sem revisão humana.
- Modelos livres de campanha e automações controladas da Central de Criativos,
  até as fases específicas do roadmap.
- Aplicação comercial multicliente completa, cobrança e planos.

## 9. Métricas de sucesso

- Percentual de vendas ligadas a uma pessoa e origem.
- Cobertura de UTMs.
- Divergência entre gateway e receita registrada.
- Latência dos dados.
- Taxa de webhooks processados sem intervenção.
- Tempo economizado na criação de relatórios.
- Número de decisões apoiadas por evidência.
- Receita e LTV identificados como ascensão.
- Percentual de eventos processados sem duplicidade.
- Percentual de jornadas com identidade confiável.
- Tempo entre o evento na origem e sua disponibilidade no dashboard.
- Percentual de arquivos do Drive importados sem intervenção.
- Tempo entre detecção, análise e aprovação de um criativo.
- Percentual de criativos publicados com versão, aprovação e IDs externos
  rastreáveis.

## 10. Critérios gerais de aceite

- O mesmo evento não pode gerar duas vendas por reprocessamento.
- Uma compra posterior deve aparecer na jornada anterior da pessoa quando houver identidade confiável.
- Dados históricos não podem depender da disponibilidade futura da conta de anúncios.
- Toda métrica deve ter definição, período, fonte e regra de cálculo acessíveis.
- Toda ação externa deve guardar autor, motivo, antes, depois e resultado.
- Uma pessoa deve poder atravessar perpétuo, webinar e lançamento sem perder a origem ou dividir artificialmente seu histórico.
- Um criativo deve continuar consultável mesmo após indisponibilidade da conta de anúncios, respeitando as permissões da plataforma de origem.
- Um teste A/B deve preservar UTMs, manter o visitante na variante e relacionar vendas futuras quando houver identidade suficiente.
- Falhas de integração devem ficar visíveis e permitir reprocessamento seguro.
- Um arquivo alterado no Drive deve criar nova versão sem modificar a versão
  anteriormente publicada.
- Um arquivo removido ou com permissão revogada no Drive deve continuar
  consultável quando sua cópia autorizada já existir no armazenamento próprio.
- Nenhum criativo pode chegar à Meta Ads sem prévia, permissão e aprovação
  humana registradas.
- Um criativo deve poder ser relacionado a vários anúncios e campanhas sem ser
  duplicado como conceito.

## 11. Premissas aprovadas

- TypeScript será a linguagem principal.
- Next.js/React será usado na aplicação web.
- Supabase/PostgreSQL será o banco principal.
- Drizzle ORM será usado para schema, migrações e acesso tipado.
- Railway será a hospedagem inicial das aplicações e workers.
- Rebrandly não será utilizado.
- UTMs disponíveis na Lastlink serão preservadas.
- A primeira versão do teste A/B usará links inteligentes.
- Será possível conectar múltiplos domínios personalizados.
- O volume inicial informado é de aproximadamente 8 mil vendas por mês.
- A aplicação começará com leitura e análise de anúncios antes de permitir alterações.
- Google Drive será fonte oficial da Central de Criativos por OAuth e pastas
  explicitamente autorizadas.
- Criativos importados terão cópia e versões próprias quando a autorização da
  fonte permitir.
- A experiência visual usará como referência dominante o sistema demonstrado
  no vídeo analisado em 27/07/2026, buscando alta proximidade perceptiva e
  funcional nas telas equivalentes, com marca, ativos, código e regras próprios.

## 12. Decisões operacionais padrão

Estas decisões orientam o início do desenvolvimento e podem ser alteradas de forma versionada:

- A jornada da pessoa é permanente; filtros de período alteram a visualização, não apagam fatos.
- Toda atribuição exibirá o modelo e a janela utilizados.
- Primeiro toque, último toque e conversão assistida estarão disponíveis como leituras separadas.
- Lead scoring será explicável e versionado.
- Receita bruta e líquida serão exibidas separadamente.
- Reembolsos e chargebacks não apagarão compras.
- Ações em anúncios exigirão aprovação humana até que políticas específicas sejam aprovadas.
- Importação, análise, aprovação e publicação de criativos são etapas separadas.
- Experimentos não terão vencedor automático sem volume mínimo e regra estatística definida.

## 13. Dependências para iniciar a implementação

- Validar exemplos reais e anonimizados dos payloads da Lastlink.
- Confirmar APIs, webhooks e permissões de Meta Ads, Sendflow, Hotwebinar e Datacrazy.
- Confirmar escopos OAuth, limites, notificações e exportação de documentos da
  API do Google Drive.
- Definir armazenamento de objetos, limites de mídia e política de retenção.
- Criar o mapa de telas e aprovar a direção visual.
- Transformar o modelo conceitual em schema físico.
- Definir ambientes de desenvolvimento, homologação e produção.

Essas dependências não impedem a aprovação do produto; elas refinam contratos técnicos antes da implementação.

## 14. Questões que permanecem configuráveis

- Nome comercial.
- Janelas padrão de atribuição.
- Moeda e fuso padrão por projeto.
- Canal inicial dos relatórios automáticos.
- Política de retenção por categoria de evento.
- Fórmula e volume mínimo para fadiga, vencedor e experimentos.
- Regras comerciais de planos e limites, caso o sistema se torne SaaS.
- Frequência padrão de sincronização do Drive.
- Formatos, codecs e tamanhos máximos por canal de publicação.
- Papéis autorizados a aprovar criativos e solicitar publicação.
- Política para remoção no Drive, retenção da cópia própria e direito de
  exclusão.

## 15. Aprovação

Este PRD versão 1.1 consolida a visão aprovada durante a descoberta e incorpora
a Central de Criativos. Detalhes técnicos e fórmulas evoluem nos documentos
especializados, sem alterar o diferencial central: histórico próprio, identidade
única, jornada híbrida, atribuição explicável, ascensão e operação segura.
