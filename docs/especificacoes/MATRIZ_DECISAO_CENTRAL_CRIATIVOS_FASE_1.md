# Matriz de decisão — Central de Criativos — Gates da Fase 1

Versão: 0.1  
Status: proposta para aprovação  
Data-base: 23/07/2026

## 1. Objetivo

Resolver os cinco gates ainda pendentes da especificação
`CENTRAL_CRIATIVOS_DRIVE_FASE_1.md`:

1. Protótipo de `drive.file` e descendentes.
2. Escopo OAuth definitivo.
3. Armazenamento de objetos.
4. Retenção e exclusão.
5. Tratamento antimalware.

Este documento recomenda decisões. Não implementa a integração nem contrata
serviços.

## 2. Resumo executivo

| Gate | Recomendação |
|---|---|
| OAuth | prototipar `drive.file` + Google Picker; não ampliar escopo silenciosamente |
| Fallback OAuth | se a pasta não funcionar, parar e decidir entre arquivos explícitos ou escopo amplo |
| Metadados | Supabase/PostgreSQL |
| Mídia | Cloudflare R2 Standard, bucket privado |
| Portabilidade | abstração S3 e chaves imutáveis controladas pela aplicação |
| Retenção | preservar publicadas; janela de descarte para não publicadas e quarentena |
| Antimalware | ClamAV em worker isolado, antes de liberar o ativo |
| Arquivos suspeitos | quarentena inacessível; nunca disponibilizar ou processar com IA |

## 3. Critérios e pesos

| Critério | Peso |
|---|---:|
| Segurança, privacidade e isolamento | 30% |
| Adequação a vídeo e histórico próprio | 25% |
| Simplicidade operacional do MVP | 20% |
| Custo previsível | 15% |
| Portabilidade e baixo acoplamento | 10% |

Pontuação de 1 a 5. Os valores orientam a decisão e não substituem teste de
carga, orçamento ou avaliação jurídica.

## 4. Gate 1 — Protótipo OAuth

### Objetivo

Comprovar se `drive.file` com Google Picker permite o fluxo de pasta da Fase 1
sem conceder acesso amplo ao Drive.

### Protótipo obrigatório

Usar uma conta Google de teste e dados fictícios:

```text
Meu Drive
└─ Pasta selecionada
   ├─ imagem
   ├─ vídeo pequeno
   ├─ arquivo TXT
   ├─ Google Docs
   └─ subpasta
      └─ imagem
```

Casos:

1. Autorizar somente `drive.file` e escopos mínimos auxiliares.
2. Selecionar a pasta pelo Google Picker.
3. Consultar metadados da pasta.
4. Listar filhos diretos.
5. Listar descendentes recursivamente.
6. Baixar os arquivos binários.
7. Exportar o Google Docs para DOCX.
8. Adicionar novo arquivo depois da seleção e tentar importá-lo.
9. Mover arquivo para dentro e para fora da pasta.
10. Revogar acesso e confirmar a falha segura.
11. Reconectar sem duplicar a conexão.
12. Confirmar quais recursos o token consegue acessar fora da pasta.

### Critério de sucesso

- Todos os descendentes autorizados são inventariáveis e baixáveis.
- Arquivo futuro dentro da pasta fica acessível por mecanismo documentado.
- Arquivo externo à seleção não é acessível pelo fluxo da aplicação.
- Revogação interrompe novas leituras.
- Nenhuma senha ou token aparece em log.

### Critério de parada

Se `drive.file` não permitir o comportamento recursivo e futuro exigido, o
protótipo para. Não trocar automaticamente para `drive.readonly`.

## 5. Gate 2 — Escopo OAuth

### Opções

| Opção | Privacidade | Pasta recursiva | Verificação | Recomendação |
|---|---|---|---|---|
| `drive.file` + Picker | alta, acesso estreito por arquivo compartilhado com o app | precisa do protótipo | mais simples | preferida |
| Seleção explícita de arquivos | alta | não atende plenamente ao fluxo de pasta | mais simples | fallback temporário |
| Compartilhamento explícito compatível com o app | potencialmente alto | precisa validar experiência | depende da solução | investigar |
| `drive.readonly` + allowlist interna | token acessa todo o Drive legível | atende tecnicamente | escopo restrito e maior obrigação | somente após nova aprovação |

O Google recomenda `drive.file` para acesso estreito e informa que
`drive.readonly` é um escopo restrito. Aplicações que armazenam dados obtidos
por escopos restritos podem precisar de verificação e avaliação de segurança.

Referência:
`https://developers.google.com/workspace/drive/api/guides/api-specific-auth`

### Recomendação

```text
DECISÃO PROPOSTA
→ usar drive.file + Google Picker se o protótipo passar
→ se falhar, não ampliar escopo
→ apresentar nova decisão ao responsável pelo produto
```

### Escopos auxiliares

Qualquer escopo adicional deve:

- Ter finalidade documentada.
- Aparecer na tela de consentimento.
- Ser testado separadamente.
- Ser removido quando não for necessário.

`drive.metadata.readonly` não deve ser adicionado apenas por conveniência, pois
amplia a visibilidade de metadados.

## 6. Gate 3 — Armazenamento de objetos

### Opção A — Supabase Storage

Pontos positivos:

- Stack já aprovada.
- Integração com Postgres e RLS.
- Buckets privados e URLs assinadas.
- REST, uploads resumíveis e compatibilidade S3.
- Operação inicial mais simples.

Limitações:

- Egress acima da franquia é cobrado.
- Não oferece versionamento S3 nativo.
- Compatibilidade S3 é parcial.
- Vídeos, reprodução e leituras por IA podem elevar saída.

Dados oficiais consultados:

- Pro inclui 100 GB de Storage; excedente informado em US$ 0,021/GB-mês.
- Pro inclui 250 GB de egress não cacheado e 250 GB cacheado; excedentes
  informados em US$ 0,09/GB e US$ 0,03/GB.
- O versionamento de objetos S3 não é suportado.

Referências:

- `https://supabase.com/docs/guides/platform/billing-on-supabase`
- `https://supabase.com/docs/guides/platform/manage-your-usage/egress`
- `https://supabase.com/docs/guides/storage/s3/compatibility`

### Opção B — Cloudflare R2 Standard

Pontos positivos:

- Compatível com S3.
- Consistência forte.
- Egress direto sem cobrança.
- Adequado para mídia frequentemente lida.
- Custo de armazenamento simples.
- Facilita migração por interface S3.

Limitações:

- Outro fornecedor na arquitetura.
- Controle de autorização fica na aplicação.
- Não há integração nativa equivalente ao GuardDuty para malware.
- Operações são cobradas por classe.

Dados oficiais consultados:

- Standard: US$ 0,015/GB-mês.
- Class A: US$ 4,50 por milhão.
- Class B: US$ 0,36 por milhão.
- Egress direto: gratuito.
- Free tier mensal: 10 GB, 1 milhão de operações A e 10 milhões de B.

Referências:

- `https://developers.cloudflare.com/r2/pricing/`
- `https://developers.cloudflare.com/r2/how-r2-works/`

### Opção C — Amazon S3

Pontos positivos:

- Ecossistema maduro.
- Controles IAM, versionamento, lifecycle, Object Lock e integrações.
- GuardDuty Malware Protection for S3.
- Grande flexibilidade operacional.

Limitações:

- Maior complexidade de conta, IAM, custos e observabilidade.
- Transferência para internet pode ser cobrada após franquias.
- Preço varia por região, classe, operação e transferência.
- Excesso de capacidades para o MVP.

Referências:

- `https://aws.amazon.com/s3/pricing/`
- `https://docs.aws.amazon.com/guardduty/latest/ug/how-malware-protection-for-s3-gdu-works.html`

### Pontuação

| Opção | Segurança 30% | Adequação 25% | Simplicidade 20% | Custo 15% | Portabilidade 10% | Total |
|---|---:|---:|---:|---:|---:|---:|
| Supabase Storage | 4,0 | 4,0 | 5,0 | 3,5 | 3,5 | 4,08 |
| Cloudflare R2 | 4,0 | 5,0 | 3,5 | 5,0 | 5,0 | 4,40 |
| Amazon S3 | 5,0 | 5,0 | 2,5 | 3,0 | 5,0 | 4,20 |

### Recomendação

```text
Metadados, permissões e auditoria → Supabase/PostgreSQL
Objetos de mídia → Cloudflare R2 Standard privado
Interface de acesso → adaptador S3 interno
Versionamento → chaves imutáveis e tabelas do domínio
```

Razões:

- Vídeos tendem a gerar mais leituras e egress.
- O R2 reduz risco de custo de reprodução e processamento por IA.
- A compatibilidade S3 evita acoplamento total.
- O versionamento já precisa ser governado pelo domínio, independentemente do
  versionamento nativo do fornecedor.

### Plano de reversão

- Nunca armazenar URLs permanentes no domínio.
- Guardar `storage_provider`, bucket, chave, hash e tamanho.
- Usar chaves opacas e imutáveis.
- Implementar operações mínimas comuns: put, head, get stream, signed URL,
  delete controlado e multipart.
- Permitir migração posterior por job auditável.

## 7. Gate 4 — Retenção e exclusão

### Categorias

| Categoria | Retenção recomendada |
|---|---|
| Versão publicada | enquanto houver obrigação operacional/histórica; exclusão somente por processo autorizado |
| Versão aprovada não publicada | enquanto ativa; revisar após arquivamento |
| Criativo importado não aprovado | 365 dias após arquivamento ou desconexão, com aviso |
| Arquivo duplicado sem nova versão | não manter segunda cópia física |
| Temporário de download | remover imediatamente após sucesso ou falha terminal |
| Quarentena sem ameaça confirmada | até 7 dias para reprocessamento |
| Malware confirmado | excluir conteúdo em até 24 horas; preservar somente hash e auditoria |
| Token OAuth revogado | eliminar segredo imediatamente |
| Auditoria de conexão/importação/publicação | 5 anos, sujeita à validação jurídica |

### Desconexão do Drive

```text
revogar token
→ impedir novas importações
→ marcar origens como desconectadas
→ manter versões internas
→ oferecer relatório do que está preservado
→ exclusão é uma ação separada
```

### Exclusão solicitada

Fluxo:

1. Verificar permissão.
2. Exibir impactos em criativos, versões, anúncios e auditoria.
3. Impedir exclusão silenciosa de versão publicada.
4. Criar solicitação auditável.
5. Aplicar retenção legal ou operacional quando existir.
6. Remover objeto e derivados elegíveis.
7. Manter registro mínimo não pessoal da execução.

### Soft delete

Proposta:

- 30 dias de recuperação para arquivos não publicados.
- Objetos permanecem inacessíveis durante a janela.
- Após o prazo, exclusão física idempotente.
- Malware confirmado não usa a janela normal.

### Ponto jurídico

Os prazos são recomendações técnicas. Antes da produção, devem ser validados
com política de privacidade, LGPD, contratos com clientes e direitos sobre os
criativos.

## 8. Gate 5 — Antimalware

### Opção A — ClamAV em worker isolado

Fluxo:

```text
download do Drive
→ bucket/prefixo de quarentena
→ clamd recebe stream
→ resultado
   ├─ clean → promover para área privada de ativos
   ├─ infected → bloquear e excluir conforme política
   ├─ unsupported → revisão/política por formato
   └─ error → manter inacessível e tentar novamente
```

Pontos positivos:

- Open source.
- Não envia o arquivo para serviço público.
- `clamd` funciona como daemon multithread.
- `freshclam` atualiza assinaturas.
- Independente do provedor S3.

Limitações:

- Exige operação, memória e atualização.
- Arquivos grandes consomem recursos.
- Assinaturas não garantem detecção de toda ameaça.
- Precisa de limites contra arquivos compactados maliciosos e decompression
  bombs.

Referências:

- `https://docs.clamav.net/`
- `https://docs.clamav.net/manual/Usage/Scanning.html`
- `https://docs.clamav.net/manual/Usage/ClamdProtocol.html`

### Opção B — AWS GuardDuty Malware Protection for S3

Pontos positivos:

- Serviço gerenciado.
- Escaneia objetos novos.
- Pode marcar resultado no objeto.
- Ambiente isolado na mesma região.
- Pode operar sem o GuardDuty completo.

Limitações:

- Exige Amazon S3.
- Aumenta dependência da AWS.
- Resultados têm entrega pelo menos uma vez e exigem idempotência.
- Custo e IAM adicionais.

Referência:
`https://docs.aws.amazon.com/guardduty/latest/ug/how-malware-protection-for-s3-gdu-works.html`

### Opção C — Serviço público de análise

Não recomendado para criativos privados. O conteúdo pode conter material
confidencial, campanhas ainda não lançadas, dados pessoais ou propriedade
intelectual. Nenhum arquivo deve ser enviado a serviço público sem contrato,
política de privacidade e aprovação específicos.

### Recomendação

```text
FASE 1
→ ClamAV em worker isolado
→ quarentena privada
→ assinaturas atualizadas por freshclam
→ nenhum acesso, preview ou IA antes de resultado clean
```

GuardDuty permanece alternativa se o armazenamento escolhido mudar para S3 ou
se a operação do ClamAV se tornar inadequada.

## 9. Política antimalware proposta

Estados:

```text
pending
scanning
clean
infected
unsupported
failed_retryable
failed_terminal
```

Regras:

- Somente `clean` pode criar ativo disponível.
- `pending`, `scanning` e falhas permanecem inacessíveis.
- `infected` nunca gera preview, transcrição ou análise.
- Nome da ameaça é sanitizado antes de log/exibição.
- Reprocessamento registra versão do engine e das assinaturas.
- Resultado anterior não vale para bytes diferentes.
- Mesmo hash limpo pode reutilizar resultado recente conforme política
  versionada.
- Atualização de assinatura pode motivar nova varredura.
- Teste EICAR é obrigatório em homologação.

Limites de segurança:

- Não aceitar arquivos executáveis na Fase 1.
- Não extrair arquivos compactados enviados pelo Drive.
- Limitar profundidade e tamanho de conteúdo embutido no scanner.
- Timeout e limite de memória por job.
- Scanner sem credencial de produção além do acesso mínimo à quarentena.

## 10. Arquitetura recomendada

```text
Google Drive
→ worker de importação
→ R2 / quarantine
→ ClamAV isolado
→ R2 / assets-private
→ registro de asset + creative_version no Supabase
→ URL assinada para biblioteca
```

Regras:

- Buckets/prefixos de quarentena e ativos são separados.
- O worker web não possui permissão de promover arquivos.
- O scanner não possui acesso ao banco além do necessário para publicar
  resultado por fila/API interna.
- Promoção é cópia idempotente para chave imutável.
- Objeto de quarentena é removido após promoção.

## 11. Custos a medir no piloto

- GB armazenado por mês.
- Arquivos e bytes importados.
- Operações put/get/head/list.
- Egress para usuário, worker e IA.
- Tempo de CPU/memória do ClamAV.
- Custo do worker ocioso e em pico.
- Custo de thumbnails/transcodificação futura.
- Custo de backup ou segunda cópia futura.

Não usar somente o preço por GB para decidir; vídeos podem ser lidos muitas
vezes por prévia, análise e publicação.

## 12. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| `drive.file` não atende pasta futura | gate técnico; não ampliar escopo automaticamente |
| R2 indisponível | retentativa, fila e estado parcial; abstração S3 |
| Token OAuth vazado | criptografia, rotação, logs redigidos e menor escopo |
| Malware antes do scan | quarentena privada e sem preview |
| ClamAV sem assinatura atual | health check bloqueia promoção |
| Vídeo de 2 GB esgota worker | streaming, multipart, timeout e fila dedicada |
| Exclusão apaga histórico publicado | workflow separado e bloqueio por vínculo |
| Custos crescem | métricas, alertas e orçamento por projeto |
| Mesmo conteúdo em vários projetos | isolamento lógico; deduplicação física não concede acesso cruzado |

## 13. Decisões propostas para aprovação

### P-01 — OAuth

Usar `drive.file` + Google Picker somente se o protótipo passar. Qualquer escopo
mais amplo exige nova aprovação.

### P-02 — Armazenamento

Usar Cloudflare R2 Standard privado para mídia e Supabase/PostgreSQL para
metadados, com adaptador S3 interno.

### P-03 — Retenção

Adotar as categorias e janelas desta matriz como política inicial, condicionada
à validação jurídica antes da produção.

### P-04 — Antimalware

Usar ClamAV em worker isolado com quarentena obrigatória. Somente arquivo
`clean` pode ser promovido.

### P-05 — Segurança de arquivos

Não aceitar executáveis ou arquivos compactados na Fase 1 e não enviar criativos
a scanners públicos.

## 14. Próximos passos após aprovação

1. Registrar as decisões aprovadas em `docs/DECISOES.md`.
2. Produzir plano do protótipo OAuth.
3. Criar contratos TypeScript de conexão, pasta, importação e ativo.
4. Transformar o modelo conceitual em schema físico.
5. Criar fixtures e testes de contrato.
6. Só então iniciar a implementação da Fase 1.

