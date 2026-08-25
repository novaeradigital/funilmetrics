# Regras de negócio

## 1. Princípios

1. Eventos recebidos são preservados.
2. O dado bruto nunca é silenciosamente reescrito.
3. Normalizações e correções são versionadas.
4. Pessoa, funil e campanha não são a mesma entidade.
5. Toda conclusão deve poder apontar para os dados que a sustentam.

## 2. Identidade

- E-mail e telefone normalizados são sinais fortes de identidade.
- IDs da plataforma, cookies e click IDs são sinais adicionais.
- Uma união automática só ocorre com confiança suficiente.
- Uniões ambíguas devem ficar pendentes ou ser revisadas.
- Toda fusão de pessoas precisa ser auditável e reversível.
- Nunca separar leads e clientes em históricos independentes.

## 3. Eventos e duplicidade

- Usar o ID externo do evento quando disponível.
- Sem ID externo, produzir chave idempotente determinística com fonte, tipo, entidade, instante e campos estáveis.
- Reentrega de webhook atualiza o processamento, não cria novo fato.
- Payload inválido vai para quarentena, sem descarte.

## 4. Pedidos e pagamentos

- Pedido, transação e evento de pagamento são entidades diferentes.
- Uma compra só conta como receita aprovada nos estados configurados.
- Reembolso e chargeback reduzem receita líquida, sem apagar a compra original.
- Mudanças de status preservam o histórico.
- Order bump e upsell devem permanecer ligados ao pedido e também à pessoa.

## 5. Jornada híbrida

- A pessoa mantém uma única jornada.
- Cada evento pode pertencer a um funil, campanha, sessão de webinar ou experimento.
- A aquisição inicial não é apagada quando a pessoa entra em outro funil.
- Uma compra posterior pode ter uma origem de aquisição e influências intermediárias diferentes.

## 6. Atribuição

- Guardar todos os touchpoints elegíveis.
- Exibir separadamente crédito direto e assistência.
- Não sobrescrever a origem original do cliente.
- A regra de atribuição e sua versão acompanham cada resultado calculado.
- Janelas e prioridades são configuráveis por projeto.

## 7. Testes A/B

- A designação da variante deve ser persistente.
- UTMs e identificadores devem ser preservados no redirecionamento.
- Bots identificados não entram na análise principal.
- Não declarar vencedor apenas por diferença aparente.
- Resultado deve considerar volume, período, significância, receita e LTV.
- Mudanças de peso durante o teste são registradas.

## 8. Lead scoring

- Score precisa informar versão, fatores e contribuição de cada fator.
- Score comportamental pode cair com o tempo.
- Compra e reembolso não podem ser tratados como simples respostas de formulário.
- Modelos treinados com histórico devem registrar período e população utilizados.

## 9. Criativos

- Criativo e anúncio são separados para consolidar reutilizações.
- Arquivo de origem, ativo importado, versão do criativo e anúncio publicado são
  entidades separadas.
- Mídia deve ser copiada para armazenamento próprio quando permitido.
- O Drive é fonte de entrada e organização, não armazenamento permanente do
  histórico do produto.
- Alteração de arquivo cria uma nova versão; nunca reescreve silenciosamente uma
  versão publicada.
- Movimento ou remoção no Drive atualiza o estado da origem, sem apagar a cópia
  histórica autorizada.
- Um criativo pode ter vários arquivos e versões e ser usado em vários anúncios
  e campanhas.
- Importação não implica aprovação; aprovação não implica publicação.
- Nenhum arquivo é publicado automaticamente por ter entrado em pasta
  sincronizada.
- Publicação exige versão imutável, prévia, permissão, aprovação humana e
  auditoria.
- “Vencedor” depende de objetivo, janela, volume mínimo e métrica.
- Fadiga combina frequência, tendência, custo e queda de conversão; não depende de um único número.

## 10. Operação de anúncios

- Leitura não autoriza alteração.
- Recomendações não são executadas automaticamente por padrão.
- Ações externas exigem permissão, limites e trilha de auditoria.
- Regras não atuam com dados atrasados, integração degradada ou amostra insuficiente.
- Alterações de orçamento respeitam limite percentual e monetário por período.

## 11. Qualidade

- Mostrar última sincronização por fonte.
- Alertar sobre UTM ausente, integração atrasada, divergência de receita e duplicidade.
- Diferenciar zero real, dado ausente e dado ainda não processado.
