# IA e automações

## Composição assistida de dashboards

A assistência recebe um objetivo textual e somente o catálogo governado de
métricas. A resposta usa schema estrito e é novamente validada no servidor:
título, período, visualização, métrica e largura precisam estar nas listas
permitidas.

- A saída sempre cria um novo dashboard em `draft`.
- Nenhuma sugestão publica, compartilha ou altera dashboards existentes.
- O usuário revisa filtros, widgets e layout antes de publicar.
- Prompt, proposta, modelo e tokens ficam registrados por projeto.
- O limite mensal configurado para OpenAI é verificado antes da chamada.
- Falta de credencial, limite atingido ou resposta inválida produz falha segura,
  sem criar um dashboard parcial.

## Fundação da Central de Criativos

Jobs separados cobrem `transcription`, `text_extraction` e `analysis`.
Resultados referenciam a versão exata e preservam modelo, prompt, evidências e
confiança. A análise estruturada deve cobrir gancho, promessa, mecanismo, prova,
objeções, CTA, estrutura e hipóteses de desempenho.

A execução começa desabilitada. Exige chave de API, modelo explicitamente
configurado, orçamento/limites e worker habilitado. O modelo de transcrição
proposto é `gpt-4o-transcribe`; o modelo de análise não é fixado silenciosamente
e deve ser configurado conforme custo e qualidade. Nenhum resultado de IA
equivale a aprovação humana.

## Princípio

A IA interpreta dados governados e fornece evidências. Ela não deve executar SQL irrestrito nem alterar campanhas sem política explícita.

## Capacidades

- Responder perguntas sobre campanhas, jornada, produtos e LTV.
- Encontrar anomalias e mudanças relevantes.
- Explicar criativos e padrões vencedores.
- Transcrever vídeos e extrair texto de imagens, arquivos e documentos.
- Classificar gancho, promessa, mecanismo, prova, objeções, CTA e estrutura.
- Sugerir tags, resumo, riscos, hipóteses e campos ausentes para conferência.
- Gerar debriefing de lançamento.
- Produzir relatórios diários e semanais.
- Recomendar pausa, orçamento e novos testes.
- Produzir briefing e variações de criativos.

O debriefing inicial é determinístico e não usa IA: consolida métricas
governadas, evidencia cobertura e lista limitações. Interpretações causais e
hipóteses futuras deverão permanecer separadas dos fatos observados.

## Central de Criativos

### Entrada

A IA analisa uma versão imutável do criativo e seus ativos copiados para o
armazenamento próprio, nunca apenas um link mutável do Drive.

Entradas possíveis:

- Imagem ou frames selecionados.
- Áudio e transcrição de vídeo.
- Texto extraído.
- Copy, headline, CTA, destino e observações.
- Produto, marca, público, campanha e objetivo quando informados.
- Métricas governadas de anúncios que usaram aquela versão.

### Saída estruturada

- Resumo.
- Gancho.
- Promessa.
- Mecanismo.
- Provas.
- Objeções tratadas.
- CTA.
- Estrutura/sequência.
- Tags sugeridas.
- Hipóteses de desempenho.
- Riscos de política, afirmações sensíveis ou informação ausente.
- Confiança e limitações por item.
- Modelo, versão, prompt e versão do criativo analisada.

Campos gerados pela IA permanecem distintos de campos confirmados por uma
pessoa. Correção humana não apaga a saída original; cria revisão auditável.

### Processamento

- Transcrição, extração, classificação e análise são jobs separados,
  idempotentes e reprocessáveis.
- TXT e documentos Google exportados como DOCX usam extração local
  determinística (`local-extractor-v1`); essa etapa não consome IA paga.
- Nova versão do arquivo exige nova análise; não herda silenciosamente conclusões
  da versão anterior.
- Falha de IA não impede a importação ou consulta do criativo.
- Arquivo ausente, corrompido ou incompatível produz estado de erro explícito.

## Estrutura de uma resposta

- Conclusão.
- Período e filtros.
- Métricas usadas.
- Evidências e links para as telas.
- Hipóteses separadas de fatos.
- Confiança e limitações.
- Ação recomendada.

O assistente v1 traduz linguagem natural apenas para intenções permitidas de
receita, vendas, cobertura de UTMs e campanhas. Cada intenção executa SQL
pré-definido na camada de métricas, informa período e limitações e oferece link
para a evidência. Perguntas fora desse catálogo são recusadas; não existe SQL
gerado pelo modelo nem consumo de IA paga nesta etapa.

## Níveis de autonomia

1. Observação.
2. Recomendação.
3. Preparação de ação.
4. Execução após aprovação.
5. Automação limitada por política.

O nível 5 não faz parte do MVP.

Na Central de Criativos:

- Importação e análise ficam nos níveis 1 e 2.
- Preparação de publicação fica no nível 3.
- Envio à Meta Ads fica no nível 4.
- Entrada no Drive nunca dispara publicação ou nível 4 automaticamente.

## Guardrails

- Amostra mínima.
- Dados recentes e integrações saudáveis.
- Limite monetário e percentual.
- Máximo de alterações por período.
- Aprovação para ações importantes.
- Aprovação vinculada à versão exata do criativo e à prévia de publicação.
- Nenhuma troca silenciosa de mídia, copy, destino, conta, público ou orçamento
  depois da aprovação.
- Lista de contas/campanhas permitidas.
- Horário e janela de observação.
- Auditoria completa.
- Mecanismo de interrupção.

## Anomalias operacionais

A regra `sales_volume_anomaly_v1` compara pedidos distintos das últimas 24
horas com a média diária dos sete dias anteriores que tiveram observação. O
sinal somente é aberto quando existem pelo menos quatro dias observados, média
de pelo menos três pedidos por dia, dez pedidos no período atual e aumento de
pelo menos três vezes. Ele é informativo, preserva a evidência usada, resolve
idempotentemente quando a condição deixa de existir e não aciona campanhas.

## Auditoria

Registrar:

- Modelo e versão.
- Prompt/instrução relevante.
- Dados e métricas consultados.
- Recomendação.
- Aprovação ou rejeição.
- Estado antes/depois.
- Resposta da plataforma externa.
- ID da versão do criativo.
- Conta, campanha, público, destino, orçamento e prévia aprovados.
- IDs retornados pela Meta e vínculo com o anúncio publicado.

## Privacidade

- Minimizar dados pessoais enviados a modelos.
- Redigir/mascarar campos quando possível.
- Controlar retenção.
- Separar dados entre organizações.
## Estado implementado — transcrição assistida

- Solicitação manual por versão de vídeo, restrita a owner, administrador ou editor.
- Fila idempotente em `creative_ai_jobs`.
- Cópia privada lida do R2 somente após estado limpo do antimalware.
- Extração temporária de áudio com FFmpeg antes do envio à OpenAI.
- Resultado preservado em `creative_transcripts`, ligado ao job e à versão.
- Retentativas limitadas e estados `pending`, `processing`,
  `failed_retryable`, `failed_terminal` e `completed`.
- O limite mensal configurado permanece como guardrail administrativo; a
  contabilização usa o preço vigente do projeto. Ao atingir o limite, novos
  jobs param antes da chamada externa com erro explícito e podem ser
  reprocessados depois de uma decisão administrativa.
- Não há envio automático por importação do Drive nem publicação automática.

## Análise criativa com desempenho observado

- Métricas Meta entram no prompt somente quando anúncios foram ligados
  explicitamente a uma versão da biblioteca.
- CTR, CPC, investimento e entrega são contexto observado; relações com gancho,
  promessa ou estrutura devem ser descritas apenas como hipóteses.
- A chave idempotente inclui um fingerprint do recorte de métricas, permitindo
  nova análise quando o desempenho sincronizado realmente mudar.
