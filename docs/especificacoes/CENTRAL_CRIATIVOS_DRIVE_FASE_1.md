# Especificação técnica — Central de Criativos e Google Drive — Fase 1

Versão: 1.1  
Status: implementada; operação externa ainda depende das credenciais do ambiente  
Data: 23/07/2026

## 1. Objetivo

Permitir que um usuário autorizado conecte sua conta Google, escolha uma pasta
do Meu Drive e execute uma importação manual para a Central de Criativos.

Cada arquivo compatível deve:

1. Ter seus metadados de origem registrados.
2. Ser baixado ou exportado com autorização.
3. Receber hash e cópia no armazenamento próprio.
4. Ser ligado a um criativo.
5. Criar a primeira versão imutável desse criativo.
6. Permanecer consultável sem depender da disponibilidade futura do Drive.

Esta fase não inclui sincronização automática, análise por IA, aprovação
editorial ou publicação na Meta Ads.

## 2. Documentos relacionados

- `docs/PRD.md`
- `docs/REGRAS_DE_NEGOCIO.md`
- `docs/ARQUITETURA.md`
- `docs/INTEGRACOES.md`
- `docs/MODELO_DE_DADOS.md`
- `docs/UX_E_DESIGN_SYSTEM.md`
- `docs/EVENTOS_E_TRACKING.md`
- `docs/DECISOES.md`

## 3. Escopo aprovado para especificação

### Incluído

- OAuth oficial do Google.
- Meu Drive.
- Seleção manual de uma pasta por execução.
- Cadastro de várias pastas ao longo do tempo.
- Importação recursiva da pasta escolhida.
- Imagens, vídeos, arquivos `.txt` e Google Docs.
- Associação da pasta a organização e projeto.
- Associação opcional a marca e produto.
- Inventário e prévia antes da importação.
- Cópia autorizada no armazenamento próprio.
- Hash, deduplicação técnica e criação da versão 1.
- Progresso, erros por arquivo e reprocessamento manual.
- Biblioteca com prévia básica e metadados.
- Auditoria da conexão e da importação.

### Não incluído

- Shared Drives.
- Atalhos do Drive.
- Arquivos em “Compartilhados comigo” fora da árvore selecionada.
- Sincronização automática.
- Notificações ou log de mudanças.
- Detecção automática de alteração, movimento ou remoção.
- Importação agendada.
- Transcrição, OCR, tags ou análise por IA.
- Aprovação e rejeição.
- Publicação na Meta Ads.
- Modelos de campanha.
- Exclusão automática da cópia interna.
- Edição ou reorganização de arquivos no Drive.

## 4. Decisões de produto da Fase 1

1. Uma execução seleciona uma pasta.
2. A mesma conexão pode cadastrar várias pastas em execuções diferentes.
3. O usuário escolhe organização e projeto antes da pasta.
4. Marca e produto são opcionais na importação inicial.
5. A importação é recursiva.
6. Arquivos incompatíveis aparecem no inventário como ignorados ou bloqueados.
7. Importação não significa aprovação.
8. Todos os criativos importados começam em `imported`.
9. Uma importação repetida não cria outra versão quando o conteúdo não mudou.
10. Conteúdo diferente do mesmo arquivo externo cria nova versão, mesmo na
    importação manual.
11. Nome ou pasta alterados sem mudança de conteúdo atualizam metadados e
    histórico, sem criar versão de conteúdo.
12. O sistema nunca publica um arquivo por causa da importação.

Os itens desta seção estão aprovados como regras iniciais da Fase 1.

## 5. Atores e permissões

### Proprietário e administrador

- Criar e revogar conexão OAuth.
- Selecionar pastas.
- Iniciar e reprocessar importações.
- Consultar erros e auditoria.

### Editor

- Iniciar importação usando conexão previamente autorizada, se receber permissão
  específica.
- Consultar e organizar criativos do projeto.

### Analista e visualizador

- Consultar biblioteca conforme permissão.
- Não conectar Drive nem iniciar importação por padrão.

### Cliente com acesso restrito

- Visualizar apenas projetos e criativos explicitamente permitidos.
- Não acessar tokens, caminho completo sensível ou payload técnico.

Permissões propostas:

```text
drive_connection.create
drive_connection.revoke
drive_folder.select
drive_import.start
drive_import.retry
creative_library.read
creative_library.manage
creative_source_metadata.read
```

## 6. Fluxo do usuário

```text
Central de Criativos
→ Importar do Google Drive
→ escolher organização e projeto
→ informar marca/produto opcional
→ conectar ou escolher conexão Google existente
→ selecionar uma pasta do Meu Drive
→ sistema inventaria arquivos recursivamente
→ usuário revisa resumo, compatibilidade e limites
→ usuário confirma importação
→ arquivos são copiados e versionados
→ resultado mostra importados, repetidos, ignorados e falhos
→ usuário abre a biblioteca
```

Nenhum processamento destrutivo ou publicação ocorre nesse fluxo.

## 7. OAuth e seleção da pasta

### 7.1 Direção recomendada

Começar com:

- OAuth 2.0 oficial.
- Google Picker para seleção pelo usuário.
- Escopo candidato `drive.file`, por ser estreito e recomendado pelo Google
  para arquivos escolhidos ou compartilhados com o aplicativo.
- Refresh token criptografado para completar e repetir manualmente a importação
  autorizada.

### 7.2 Gate técnico obrigatório

Antes da implementação definitiva, um protótipo isolado deve comprovar:

1. Seleção de uma pasta no Google Picker.
2. Listagem dos descendentes já existentes.
3. Download dos arquivos binários descendentes.
4. Exportação dos Google Docs descendentes.
5. Comportamento de arquivos acrescentados posteriormente à pasta.
6. Comportamento após remoção de permissão.

A seleção visual de uma pasta não garante, por si só, que o token esteja
tecnicamente limitado à árvore ou que `drive.file` conceda acesso contínuo aos
descendentes.

### 7.3 Alternativas caso o gate falhe

Ordem de preferência:

1. Manter `drive.file` e solicitar seleção explícita dos arquivos.
2. Solicitar compartilhamento explícito compatível com o aplicativo.
3. Usar escopo mais amplo somente após aprovação de segurança, privacidade,
   verificação do Google e avaliação de custo.

Não adotar silenciosamente `drive.readonly`. Esse escopo é amplo/restrito e pode
exigir verificação adicional e avaliação de segurança quando dados são
armazenados no servidor.

Resultado do protótipo em 25/07/2026: `drive.file` permitiu selecionar a pasta,
mas não enumerar seus descendentes no inventário do worker. Para cumprir o
requisito aprovado de sincronização por pasta, foi adotado `drive.readonly`,
com nova autorização explícita do usuário, allowlist interna de pastas e
registro da decisão D-039. O escopo não concede escrita no Drive e pode exigir
verificação do aplicativo antes da disponibilização pública.

Referência oficial:
`https://developers.google.com/workspace/drive/api/guides/api-specific-auth`

## 8. Conexão e autorização

Dados da conexão:

- Organização.
- Projetos autorizados.
- Conta Google identificada por ID externo, sem depender apenas do e-mail.
- Escopos concedidos.
- Estado: ativa, expirada, revogada, erro ou reconexão necessária.
- Datas de criação, último uso, última renovação e revogação.
- Autor da conexão.

Segredos:

- Access token somente em memória ou cache protegido.
- Refresh token criptografado em repouso.
- Nunca expor tokens em logs, respostas ou interface.
- Registrar rotação/revogação sem registrar o valor.
- Invalidar uso após revogação local.

Desconectar:

- Interrompe novos acessos ao Drive.
- Não apaga automaticamente arquivos importados.
- Mantém auditoria e metadados históricos.
- Oferece ação separada de exclusão, sujeita à política de retenção.

## 9. Pasta autorizada

Registro mínimo:

- ID interno.
- `connection_id`.
- Organização e projeto.
- Marca e produto opcionais.
- ID externo da pasta.
- Nome observado.
- Caminho conhecido quando reconstruível.
- IDs dos pais observados.
- URL de abertura, somente para usuários autorizados.
- Data de seleção.
- Usuário que selecionou.
- Estado da autorização.
- Inclui subpastas: `true` na Fase 1.
- Último inventário manual.

O ID externo é a referência; nome e caminho podem mudar.

## 10. Inventário

Antes da confirmação, listar recursivamente a pasta e classificar cada item:

```text
compatible
unsupported_type
too_large
cannot_download
shortcut_unsupported
folder
duplicate_content
already_imported
metadata_error
```

Resumo:

- Quantidade de pastas.
- Quantidade de arquivos.
- Quantidade e volume por tipo.
- Compatíveis.
- Já importados sem alteração.
- Possíveis novas versões.
- Ignorados e motivos.
- Volume total estimado.

O inventário não baixa todo o conteúdo. Ele consulta metadados e
`capabilities.canDownload` quando disponível.

## 11. Formatos propostos

### Imagens

| MIME type | Extensões usuais | Fase 1 |
|---|---|---|
| `image/jpeg` | `.jpg`, `.jpeg` | aceitar |
| `image/png` | `.png` | aceitar |
| `image/webp` | `.webp` | aceitar |
| `image/gif` | `.gif` | aceitar como arquivo; prévia pode ser estática |

### Vídeos

| MIME type | Extensões usuais | Fase 1 |
|---|---|---|
| `video/mp4` | `.mp4` | aceitar |
| `video/quicktime` | `.mov` | aceitar, sujeito à reprodução |
| `video/webm` | `.webm` | aceitar |

### Texto

| MIME type | Extensões usuais | Fase 1 |
|---|---|---|
| `text/plain` | `.txt` | aceitar |
| `text/markdown` | `.md` | pendente de aprovação |

### Google Workspace

| Tipo | Fase 1 |
|---|---|
| Google Docs | exportar e importar |
| Google Sheets | fora da Fase 1 |
| Google Slides | fora da Fase 1 |
| Google Vids | fora da Fase 1 |

Para Google Docs, proposta:

- Exportar como `.docx` para preservar estrutura editável.
- Registrar o MIME type nativo e o MIME type exportado.
- Guardar o arquivo exportado como ativo próprio.
- Extração de texto fica para a Fase 3.

A API exige verificar `capabilities.canDownload`. `files.export` possui limite
documentado de 10 MB para Google Workspace.

Referência oficial:
`https://developers.google.com/workspace/drive/api/guides/manage-downloads`

## 12. Limites aprovados e aplicados

Valores da política compartilhada `creative_media_import_v1`:

| Categoria | Limite por arquivo |
|---|---:|
| Imagem | 50 MB |
| Vídeo | 2 GB |
| Texto | 10 MB |
| Google Docs exportado | limite da API e máximo interno de 10 MB |
| Arquivos por execução | 1.000 |
| Volume total por execução | 20 GB |

Todos os limites pertencem ao contrato compartilhado do domínio, usado pelo
worker, pela confirmação server-side e pelo painel. O inventário registra os
metadados, mas marca o job como bloqueado antes de qualquer download quando
excede 1.000 arquivos ou 20 GB conhecidos.

Quando o Drive não informa tamanho antes do download, o cálculo preventivo
reserva o limite máximo individual do MIME type. O tamanho real continua sendo
verificado durante o streaming. Essa estimativa conservadora evita tratar
metadado ausente como zero e impede que o lote ultrapasse silenciosamente o
teto.

Quando o inventário exceder um limite:

- Não iniciar parcialmente sem confirmação.
- Mostrar o limite excedido.
- Permitir reduzir a seleção ou importar um lote explicitamente.

## 13. Download e exportação

### Arquivo binário

```text
files.get(fileId, alt=media)
→ stream
→ hash durante transferência
→ armazenamento temporário controlado
→ validação
→ armazenamento próprio
```

### Google Docs

```text
files.export(fileId, DOCX MIME type)
→ stream
→ hash
→ armazenamento próprio
```

Regras:

- Não carregar vídeos inteiros em memória.
- Usar streaming e backpressure.
- Validar tamanho real recebido.
- Verificar MIME type declarado e conteúdo quando possível.
- Aplicar timeout, retentativa e backoff.
- Não reutilizar URL de download como URL permanente.
- Não registrar URLs assinadas.
- Excluir temporários após sucesso ou falha terminal, conforme política.

## 14. Armazenamento próprio

Cada ativo importado guarda:

- ID interno.
- Organização e projeto.
- Chave opaca do objeto.
- Hash SHA-256 do conteúdo.
- Tamanho.
- MIME type validado.
- Extensão derivada.
- Data de armazenamento.
- Estado de integridade.
- Origem e revisão do Drive.

Propriedades:

- Criptografia em trânsito e repouso.
- URLs assinadas e temporárias para visualização.
- Isolamento por organização/projeto.
- Backup e teste de restauração.
- Verificação periódica de integridade.
- Política de retenção e exclusão auditável.

O provedor de armazenamento permanece pendente.

## 15. Modelo conceitual usado

```text
drive_connection
└─ drive_folder
   └─ drive_file
      └─ drive_file_revision
         └─ creative_source_link
            ├─ creative_asset
            └─ creative_version
               └─ creative
```

### Arquivo do Drive

Representa o item externo e seu estado conhecido.

### Ativo

Representa a cópia interna de um conteúdo.

### Criativo

Representa o conceito reutilizável e organizável.

### Versão

Representa uma composição imutável, futura unidade de análise, aprovação e
publicação.

Um arquivo não é automaticamente sinônimo de criativo em todas as fases
futuras. Na Fase 1, a regra inicial proposta é criar um criativo para cada
arquivo principal compatível. Agrupamento por pasta individual fica registrado
como evolução.

## 16. Organização sugerida e interpretação

Estrutura recomendada:

```text
Criativos
└─ Produto
   └─ Status ou campanha
      └─ Pasta individual do criativo
         ├─ vídeo ou imagem
         ├─ thumbnail opcional
         └─ documento de copy e observações
```

Na Fase 1:

- A estrutura de pastas é preservada como metadado.
- O sistema não infere automaticamente produto, status ou campanha apenas pelo
  nome da pasta.
- Produto e marca são definidos no início da importação ou posteriormente.
- Arquivos auxiliares aparecem na biblioteca, mas agrupamento automático em um
  único criativo fica pendente.

Isso evita transformar uma convenção de pastas em regra de domínio irreversível.

## 17. Idempotência

### Identidade da origem

```text
organization_id
+ project_id
+ connection_id
+ drive_file_id
```

### Identidade do conteúdo

```text
sha256(bytes importados)
```

### Regras

- Mesmo `drive_file_id` e mesmo hash: não criar ativo nem versão.
- Mesmo `drive_file_id` e hash diferente: criar nova revisão e nova versão.
- ID diferente e mesmo hash: registrar nova origem; reutilização física do
  objeto pode ocorrer, mas não fundir automaticamente os criativos.
- Nome ou pasta diferente e mesmo hash: atualizar origem e histórico, sem nova
  versão de conteúdo.
- Reprocessamento do mesmo job não duplica registros.
- Exportação do Google Docs pode mudar bytes sem mudança material; na Fase 1 o
  hash binário prevalece e a limitação deve ficar visível.

## 18. Criação inicial do criativo

Para cada arquivo principal importado:

```text
creative.status = imported
creative_version.number = próximo número sequencial
creative_version.status = imported
creative_asset = cópia interna
creative_source_link = revisão do Drive → ativo/versão
```

Metadados iniciais:

- Nome derivado do arquivo, editável sem alterar a versão.
- Projeto obrigatório.
- Marca e produto opcionais.
- Pasta de origem.
- Tipo de mídia.
- Data de importação.
- Autor da importação.

Não criar automaticamente:

- Tag de vencedor.
- Campanha.
- Público.
- Destino.
- Aprovação.
- Solicitação de publicação.

## 19. Jobs e estados

### Job da importação

```text
draft
inventory_running
awaiting_confirmation
queued
running
partially_completed
completed
failed
cancelled
```

### Item da importação

```text
discovered
eligible
skipped
downloading
validating
storing
versioning
imported
duplicate
failed_retryable
failed_terminal
```

Falha de um arquivo não cancela automaticamente os demais. O resultado final
deve diferenciar conclusão total e parcial.

## 20. Eventos

Emitir:

- `drive_folder_connected` após vínculo válido da pasta.
- `creative_file_detected` para cada arquivo inventariado relevante.
- `creative_file_imported` após cópia interna confirmada.
- `creative_version_created` após criação idempotente da versão.
- `creative_sync_failed` para falha da operação ou item, com contexto
  sanitizado.

Não emitir nesta fase:

- `creative_analysis_completed`
- `creative_approved`
- `creative_publication_requested`
- `creative_published`

Todo evento inclui organização, projeto, conexão, pasta, arquivo, job, tentativa
e versão do schema quando aplicável.

## 21. Interface

### Tela de conexão

- Estado da conta Google.
- Escopos concedidos.
- Projetos autorizados.
- Data de conexão e último uso.
- Reconectar e revogar.
- Sem exibir tokens.

### Seletor

- Projeto obrigatório.
- Marca e produto opcionais.
- Botão para abrir Google Picker.
- Pasta selecionada com nome e ID mascarável.
- Aviso sobre importação recursiva.

### Inventário

- Resumo por tipo e volume.
- Lista pesquisável.
- Compatibilidade e motivo de bloqueio.
- Arquivos já importados.
- Novas versões possíveis.
- Confirmação explícita.

### Progresso

- Barra geral.
- Contadores por estado.
- Item atual sem bloquear a navegação.
- Cancelamento seguro.
- Retentativa de itens falhos.

### Resultado

- Importados.
- Duplicados.
- Ignorados.
- Falhos.
- Link para biblioteca.
- Link para detalhes e diagnóstico.

### Biblioteca

- Prévia de imagem.
- Reprodução de vídeo quando o navegador suportar.
- Ícone e download controlado para texto/Google Docs.
- Nome, versão, projeto, produto, pasta e data.
- Estado `imported`.
- Indicação de origem indisponível sem remover a cópia.

## 22. Estados obrigatórios de UX

- Carregando autenticação.
- Sem conexão.
- Sem permissão.
- Conexão expirada.
- Pasta vazia.
- Pasta sem acesso.
- Inventário em andamento.
- Limite excedido.
- Nenhum formato compatível.
- Importação em andamento.
- Importação parcial.
- Erro recuperável.
- Falha terminal.
- Arquivo ausente.
- Formato inválido.
- Tamanho incompatível.
- Cópia interna indisponível.
- Filtro sem resultado.

## 23. Segurança e privacidade

- Menor escopo OAuth viável.
- Consentimento claro sobre cópia para armazenamento próprio.
- Refresh token criptografado.
- URLs assinadas de curta duração.
- Verificação de MIME type e tamanho.
- Proteção contra nome de arquivo malicioso e path traversal.
- Nenhuma execução de macros, scripts ou conteúdo importado.
- Sanitização de documentos usados apenas para prévia.
- Varredura antimalware antes de disponibilização quando aplicável.
- Auditoria de conexão, seleção, importação, download e exclusão.
- Isolamento por organização e projeto.
- Política de retenção e direito de exclusão antes da produção.

## 24. Falhas e recuperação

| Falha | Tratamento |
|---|---|
| OAuth negado | não criar conexão; permitir tentar novamente |
| Token expirado | tentar renovação; pedir reconexão se falhar |
| Permissão removida | marcar origem indisponível; manter cópia autorizada |
| Arquivo removido | falhar item; não apagar versão anterior |
| `canDownload = false` | ignorar/bloquear com motivo |
| Rate limit | backoff e retentativa |
| Download interrompido | descartar temporário incompleto e tentar novamente |
| Hash divergente | não publicar ativo; repetir ou quarentenar |
| Armazenamento indisponível | manter job recuperável; não marcar importado |
| MIME type inválido | quarentena ou rejeição |
| Limite excedido | bloquear antes do download quando possível |
| Exportação do Google Docs falha | erro por item e retentativa |

## 25. Observabilidade

Métricas:

- Conexões ativas, expiradas e revogadas.
- Inventários iniciados e concluídos.
- Arquivos por tipo e estado.
- Bytes descobertos e importados.
- Latência de inventário, download e armazenamento.
- Duplicados por origem e por hash.
- Falhas e retentativas por motivo.
- Importações totais e parciais.
- Cobertura de projeto, marca e produto.

Logs:

- IDs internos, job, etapa, tentativa e erro sanitizado.
- Nunca token, conteúdo do arquivo, nome pessoal, URL assinada ou caminho
  completo sensível.

Alertas:

- Crescimento de falhas OAuth.
- Rate limit recorrente.
- Backlog de importação.
- Falha do armazenamento.
- Aumento de arquivos incompatíveis.

## 26. Testes de contrato

1. Conectar por OAuth sem armazenar senha.
2. Negar conexão quando consentimento for cancelado.
3. Selecionar uma pasta do Meu Drive.
4. Impedir pasta fora do escopo escolhido no fluxo.
5. Inventariar subpastas recursivamente.
6. Classificar formatos compatíveis e incompatíveis.
7. Respeitar `canDownload`.
8. Importar JPEG, PNG, WebP e GIF.
9. Importar MP4, MOV e WebM.
10. Importar TXT.
11. Exportar Google Docs para DOCX.
12. Aplicar limite por arquivo e execução.
13. Fazer streaming sem carregar vídeo inteiro em memória.
14. Calcular hash do conteúdo completo.
15. Repetir importação sem duplicar versão.
16. Criar nova versão quando o hash mudar.
17. Não criar versão ao alterar apenas nome/pasta.
18. Registrar origem distinta para IDs diferentes com mesmo hash.
19. Continuar job quando um item falhar.
20. Reprocessar somente itens elegíveis.
21. Manter cópia quando a permissão do Drive for removida.
22. Não emitir eventos de análise, aprovação ou publicação.
23. Não expor token ou conteúdo em logs.
24. Impedir acesso entre organizações/projetos.
25. Exibir carregamento, vazio, parcial, erro e falta de permissão.

## 27. Critérios de aceite

- Usuário autorizado conecta sua conta sem compartilhar senha.
- Uma pasta do Meu Drive é selecionada e vinculada ao projeto.
- Inventário recursivo é exibido antes da confirmação.
- Arquivos compatíveis são copiados e verificáveis no armazenamento próprio.
- Cada conteúdo novo cria ativo e versão imutável.
- Repetição idêntica não duplica versão.
- Falhas por arquivo ficam visíveis e reprocessáveis.
- A biblioteca exibe mídia sem depender do Drive.
- Remoção de permissão não apaga histórico importado.
- Nenhum arquivo é analisado por IA, aprovado ou publicado nesta fase.
- Todas as ações críticas possuem autor, data e resultado.
- Tokens, conteúdo sensível e URLs assinadas não aparecem em logs.

## 28. Gates para iniciar implementação

1. Aprovar o recorte da Fase 1. **Aprovado.**
2. Executar protótipo do OAuth/Picker e descendentes com `drive.file`.
3. Escolher o escopo OAuth definitivo.
4. Aprovar formatos e limites. **Aprovado para início.**
5. Escolher armazenamento de objetos.
6. Aprovar retenção e exclusão.
7. Aprovar papéis e permissões. **Aprovado para início.**
8. Definir tratamento antimalware.
9. Confirmar se Google Docs será exportado apenas como DOCX. **Aprovado na
   Fase 1.**
10. Aprovar agrupamento inicial de um criativo por arquivo principal.
    **Aprovado na Fase 1.**

Gates 2, 3, 5, 6 e 8 continuam obrigatórios antes da implementação. A aprovação
do documento não autoriza escolher silenciosamente fornecedor, escopo amplo,
retenção ou política de segurança.

## 29. Evolução após a Fase 1

### Fase 2

- Changes API, notificações ou polling.
- Checkpoints.
- Novo, alterado, movido e removido.
- Versionamento automático.

### Fase 3

- Transcrição.
- Extração de texto.
- Tags.
- Análise por IA.

### Fase 4

- Conferência.
- Aprovação e rejeição.
- Papéis e comentários.

### Fase 5

- Prévia e publicação assistida na Meta Ads.

### Fase 6

- Modelos de campanha.
- Automações controladas por política.
