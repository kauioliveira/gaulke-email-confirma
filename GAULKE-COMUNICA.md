# Gaulke Comunica — o sistema hoje e o plano de evolução

> **Status:** as 9 fases (0 a 8) estão implementadas; faltam as validações com usuários e o deploy · **Atualizado em:** 29/09/2026
>
> O sistema nasceu para resolver um problema pontual: enviar um documento em lote e
> **provar** quem recebeu, abriu, confirmou e baixou. O pessoal gostou, e ele vai
> virar a **plataforma de comunicação** da Gaulke, com envio de comunicados,
> **assinatura digital** de documentos e **solicitação de documentos** a clientes.
>
> Este documento tem três partes:
> 1. **O sistema hoje**: o que existe e como funciona.
> 2. **O briefing contra o código**: o que já está pronto e o que falta.
> 3. **O plano**: arquitetura, modelo de dados, módulos novos, relatórios, fases e
>    decisões em aberto.
>
> O [README.md](README.md) continua sendo a referência operacional (publicação,
> variáveis de ambiente, proxy). Este arquivo é a visão de produto e arquitetura.

---

## Parte 1 — O sistema hoje

### 1.1 Stack e infraestrutura

| Camada | Tecnologia |
|---|---|
| Aplicação | Nuxt 4 (Vue 3 + Nitro), Nuxt UI 4, Tailwind 4 |
| Banco | PostgreSQL **compartilhado** com os outros sistemas da empresa, via Drizzle ORM |
| E-mail | Nodemailer, com pool de conexão por conta SMTP |
| Planilhas | `xlsx` e `papaparse` (importação de destinatários) |
| Validação | `zod` em todas as rotas |
| Publicação | Docker (`docker-compose.yml`), volumes para arquivos e imagens, proxy Nginx/Apache (`deploy/`) |

Tudo roda num processo só: o disparo, o agendador e a retomada de lotes vivem dentro
do servidor Nuxt (plugins do Nitro).

### 1.2 Telas

**Área administrativa** (`/admin`)

| Tela | O que faz |
|---|---|
| **Lotes** (`/admin/lotes`) | Lista paginada com busca, filtro por status e período, e ordenação no servidor |
| **Novo envio** (`/admin/lotes/novo`) | Assistente em 4 passos: **1.** destinatários, **2.** anexo (opcional), **3.** conteúdo, **4.** revisão, conta de envio e disparo/agendamento |
| **Detalhe do lote** (`/admin/lotes/:id`) | Progresso ao vivo (SSE), pausar/retomar, ajustar intervalo com o lote rodando, reenviar falhas, cancelar agendamento |
| **Templates** (`/admin/templates`) | Editor visual por blocos ou HTML, com pré-visualização e envio de teste. Dois pontos de partida: "Novo com documento" e "Novo comunicado" |
| **Relatório** (`/admin/relatorio`) | Destinatário a destinatário, com filtro por lote, status e marco (abriu, confirmou, baixou, *não* confirmou…). Exporta CSV |
| **Destinatário** (`/admin/destinatario/:id`) | Linha do tempo de eventos de uma pessoa |
| **Configurações** (`/admin/configuracoes`) | Contas de envio SMTP: cadastrar, testar, ativar/desativar, definir a padrão |

**Área pública** (quem recebe)

| Rota | O que faz |
|---|---|
| `/c/:token` | Página do destinatário: mostra o comunicado, o botão "Li e estou ciente" e o download |
| `/api/c/:token/arquivo` | Download rastreado (o arquivo nunca vai anexado ao e-mail) |
| `/t/o/:token/pixel.png` | Pixel de abertura |
| `/img/:nome` | Imagens públicas usadas no corpo dos e-mails |

### 1.3 Como um envio funciona

```
 lista (CSV/XLSX, banco, digitada, "do sistema")
        │  validação + deduplicação por e-mail
        ▼
 lote (snapshot do assunto, HTML e blocos)  ──►  1 destinatário = 1 token + 1 código GLK-XXXX-XXXX
        │
        ▼
 worker de envio (FOR UPDATE SKIP LOCKED, intervalo configurável, até 3 tentativas)
        │
        ▼
 e-mail  ──►  pixel (abertura)  ──►  /c/:token (acesso)  ──►  "Li e estou ciente" (confirmação)  ──►  download
```

Cada sinal vira um evento em `sys_mail_events`, que só recebe inserções (append-only). As
colunas `*_at` do destinatário são desnormalização para o relatório ser rápido.

| Sinal | Confiabilidade |
|---|---|
| Enviado (retorno do SMTP + Message-ID) | alta |
| Abertura (pixel, classificado em **máquina** × **provável pessoa**) | ⚠️ estimativa |
| Acesso à página | alta |
| **Confirmação de leitura** | **é a prova** |
| Download | alta |

### 1.4 Modelo de dados atual (prefixo `sys_mail_`)

| Tabela | Conteúdo |
|---|---|
| `sys_mail_accounts` | Contas de envio SMTP. Senha **cifrada** com AES-256-GCM (`SMTP_CRYPTO_KEY`), uma conta padrão garantida por índice |
| `sys_mail_templates` | Templates (`formato` = `blocos` ou `html`). Sem autoria |
| `sys_mail_batches` | Lotes, com snapshot do conteúdo, arquivo, conta usada, agendamento e **autoria** (quem criou, quem disparou) |
| `sys_mail_recipients` | Destinatários, token, código, status e marcos |
| `sys_mail_events` | Trilha de eventos com IP, user-agent e `meta` |
| `sys_mail_migrations` | Controle das migrations, aplicadas no boot e idempotentes |

### 1.5 Acesso e autoria (hoje)

- **Entrada pela sessão do painel:** o cookie `gaulke_auth_session` é reconhecido pelo
  banco (`public.user_session`), sem senha. **Só admin ou supervisor passam**
  ([server/middleware/admin-guard.ts](server/middleware/admin-guard.ts), função `podeOperar`).
- **Senha do `.env`:** acesso reserva, **sem identidade**. Quem entra assim não fica
  registrado.
- **Autoria gravada:** criação e disparo de lote, criação de conta SMTP. **Não gravada:**
  criação, edição e exclusão de template, exclusão de lote, edição de conta, pausa e reenvio.

### 1.6 Segurança que já existe

- Upload conferido por **assinatura binária** (magic bytes), não só pela extensão. Sem
  executáveis. Limite de 25 MB.
- Senhas SMTP cifradas (AES-256-GCM), nunca devolvidas pela API.
- Trava de força bruta no login e rate limit nas rotas.
- Proteção contra injeção de fórmula no CSV exportado.
- Tokens não adivinháveis (UUID) e código legível separado.
- Rodapé LGPD obrigatório no editor de blocos, com texto próprio para envio sem anexo.

### 1.7 Operação

- Migrations idempotentes aplicadas no boot, restritas às tabelas do sistema (o banco é
  compartilhado: **nunca** usar `drizzle-kit push`).
- Lotes interrompidos por queda do processo são retomados no boot.
- O agendador varre o banco a cada 30 s. Um lote vencido há mais de 120 min
  **não** dispara sozinho: fica pausado com o motivo na tela.
- Na primeira execução, a conta SMTP do `.env` é importada para o banco.

---

## Parte 2 — O briefing contra o código

| # | Pedido | Situação hoje | O que falta |
|---|---|---|---|
| 1 | Todos acessam, mantendo quem fez o quê | ❌ Só admin/supervisor. Autoria parcial | Liberar para todos, criar papéis e um **log de auditoria** completo |
| 2 | Arquivar lotes enviados; só admin/supervisor excluem enviados | ❌ Não existe arquivamento. Qualquer operador exclui, e a exclusão **apaga a prova** (cascade) | Arquivamento + regra de exclusão + exclusão lógica |
| 3 | Filtro "mostrar arquivados", desmarcado por padrão | ❌ | Depende do item 2 |
| 4 | Melhorar templates para o usuário comum | 🟡 Editor visual existe e funciona | Ver 4.4 |
| 5 | Corpo do texto justificado | ❌ Parágrafos saem alinhados à esquerda ([server/utils/blocos.ts:87](server/utils/blocos.ts#L87)) | Justificado por padrão |
| 6.1 | E-mail **sem anexo** só para saber se recebeu/abriu | ✅ **Já funciona.** "Novo comunicado" não exige anexo nem botão, e usa o rodapé LGPD sem menção a download | Ver a observação abaixo |
| 6.2 | Arquivos além de PDF | ✅ **Já funciona.** PDF, Word, Excel, PowerPoint, ODF (odt/ods/odp), CSV, TXT, PNG, JPG e ZIP, com conferência de conteúdo | Nada |
| 7 | Excluir template: com lote enviado só admin/supervisor, sem lote qualquer um com dupla confirmação | ❌ Qualquer um exclui, com um `confirm()` do navegador | Regra + modal duplo |
| 8 | Criação de template por fases | ❌ Tela única | Assistente, ver 4.4 |
| 9 | Configuração no banco com prefixo próprio, múltiplas caixas, só admin altera, escolher saída e resposta, modal de confirmação | 🟡 **Boa parte já existe:** contas no banco (prefixo `sys_mail_`, que é mantido) com senha cifrada, várias contas, importação automática do `.env`, escolha da conta no passo 4 | Restringir a admin, escolher "responder para" separado da saída, modal de confirmação, servidor SMTP compartilhado |
| 10 | Assinatura digital completa com certificado PFX da Gaulke | ✅ **Fase 7** | Ver 4.6 ("Como ficou") |
| 11 | Solicitação de documentos com checklist | ✅ **Fase 6** | Ver 4.7 ("Como ficou") |
| — | Relatórios | 🟡 Relatório de destinatários + CSV | Ver 4.8 |

> **Observação sobre o 6.1.** Sem anexo e **sem botão**, o único sinal é o pixel de
> abertura, que é **estimativa**: quem bloqueia imagens lê sem aparecer, e o Apple Mail
> "abre" tudo sozinho. Para ter prova de recebimento num comunicado, o template deve
> manter o botão **"Confirmar recebimento"**. A proposta é o assistente de templates
> sugerir isso por padrão (ver 4.4).

> **Achado: retenção LGPD.** O rodapé promete ao destinatário que *"os registros são
> mantidos por 24 meses"*, mas **não existe rotina que apague nada**. Precisa entrar no
> plano (ver 4.9).

---

## Parte 3 — A visão: de "envio de lote" para plataforma

Os três módulos (comunicar, assinar e solicitar) têm a mesma espinha: alguém da
Gaulke manda algo a uma pessoa de fora, essa pessoa age por um **link único**, e
tudo fica **provado e auditado**. A proposta é um **núcleo comum** e três módulos em cima
dele, sem três sistemas separados.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                               GAULKE COMUNICA                               │
├──────────────────────┬───────────────────────────┬──────────────────────────┤
│  📢 Comunicados       │  ✍️ Assinaturas            │  📥 Solicitações          │
│  (o que existe hoje) │  PDF + campos + signatários│  checklist + upload      │
├──────────────────────┴───────────────────────────┴──────────────────────────┤
│  NÚCLEO                                                                     │
│  identidade e papéis (painel) · auditoria · canais de saída · templates     │
│  contatos e listas · link único + OTP · fila de envio · armazenamento       │
│  rastreamento de eventos · lembretes · relatórios · retenção LGPD           │
└─────────────────────────────────────────────────────────────────────────────┘
```

Consequências práticas:

- **Um único "Canal de saída"** serve os três módulos (a escolha de saída e de resposta é
  a mesma tela).
- **Uma única trilha de eventos e de auditoria**, e com ela relatórios cruzados, por
  exemplo "tudo o que foi enviado, assinado e pedido ao cliente X".
- **Uma única fila**: o worker de envio de hoje vira genérico.
- **Uma única página pública** por token, com o mesmo visual para o cliente, que muda
  conforme o módulo.

---

## Parte 4 — O plano detalhado

### 4.1 Papéis, permissões e auditoria (itens 1, 2, 7 e 9)

**Papéis.** Vêm do painel (`is_admin`, `is_supervisor`). Todo usuário ativo com sessão
passa a entrar como **Usuário**.

| Ação | Usuário | Supervisor | Admin |
|---|:-:|:-:|:-:|
| Criar, disparar, pausar e reenviar lote | ✅ | ✅ | ✅ |
| Arquivar e desarquivar lote | ✅ | ✅ | ✅ |
| Excluir **rascunho** (nunca disparado) | ✅ ¹ | ✅ | ✅ |
| Excluir lote **enviado** | ❌ | ✅ | ✅ |
| Criar e editar template | ✅ | ✅ | ✅ |
| Excluir template **sem** lote enviado (dupla confirmação) | ✅ | ✅ | ✅ |
| Excluir template **com** lote enviado | ❌ | ✅ | ✅ |
| Editar template marcado como **oficial** | ❌ | ✅ | ✅ |
| **Usar** canais de saída | ✅ | ✅ | ✅ |
| Cadastrar, editar e testar canais de saída | ❌ | ❌ | ✅ |
| Certificado digital (PFX) | ❌ | ❌ | ✅ |
| Configurações gerais | ❌ | ❌ | ✅ |
| Ver auditoria | ❌ | ✅ | ✅ |

¹ Só os próprios rascunhos.

**Visibilidade (D1):** todos os usuários ativos **veem tudo**: lotes, relatórios,
assinaturas e solicitações de qualquer setor. Os papéis limitam só as **ações**.

**A regra vale no servidor, não só na tela.** Hoje o `admin-guard` só decide *entra ou
não entra*. Ele passa a colocar o papel em `event.context.operador`, e cada rota
sensível chama um `exigirPapel(event, 'admin')` ou `exigirPapel(event, 'supervisor')`. A
tela esconde botões com base em `/api/admin/sessao`, mas a tela é conveniência: quem
decide é o servidor.

**Auditoria: `sys_mail_auditoria`.** Append-only, igual à trilha de eventos:

| coluna | exemplo |
|---|---|
| `quando` | `2026-10-02 14:03:11-03` |
| `user_id`, `user_nome` | `42`, `Maria Souza` (nome como snapshot, como já é feito nos lotes) |
| `acao` | `lote.excluir`, `template.editar`, `canal.criar`, `certificado.testar` |
| `entidade`, `entidade_id` | `lote`, `128` |
| `resumo` | `Excluiu o lote "Guias DAS 09/2026" (312 destinatários)` |
| `dados` (jsonb) | antes/depois dos campos alterados (nunca senhas) |
| `ip`, `user_agent` | |

Gravada por um helper único `auditar(event, acao, …)` chamado em **toda** rota que
altera algo. Uma tela "Auditoria" (supervisor/admin) lista e filtra.

**Senha do `.env` (D3).** Continua só como **acesso de emergência**, com poderes de
admin, para quando o painel estiver fora. Aparece na auditoria como "Acesso por senha
local", e o admin pode desligá-la em Configurações.

### 4.2 Banco: prefixo `sys_mail_` (item 9)

**Decisão D4:** o prefixo **`sys_mail_` é mantido** e as tabelas novas usam o mesmo
prefixo. Nada é renomeado.

**Tabelas novas** (detalhadas nas seções seguintes):

| Tabela | Para quê | Fase |
|---|---|---|
| `sys_mail_auditoria` | Quem fez o quê (4.1) | 0 |
| `sys_mail_config` | Chave/valor: senha local, servidor SMTP padrão, retenção, lembretes | 0 |
| `sys_mail_envios` | Cada envio de um destinatário, inclusive reenvios (4.3) | 1 |
| `sys_mail_template_versoes` | Histórico de versões dos templates (4.4) | 2 |
| `sys_mail_inbound`, `sys_mail_tickets`, `sys_mail_supressao` | Monitor da caixa, tickets e supressão (4.10) | 3 |
| `sys_mail_checklists`, `…_checklist_itens`, `sys_mail_solic`, `…_solic_itens`, `…_solic_arquivos` | Solicitações de documentos (4.7) | 6 |
| `sys_mail_certificados`, `sys_mail_assin_documentos`, `…_assin_signatarios`, `…_assin_campos`, `…_assin_eventos` | Assinaturas (4.6) | 7 |
| `sys_mail_listas`, `…_lista_membros` | Listas de contatos salvas (Parte 5) | 8 |
| `sys_mail_webhooks`, `…_webhook_entregas` | Webhooks (n8n) e a fila de entregas com novas tentativas | 8 |

**Convenções que continuam valendo:**
- migrations idempotentes, restritas ao prefixo e aplicadas no boot;
- autoria como snapshot de nome (sem FK para `public.users`);
- eventos append-only.

Novas colunas booleanas usam `boolean` de verdade. As antigas em `varchar('true')` ficam
como estão.

### 4.3 Lotes: arquivar e excluir (itens 2 e 3)

**Arquivar.** Novas colunas `arquivado_em`, `arquivado_por_user_id` e `arquivado_por_nome`.

- Disponível para lotes **concluídos**, **com erro** ou **cancelados**. Não se arquiva
  lote enviando ou agendado.
- Arquivar **não afeta** o destinatário: o link, a confirmação e o download continuam
  funcionando. É só organização da lista.
- Ação individual e **em massa** (selecionar vários → "Arquivar").
- Configuração opcional de **auto-arquivamento** após N dias da conclusão (padrão: desligado).
- Na lista de lotes: um toggle **"Mostrar arquivados"**, desmarcado por padrão, e um
  badge "arquivado" na linha. O relatório continua enxergando tudo.

**Excluir lote enviado.** A exclusão de hoje é física e em cascata: apaga destinatários e
eventos, ou seja, **a prova de que o cliente foi avisado**. Para um escritório contábil
essa prova é o motivo de o sistema existir. Proposta:

- **Rascunho** (nunca disparado): exclusão física, pelo próprio autor ou por
  supervisor/admin.
- **Enviado**: só supervisor/admin, e vira **exclusão lógica** (`excluido_em`,
  `excluido_por`, `motivo` obrigatório). Some das telas e dos relatórios, mas os links
  param de funcionar e os eventos são preservados.
- Uma **lixeira** (admin) mostra os excluídos e permite restaurar. Uma rotina apaga de
  vez após o prazo de retenção (4.9).

**Reenvio individual.** É para o caso "o cliente diz que não recebeu".
- Qualquer destinatário de um lote já disparado pode ser **reenviado na hora**, com o
  **mesmo link e código**. O link antigo continua valendo e o histórico fica unificado.
- O e-mail pode ser **corrigido**. O endereço antigo fica no histórico e na auditoria.
- O motivo é obrigatório.
- Cada envio vira uma linha em `sys_mail_envios`: nº 1 é o original, nº 2, 3… são os
  reenvios, com quem reenviou, quando, para qual endereço e por qual canal.
- A página do destinatário mostra a seção **"Envios"**, e a linha do tempo separa os
  eventos por envio. Assim fica visível se o cliente abriu o reenvio.
- **Em massa:** "Reenviar selecionados" e o atalho "Reenviar para quem não confirmou".
- Se o e-mail estiver na lista de supressão (devolução definitiva), o sistema exige um
  e-mail corrigido.

### 4.4 Templates para o usuário comum (itens 4, 5, 7 e 8)

**Assistente de criação por fases (item 8)**

```
 ① O que você vai enviar?     ② Ponto de partida      ③ Identificação          ④ Conteúdo           ⑤ Testar e salvar
 ┌──────────┐ ┌──────────┐    ○ Em branco             Nome do template         editor de blocos     "Enviar teste para mim"
 │ 📄 Doc.  │ │ 📢 Comun.│    ○ Modelo pronto:        Categoria (Fiscal, DP…)  (já adaptado ao     (e-mail já preenchido
 │ p/ ciênc.│ │  (s/ doc)│      Fiscal · DP ·         Assunto, com sugestões   tipo escolhido)      com o do usuário)
 └──────────┘ └──────────┘      Contábil · Societário                                               checklist de revisão
```

- **Fase 1** usa cartões grandes com uma frase de explicação cada: *"Documento para
  ciência: o cliente recebe um link, confirma a leitura e baixa o arquivo"* ×
  *"Comunicado: só um aviso, sem arquivo"*. É isso que elimina a dúvida de "qual botão
  eu aperto". Quando os módulos novos existirem, os cartões **Assinatura** e **Solicitar
  documentos** entram aqui e levam aos respectivos fluxos.
- O tipo escolhido **fica gravado no template** (`tipo = documento | comunicado`) e decide
  o que o editor exige: o botão de acesso é obrigatório com documento e **sugerido** no
  comunicado ("Confirmar recebimento"), como explicado na observação do 6.1.
- Editar um template existente pula direto para a fase 4, com as outras fases acessíveis
  pela trilha, igual ao assistente de novo envio.

**Melhorias no editor**

| Melhoria | Por quê |
|---|---|
| **Botões de variável** ("Inserir nome do cliente", "Inserir empresa", "Inserir código") em vez de digitar `{{nome}}` | O usuário comum não precisa conhecer a sintaxe, e some o erro de digitação |
| Aviso de **variável inexistente** (`{{nomee}}`) antes de salvar | Hoje ela sai literal no e-mail do cliente |
| Pré-visualização com um **destinatário de exemplo real** e alternância **computador / celular** | A maioria dos clientes lê no celular |
| **Categorias**, busca e **favoritos** na lista lateral | A lista vai crescer com o uso pelos setores |
| **Duplicar** template | O jeito mais comum de criar um novo é partir de um que já funciona |
| Templates **oficiais** (cadeado): só supervisor/admin editam, os outros duplicam | Evita que o modelo "oficial" do setor seja alterado por acidente |
| **Histórico de versões** com "restaurar" | Desfaz uma edição ruim. Os lotes já guardam snapshot, então nada enviado é afetado |
| **Rascunho automático** | Não perder o trabalho ao fechar a aba |
| Mostrar **"usado em N lotes"** no cartão | Informa antes de tentar excluir |
| **Galeria de modelos prontos** por setor | Começar de um modelo bem escrito é melhor do que começar do zero |

**Texto justificado (item 5).** O bloco de parágrafo ganha alinhamento
(`justificado` · esquerda · centro), com **justificado como padrão** para parágrafo, aviso
e lista. Os blocos existentes passam a sair justificados sem precisar reabrir cada
template, porque o HTML é regerado na leitura e no envio. **Decidido: justificado também
no celular.** Para reduzir os "rios" de espaço em coluna estreita, o HTML leva
`hyphens:auto` e `lang="pt-BR"`. Quem monta o e-mail pode escolher outro alinhamento por
bloco.

**Excluir template (item 7)**

1. O servidor conta os lotes **disparados** que usaram o template (`template_id`).
2. Se houver algum e o usuário não for supervisor/admin: **403**, e a tela mostra
   *"Este template já foi usado em 12 envios. Só supervisores e administradores podem
   excluí-lo."* com a opção de **arquivar o template** (some da lista, não apaga).
3. Se não houver: **modal 1**, *"Excluir o template X?"*, seguido do **modal 2**, que pede
   para digitar o nome do template para confirmar. Tudo auditado.
4. Os lotes guardam snapshot do conteúdo, então excluir um template nunca altera o que
   já foi enviado.

### 4.5 Canais de saída (item 9)

O que já existe (contas no banco, senha cifrada, teste de conexão, várias contas, conta
padrão, importação do `.env`) fica. As mudanças:

1. **Nome.** "Contas SMTP" passa a se chamar **"Canais de saída"** na tela.
2. **Só admin** cadastra, edita, testa, ativa e desativa (servidor e tela). Os demais
   só **escolhem** o canal ao enviar.
3. **Servidor SMTP compartilhado.** Em Configurações gerais o admin define **uma vez**
   host, porta e TLS. Um canal novo pede só **nome, usuário, senha, remetente e
   "responder para" sugerido**. Um canal pode sobrescrever o servidor, com o campo
   escondido em "Avançado".
4. **Teste do canal mais completo.** Além de autenticar, confere **SPF, DKIM e DMARC** do
   domínio do remetente e avisa se estiverem faltando (a causa nº 1 de e-mail indo para
   o spam), e envia um e-mail de teste para o admin.
5. **O `.env` deixa de ser configuração.** As variáveis `NUXT_SMTP_*` servem só para a
   importação inicial do canal **"Notifica"** (padrão). Depois disso a gestão é toda
   pela tela, e o `.env` fica só com o que é segredo de infraestrutura
   (`DATABASE_URL`, chave de cifra, segredo de sessão).
6. **Escolha no envio, em dois passos:**
   - **Sai por:** lista de canais ativos, com **Notifica** pré-selecionado.
   - **Respostas vão para:** o "responder para" do canal escolhido, **outro canal**, ou
     um e-mail digitado (por exemplo, o do setor). Fica gravado no lote.
7. **Modal de confirmação** antes de disparar ou agendar:

   ```
   ┌──────────────────────────────────────────────────────┐
   │  Confirmar envio                                     │
   │                                                      │
   │  📤 Sai por        Notifica <notifica@gaulke…>        │
   │  ↩️ Respostas para  Fiscal <fiscal@gaulke…>            │
   │  👥 Destinatários   312 (4 removidos por duplicidade) │
   │  📎 Anexo           Guia_DAS_09-2026.pdf (1,2 MB)     │
   │  🕐 Quando          Agora · ~52 min (10 s entre envios)│
   │  ✅ Confirmação     exigida antes do download          │
   │                                                      │
   │  ☐ Conferi os dados acima                            │
   │                       [Voltar]  [Disparar 312 e-mails]│
   └──────────────────────────────────────────────────────┘
   ```
8. **Sem restrição por setor (D9):** todos os usuários podem usar todos os canais
   ativos. O admin controla só quais canais existem e estão ativos.

### 4.6 Módulo de Assinatura Digital (item 10)

**Base legal, e por que isso molda o desenho.** No Brasil (MP 2.200-2/2001 e
Lei 14.063/2020) há três níveis de assinatura eletrônica:

| Nível | Como | Onde entra aqui |
|---|---|---|
| **Simples** | Identifica quem assinou (e-mail, aceite) | Mínimo aceitável |
| **Avançada** | Vincula a pessoa de forma inequívoca e detecta alteração: e-mail + **código OTP** + IP + data/hora + **hash do documento** | **Como os clientes e responsáveis assinam** |
| **Qualificada** | Certificado **ICP-Brasil** | **Como a Gaulke assina**, com o PFX (e-CNPJ A1), selando o documento final |

É o mesmo modelo das plataformas conhecidas do mercado: as partes assinam com evidências
e a plataforma **sela** o PDF final com um certificado ICP-Brasil. O selo garante que
qualquer alteração posterior seja detectada, e o documento pode ser validado em
**validar.iti.gov.br** e no Adobe Reader.

> **Decisões D5 e D6:**
> - Os documentos são **internos e contratos**. Nada vai para a Junta Comercial, então a
>   assinatura **avançada** basta para os signatários.
> - **Nada pago:** não há carimbo de tempo (TSA). A data e a hora vêm do servidor, sempre
>   no horário de **São Paulo/Brasília** (America/Sao_Paulo).
> - O selo com o PFX da Gaulke é aplicado **só quando marcado** ("Assinar como Gaulke")
>   no envio do documento.

**Fluxo de quem envia**

```
 ① Documento          ② Signatários                 ③ Posicionar campos            ④ Revisar e enviar
 upload (só PDF)       nome · e-mail · CPF           visualizador do PDF            canal de saída + resposta
 título, mensagem      papel: Parte, Testemunha,     arrasta "Assinatura",          prazo · lembretes
 prazo                 Aprovador, Resp. Gaulke       "Rubrica", "Data", "Nome"      modal de confirmação
                       ordem: todos juntos ou em     cor por signatário             (mesmo modal do 4.5)
                       sequência                     "rubrica em todas as páginas"
```

- **Só PDF** neste módulo, validado por conteúdo. PDF protegido por senha ou já assinado
  é recusado com mensagem clara.
- O hash **SHA-256 do original** é gravado no upload. É ele que prova depois que o
  documento assinado é o mesmo que foi enviado.
- **Posicionamento:** `pdf.js` renderiza as páginas. O usuário arrasta caixas e o sistema
  grava página, x, y, largura e altura em coordenadas **do PDF** (pontos), não da tela,
  para que a posição não dependa do zoom.
- **Modelos de assinatura:** salvar "contrato padrão com 2 sócios + 2 testemunhas" com as
  posições, para reaproveitar.

**Fluxo de quem assina** (página pública `/a/:token`, no mesmo visual de `/c/:token`)

1. Abre o link e recebe um **código de 6 dígitos** no e-mail (OTP, válido por 10 min,
   com limite de tentativas). Opcional: confirmar os 3 primeiros dígitos do CPF.
2. Lê o PDF na própria página.
3. Escolhe a forma da assinatura: **nome digitado** (renderizado sempre na **mesma fonte
   manuscrita**, a fonte oficial das assinaturas do sistema) ou **desenhada** com o
   dedo/mouse.
4. Marca *"Li e concordo com o documento e com o uso de assinatura eletrônica"* e assina.
   Também pode **recusar**, com motivo obrigatório. Quem enviou é avisado na hora.
5. Cada passo vira evento com IP, user-agent, data/hora e hash do documento visualizado.

**Conclusão (quando todos assinam)**

1. Com `pdf-lib`: aplica cada assinatura na posição marcada, um carimbo discreto em
   todas as páginas (*"Assinado eletronicamente · código GLK-A-XXXX · verifique em
   comunica.contabilgaulke.com.br/validar"*) e acrescenta a **Folha de Assinaturas**:
   - título do documento, hash do original, data de conclusão;
   - cada signatário: nome, CPF mascarado, e-mail, papel, data/hora, IP e método de
     autenticação (e-mail + OTP);
   - **QR code** para a página de validação;
   - identidade visual fixa: cabeçalho da Gaulke, **uma família tipográfica** (a mesma
     em todos os documentos) e a fonte manuscrita das assinaturas, todas **embutidas** no PDF.
2. **Se "Assinar como Gaulke" estiver marcado:** com `@signpdf/signpdf` + `node-forge`,
   assina o PDF final com o **PFX da Gaulke** (padrão **PAdES**), sem carimbo de tempo
   externo (D6).
3. Grava o PDF final e o hash final, e dispara o e-mail **"Documento assinado por todos"**
   para todos os signatários e para quem enviou, com o PDF assinado (anexo e link).

**Página pública de validação** (`/validar`): informar o código ou **arrastar o PDF**. O
sistema calcula o hash e diz *"Documento íntegro, assinado por X, Y e Z em…"* ou
*"Este arquivo não corresponde a nenhum documento assinado"*.

**Estados:** `rascunho → aguardando → parcialmente assinado → concluído`, com saídas para
`recusado`, `cancelado` (por quem enviou, com motivo) e `expirado` (prazo).
**Lembretes automáticos** para quem ainda não assinou (por exemplo, a cada 3 dias e na
véspera do prazo).

**Certificado da Gaulke (Configurações, só admin)**

| Passo | Detalhe |
|---|---|
| Upload | `.pfx` / `.p12` + senha (**opcional**, há certificados sem senha) |
| **Testar** | Abre o arquivo e mostra **titular, CNPJ, emissora, número de série, validade** e se a cadeia é **ICP-Brasil**. Em seguida assina um **PDF de teste** e oferece o download, para conferir no Adobe ou no validar.iti.gov.br |
| Salvar | Arquivo **no disco** (volume próprio, `storage/certificados`, permissão 600, fora de qualquer rota pública), **senha no banco cifrada** com AES-256-GCM, igual às senhas SMTP |
| Monitorar | Certificado A1 vale **1 ano**: alerta na barra e e-mail aos admins **30, 15 e 7 dias** antes de vencer. Certificado vencido bloqueia a conclusão de assinaturas, com aviso claro |
| Trocar | Guarda o histórico (qual certificado selou qual documento), sem apagar o antigo |

> **Recomendação de segurança:** além da senha no banco, **cifrar também o arquivo** PFX
> no disco com a mesma chave. Assim quem tiver só o backup do disco, ou só o do banco,
> não consegue usar o certificado. A chave de cifra (`SMTP_CRYPTO_KEY`) passa a se chamar
> `COMUNICA_CRYPTO_KEY`, com o nome antigo aceito na transição.

**Dados**

| Tabela | Principais colunas |
|---|---|
| `sys_mail_certificados` | arquivo_path, senha_cifrada, titular, cnpj, emissor, serial, valido_de, valido_ate, icp_brasil, ativo, último teste, autoria |
| `sys_mail_assin_documentos` | título, mensagem, status, sequencial, prazo, pdf_original_path, hash_original, pdf_final_path, hash_final, certificado_id, canal_id, responder_para, código de validação, autoria, concluido_em |
| `sys_mail_assin_signatarios` | documento_id, nome, e-mail, cpf, papel, ordem, token, status, otp_hash, otp_expira, assinatura_tipo, assinatura_imagem, assinado_em, ip, user_agent, motivo_recusa |
| `sys_mail_assin_campos` | signatario_id, página, x, y, largura, altura, tipo (`assinatura`, `rubrica`, `data`, `nome`) |
| `sys_mail_assin_eventos` | append-only, com **encadeamento de hash** (cada evento guarda o hash do anterior): apagar ou alterar um evento no meio quebra a corrente e fica evidente |

**Como ficou (Fase 7, implementado)**

- **Certificado A1 (Configurações, só admin):** o .pfx e a senha entram pela tela; o
  arquivo é aberto no servidor (node-forge, que lê os PKCS#12 3DES/RC2 dos A1
  brasileiros), a chave privada vai **cifrada** para `sys_mail_certificados`
  (AES-256-GCM com a `SMTP_CRYPTO_KEY`) e a **senha é descartada** — o mesmo desenho do
  cofre do painel (`/fiscal/nfce/certificados`). Não há arquivo em disco nem senha no
  banco. *Testar a senha* confere sem gravar e mostra titular, CNPJ (OID ICP-Brasil),
  responsável, emissor, validade e cadeia; *Assinar PDF de teste* baixa um PDF selado.
  Senhas erradas: 10 por 10 min por pessoa. Remover um certificado **apaga a chave**.
  Vencendo em 30 dias (ou vencido): alerta no Início.
  - Decisão tomada com o usuário: **cadastro próprio** em vez de ler o cofre do painel —
    ler de lá exigiria copiar para cá a chave que protege todos os certificados fiscais.
- **Documento:** PDF (sem senha, até 25 MB/300 páginas), pessoas em paralelo ou em
  sequência, campos arrastáveis (assinatura, rubrica, data, nome) posicionados sobre o
  PDF (pdf.js) em pontos do PDF. Sem campo, a assinatura vai só para a folha.
- **Quem assina (`/a/:token`):** lê o PDF, digita o nome (fonte manuscrita fixa Great
  Vibes, embutida — OFL) ou desenha, aceita e confirma com **código de 6 dígitos por
  e-mail** (10 min, 5 tentativas, só o hash no banco, reenvio após 1 min). Pode recusar
  com motivo (o documento fica "recusado" e quem enviou é avisado).
- **PDF final:** assinaturas nos campos com legenda (nome, data/hora SP, código), carimbo
  no rodapé de cada página, **folha de assinaturas** (SHA-256 do original, pessoas com CPF
  mascarado, IP, dispositivo, hora do OTP, QR para `/validar`, base legal — MP
  2.200-2/2001 art. 10 §2º — e histórico). Se marcado, **selo PAdES B-B**
  (`ETSI.CAdES.detached` com `signingCertificateV2`, montado à mão — o pkcs7 do forge não
  gera esse atributo), **sem TSA** (D6). Vai anexado por e-mail a todos e fica na pasta do
  cliente (`…/ASS-000045_<título>/…_original.pdf` e `…_assinado.pdf`). Falha ao gerar
  (ex.: certificado vencido) não perde assinaturas: botão *Gerar de novo*.
- **Histórico encadeado:** cada evento guarda o hash do anterior; o detalhe refaz a
  corrente e aponta o evento adulterado.
- **`/validar`:** pelo código da folha ou pelo PDF (o SHA-256 é calculado no navegador; o
  arquivo não sobe). Diz se é o assinado, o original, ou se não confere.
- Lembretes a quem está com a vez: a cada 3 dias úteis, até 3.
- Verificado com `pdfsig` (poppler) e `openssl cms -verify` usando um A1 de teste gerado
  para isso. A validação no Adobe e no validar.iti.gov.br depende do A1 real (cadeia
  ICP-Brasil); sem política de assinatura ICP (AD-RB), o ITI pode apontar "sem política",
  com a integridade confirmada.

### 4.7 Módulo de Solicitação de Documentos (item 11)

**O problema:** o societário (e com certeza outros setores) precisa pedir documentos a
clientes e hoje depende de e-mail solto, anexo perdido e "já mandei?". A proposta é um
**checklist compartilhado** entre a Gaulke e o cliente.

**Quem pede (Gaulke)**

1. Escolhe um **modelo de checklist** ("Abertura de empresa", "Alteração contratual",
   "Admissão", "IRPF") ou monta um na hora.
2. Cada item do checklist tem:
   - título e instrução (*"RG ou CNH, frente e verso, legível"*);
   - **obrigatório** ou **opcional**;
   - tipos aceitos (PDF, imagem, Office…) e quantos arquivos;
   - **arquivo modelo** para baixar, preencher e devolver (opcional, por exemplo uma
     ficha cadastral);
3. Define destinatário(s), **prazo** e lembretes, e escolhe o canal de saída e a resposta
   (o mesmo 4.5).

**Quem envia os documentos (cliente)**, na página pública `/r/:token`:

```
 ┌─────────────────────────────────────────────────────┐
 │  [logo Gaulke]   Documentos para: Abertura — ACME    │
 │  Prazo: 10/10/2026 · ██████░░░░ 3 de 5 obrigatórios   │
 ├─────────────────────────────────────────────────────┤
 │  ✅ RG ou CNH dos sócios         2 arquivos enviados  │
 │  ✅ Comprovante de endereço      1 arquivo            │
 │  🔴 IPTU do imóvel  (recusado: "ilegível", reenviar)  │
 │  ⬜ Contrato de locação  *obrigatório*  [Enviar]      │
 │  ⬜ Certidão de casamento  (opcional)  [Não possuo]    │
 └─────────────────────────────────────────────────────┘
```

- Envia **por item**, pode mandar uma parte hoje e o resto amanhã (o link continua
  válido até o prazo).
- No celular, **tira a foto direto** pela câmera.
- Item opcional: botão **"Não possuo"**, com justificativa.

**Análise (Gaulke)**

- Aviso a quem pediu quando chega arquivo novo (no sistema e por e-mail, configurável).
- Tela de análise: cada item → **Aprovar** ou **Recusar com motivo**. A recusa manda
  e-mail ao cliente listando **só o que falta ou foi recusado**.
- Quando todos os obrigatórios estão aprovados, a solicitação fica **Concluída** e quem
  pediu é avisado.
- **Baixar tudo em ZIP**, com os arquivos já renomeados no padrão da Gaulke.

**Armazenamento em disco (D7).** Os arquivos ficam **centralizados neste sistema**, no
volume Docker `documentos`, ao lado de `arquivos` e `imagens`. Quem pediu (o societário
ou qualquer setor) baixa pela própria tela, individualmente ou em ZIP. Não há cópia para
uma pasta de rede.

As pastas são organizadas **por cliente**. Sem CPF/CNPJ, o nome da pasta usa o e-mail:

```
storage/documentos/clientes/12345678000190_acme-ltda/2026/
    SOL-000123_abertura/
        01-rg-cnh-socios/  rg-joao-silva_2026-10-02.pdf
        02-comprovante-endereco/ …
    ASS-000045_contrato-prestacao/  original.pdf · assinado.pdf
```

O nome original fica gravado no banco. O nome em disco é padronizado e sem caracteres
problemáticos. Cada arquivo tem **SHA-256** gravado.

**Segurança: o ponto mais sensível dos três módulos.** Aqui é **gente de fora mandando
arquivo para dentro** da Gaulke:

- conferência de conteúdo (magic bytes), como já fazemos, e limite por arquivo e por
  solicitação;
- **antivírus (ClamAV)** em container ao lado. O arquivo fica em quarentena até ser
  verificado (decisão D8);
- rate limit por token e por IP, token com validade (o prazo + margem), OTP opcional
  para solicitações sensíveis;
- os arquivos **nunca** são servidos por rota pública: o download interno exige sessão.

**Dados**

| Tabela | Principais colunas |
|---|---|
| `sys_mail_checklists` / `…_checklist_itens` | Modelos reutilizáveis (título, setor, itens padrão) |
| `sys_mail_solic` | título, mensagem, destinatário (nome, e-mail, CPF/CNPJ, empresa), token, prazo, status (`aberta` = esperando o cliente, `em_analise`, `concluida`, `cancelada`; "atrasada" é aberta com prazo vencido, calculada), grupo (pedido para vários clientes), canal, responder_para, autoria |
| `sys_mail_solic_itens` | ordem, título, instrução, obrigatório, tipos aceitos, máx. arquivos, modelo_path, status (`pendente`, `enviado`, `aprovado`, `recusado`, `não possui`), motivo, analisado_por, analisado_em |
| `sys_mail_solic_arquivos` | item_id, path, nome_original, tamanho, mime, sha256, enviado_em, ip, antivirus (`pendente`, `limpo`, `infectado`, `sem_antivirus`, `erro` = clamd fora, fica na quarentena), removido_em |
| `sys_mail_solic_eventos` | histórico append-only da solicitação: e-mails, acessos, envios, análises, com IP |

**Como ficou (Fase 6, implementado)**

- Uma solicitação **por cliente**; o pedido para vários clientes vira várias, com o mesmo
  `grupo`. Cada uma guarda a **sua cópia** dos itens: editar o modelo depois não muda o
  que o cliente já recebeu.
- Estado derivado dos itens: *aberta* (falta algo obrigatório do cliente) → *em análise*
  (obrigatório entregue, algo esperando a Gaulke) → *concluída* sozinha quando todo
  obrigatório está aprovado ou com "não possuo" aceito. Concluir, reabrir e cancelar são
  manuais. Dá para **pedir mais um documento** numa solicitação já enviada.
- A recusa **não** manda e-mail na hora: a tela avisa "N recusas não avisadas" e o botão
  *Avisar o cliente* junta todas num e-mail só.
- Aviso a quem pediu: por e-mail, **10 min depois da última entrega** do cliente (um aviso,
  não um por arquivo), e na hora quando o antivírus bloqueia um arquivo.
- Lembretes: a cada 3 dias sem entrega, no máximo 3, só em dia útil das 8h às 18h (SP);
  também há *Enviar lembrete* manual.
- O link vale até a solicitação ser concluída ou cancelada (não expira pelo prazo: prazo
  vencido só marca "atrasada"). OTP para solicitações sensíveis **ficou para depois**.
- Upload: um arquivo por requisição (limite de 25 MB, o proxy corta em 30 MB), formato
  conferido pela extensão **aceita no item** e pelo conteúdo; HEIC (foto do iPhone)
  aceito. Quarentena → ClamAV (`INSTREAM`, cliente TCP próprio em
  `server/utils/antivirus.ts`) → pasta do cliente. Com o clamd fora, o arquivo **fica na
  quarentena** e o agendador tenta de novo; sem `CLAMAV_HOST` (desenvolvimento) passa
  marcado "sem antivírus".
- ZIP em streaming com `fflate` (já era dependência; o `archiver` não foi necessário), com
  `MANIFESTO.txt`: status de cada item, justificativas, quem analisou e o SHA-256 de cada
  arquivo.
- Respostas e devoluções dos e-mails do pedido são ligadas à solicitação pelo monitor da
  caixa (Fase 8): evento no histórico, aviso a quem pediu e, na devolução, supressão.

### 4.8 Relatórios

**Painel inicial (dashboard)**, a nova home do sistema:
- envios do mês, taxa de confirmação e tempo médio até a confirmação;
- assinaturas aguardando e as que vencem nos próximos dias;
- solicitações abertas e itens aguardando análise;
- alertas: certificado vencendo, canal com falha no último teste, lote pausado por
  agendamento vencido;
- **"Minhas pendências"**: o que depende de mim (analisar documentos, assinar como
  responsável Gaulke, lotes meus com falha).

**Relatórios por módulo**

| Módulo | Relatórios |
|---|---|
| Comunicados | O que já existe **+** funil por lote (enviado → abriu → acessou → confirmou → baixou) · por **usuário**, **setor** e **canal** · clientes que **nunca confirmam** · falhas por domínio de destino |
| Assinaturas | Pendentes por signatário · tempo médio até concluir · recusas com motivos · vencendo e vencidas |
| Solicitações | Itens pendentes por cliente · % concluída · atrasadas · tempo de resposta do cliente · tempo de análise da Gaulke |
| Transversal | **Linha do tempo do cliente** (tudo enviado, assinado e pedido para um CPF/CNPJ ou e-mail) · **auditoria** (quem fez o quê) · volume por setor e mês |

**Dossiê de comprovação (PDF)**, por destinatário ou por lote. Um documento pronto para
anexar a uma discussão com o cliente ou a um processo: o e-mail exatamente como foi
enviado (snapshot), o código, e a trilha de eventos com data, hora e IP, carimbado com
hash e selado com o certificado da Gaulke. Para um escritório contábil (*"eu nunca
recebi a guia"*) é talvez a funcionalidade de maior valor por esforço.

**Formatos:** tela, CSV e **XLSX** para todos. Opcional: **resumo semanal por e-mail**
para supervisores (pendências do setor).

### 4.9 Infraestrutura transversal

| Tema | Proposta |
|---|---|
| **Fila** | O worker de hoje é bom (`SKIP LOCKED`, retomada no boot), mas específico de lotes. Com três módulos, lembretes, antivírus e geração de PDF, vale uma fila genérica **no próprio Postgres** (`pg-boss`, sem Redis novo) com tarefas tipadas: `enviar_email`, `lembrete`, `concluir_assinatura`, `escanear_arquivo`, `expurgo_lgpd` |
| **Armazenamento** | Volumes: `arquivos` (anexos dos lotes), `imagens` (públicas), `documentos` (solicitações e assinaturas, por cliente) e `certificados` (PFX, restrito). Todos entram na **rotina de backup** (hoje o backup cobre o banco, e os volumes precisam ser verificados) |
| **Retenção LGPD (D10)** ✅ | Rotina diária: **24 meses** para comunicados e solicitações (como promete o rodapé) e **10 anos** para documentos assinados e suas evidências. Configurável pelo admin. **Como ficou (Fase 8):** o que venceu é **apagado de vez** (registros, eventos e arquivos) — um "esqueleto anonimizado" não serviria a ninguém e manteria dado pessoal por tabela esquecida. A auditoria fica, com IP e navegador anonimizados depois de 24 meses. Lixeira: 90 dias. Prévia ("o que sairia hoje") e "rodar agora" na tela; cada execução com efeito vai para a auditoria |
| **Supressão** | E-mails com devolução definitiva, detectada pelo monitor da caixa (4.10), viram lista de supressão, com aviso na montagem do lote e no reenvio |
| **Fuso horário** | Tudo em **America/Sao_Paulo**: telas, e-mails, CSV, PDFs e nomes de arquivo. O container roda com `TZ=America/Sao_Paulo` |
| **Segurança** | OTP nos fluxos de assinatura, ClamAV nos uploads externos, cifra do PFX, `exigirPapel` em todas as rotas sensíveis, auditoria |
| **Chave de cifra** | `SMTP_CRYPTO_KEY` → `COMUNICA_CRYPTO_KEY` (o nome antigo continua aceito), com um procedimento documentado de rotação |

### 4.10 Monitor da caixa de e-mail e tickets no painel

**O que é.** O admin liga **"Monitorar caixa"** num canal de saída. O servidor de e-mail
é interno, então o monitor usa IMAP com o mesmo usuário e senha do SMTP. A partir daí o
sistema lê a caixa a cada 2 minutos e reconhece:

| O que chegou | Como é reconhecido | O que o sistema faz |
|---|---|---|
| **Devolução definitiva** (e-mail inexistente, domínio inválido) | Relatório de entrega (DSN) com status `5.x.x` | Destinatário fica como **devolvido**, entra na **lista de supressão** e aparece no lote e na linha do tempo |
| **Devolução temporária** (caixa cheia, servidor fora) | DSN com status `4.x.x` | Só registra o evento |
| **Recibo de leitura** | Notificação de disposição (MDN) | Registra "recibo de leitura" com data e hora |
| **Resposta automática** (férias, ausência) | Cabeçalhos `Auto-Submitted`, `X-Autoreply` e afins | Só anota, não abre ticket |
| **Resposta do cliente** | Qualquer outra mensagem ligada a um envio | Registra a resposta com um trecho e **abre ticket**, se ligado |

- **Aviso do servidor:** mensagens do próprio servidor de e-mail (quarentena, relatórios do
  postmaster) ficam registradas à parte e nunca contam como resposta de cliente.
- **Servidor da empresa: S4 (qmail).** As devoluções chegam em português ("Falha na entrega
  do e-mail", "Aviso de entrega adiada"), com o cabeçalho original colado no corpo. O
  classificador entende esse formato, além do padrão RFC 3464/8098.
- **O monitor só lê.** Não move, não apaga e não marca como lido. Quem usa a caixa no
  Outlook não percebe diferença. O sistema guarda o último e-mail processado.
- **Como liga a mensagem ao destinatário:** pelo `Message-ID` de cada envio (inclusive
  reenvios), pelos cabeçalhos originais que vêm dentro da devolução, pelo código
  `GLK-XXXX-XXXX` ou pelo link citado na resposta. O que não casar aparece como "sem
  vínculo" na página **Caixa de entrada**.
- **Aviso de caixa não monitorada:** se as respostas de um envio forem para uma caixa sem
  monitoramento, o modal de confirmação avisa.

**Tickets no painel.** Com **"Criar tickets"** ligado no canal, o envio mostra "Criar
tickets para este envio" já marcado, e o usuário pode desmarcar.
- **Resposta do cliente:** abre **um ticket por ocorrência**, em nome de **quem criou o
  lote** (solicitante e responsável), com o trecho da resposta e o link do destinatário.
  Se o mesmo cliente responder de novo enquanto o ticket estiver aberto, a resposta vira
  **comentário** nele.
- **Sem confirmação em N dias** (N configurável no canal, padrão 3): abre **um ticket
  por lote**, listando quem ainda não confirmou.
- Devoluções e recibos **não** abrem ticket. Aparecem só no sistema.

**Como o ticket é criado.** Por uma **rota de integração nova no painel**
(gaulke-data-tools-ts), autenticada por um token de API com um escopo próprio. Ela usa o
próprio serviço de tickets do painel, então o ticket recebe o código `TCK-…`, eventos e
notificações (sino, e-mail, Discord) normalmente. Se o painel estiver fora do ar, o
pedido fica numa fila e é tentado de novo.

---

## Parte 5 — Ideias além do briefing

Por ordem de valor estimado para a Gaulke:

1. **Anexo individual por destinatário.** Hoje o lote tem **um** arquivo para todos. Na
   contabilidade, o caso mais comum é *cada cliente receber o seu*: guia DAS, holerite,
   informe, balancete. A proposta: subir uma pasta ou ZIP, e o sistema **casa cada
   arquivo com o destinatário** pelo CNPJ/CPF ou pelo código no nome do arquivo, mostra
   o que casou e o que sobrou, e dispara. Mantém todo o rastreamento de hoje.
2. **Dossiê de comprovação em PDF** (4.8).
3. ✅ **Lembretes automáticos** para quem não confirmou em N dias, também nos comunicados
   (Fase 8: mesmo e-mail com "Lembrete:" no assunto, pela fila do lote, dia útil 8h–18h).
4. **Aviso para quem enviou:** *"todos confirmaram"*, *"fulano assinou"*, *"chegou
   documento"*, no sistema e por e-mail.
5. ✅ **Listas salvas** ("Clientes do Simples", "Clientes DP - folha"), montadas uma vez e
   reusadas no novo envio e nas solicitações (Fase 8).
6. ✅ **Linha do tempo do cliente:** tudo que a Gaulke enviou, pediu e assinou com aquele
   CPF/CNPJ ou e-mail, numa tela só, com as respostas por e-mail (Fase 8, menu Clientes).
7. **Portal do cliente:** um link mágico por e-mail mostra *tudo* que está pendente para
   aquela pessoa (confirmar, assinar, enviar documentos), em vez de vários links soltos.
8. ✅ **Integração com n8n/webhooks:** eventos (`assinatura.concluida`,
   `solicitacao.concluida` e mais 8) disparam automações, por exemplo mover os arquivos
   para o sistema de gestão documental ou abrir uma tarefa. Fase 8: fila no banco com novas
   tentativas, assinatura HMAC por entrega, segredo mostrado uma vez.
9. ~~Leitura de bounces pela caixa IMAP~~: virou a seção 4.10.
10. **WhatsApp como canal** de aviso ("você tem um documento para assinar"), mais adiante:
    o número já existe na configuração.

---

## Parte 6 — Fases

A fundação vem primeiro: papéis e auditoria afetam tudo o que vem depois. Depois vem o
que todos já usam (comunicação), e por fim os módulos novos.

**Cada fase termina com uma parada obrigatória.** O relatório diz o que foi feito, como
testar, o que ficou pendente e onde é preciso intervir. A fase seguinte só começa com o
OK. Nada é commitado automaticamente.

| Fase | Entrega | Itens do briefing |
|---|---|---|
| **0 · Fundação** | Acesso para todos os usuários ativos · papéis e `exigirPapel` · auditoria + tela · tabela de config · senha local só de emergência · fuso de São Paulo | 1 |
| **1 · Comunicação 2.0** | Arquivar + filtro · exclusão lógica + lixeira · canais só-admin, servidor compartilhado, "responder para", modal de confirmação · texto justificado · **reenvio individual com histórico de envios** | 2, 3, 5, 9 |
| **2 · Templates para todos** | Assistente por fases · regras de exclusão com dupla confirmação · botões de variável · pré-visualização celular · categorias, duplicar, oficiais, versões · galeria | 4, 7, 8 |
| **3 · Caixa + tickets** | Monitor IMAP · devoluções, recibos e respostas · supressão · rota de tickets no painel · tickets por resposta e por falta de confirmação · página Caixa de entrada | novo |
| **4 · Anexo individual** | Um arquivo por destinatário, casado por CPF/CNPJ, código ou e-mail | Parte 5 |
| **5 · Relatórios** | Dashboard · funil · por usuário/setor/canal · XLSX · **dossiê em PDF** | relatórios |
| **6 · Solicitação de documentos** | Checklists · página do cliente · análise · ZIP · ClamAV · volume `documentos` por cliente | 11 |
| **7 · Assinatura digital** | Certificado PFX · campos e signatários · OTP · folha de assinaturas · selo PAdES quando marcado · validação pública | 10 |
| **8 · Retenção e extras** | Retenção 24 meses/10 anos · listas salvas · lembretes · linha do tempo do cliente · webhooks · respostas de solicitações e assinaturas na caixa | Parte 5 |

Todas as fases acima estão implementadas (29/09/2026). Ficaram para depois, da Parte 5:
**aviso "todos confirmaram"** (4), **portal do cliente** (7) e **WhatsApp como canal** (10).

## Parte 7 — Decisões tomadas

| # | Decisão |
|---|---|
| **D1** | Todos os usuários ativos do painel acessam e **veem tudo**. Os papéis limitam só as ações |
| **D2** | Lote enviado: **exclusão lógica com lixeira**, só supervisor/admin, com motivo obrigatório. O admin restaura. Rascunho: exclusão física |
| **D3** | Senha do `.env`: só **emergência de admin**, registrada na auditoria e desligável |
| **D4** | O prefixo **`sys_mail_` é mantido**, inclusive nas tabelas novas |
| **D5** | Documentos internos e contratos, nada para a Junta: **assinatura avançada** |
| **D6** | **Nada pago:** sem TSA. Selo com o PFX **só quando marcado**. Horário de São Paulo/Brasília |
| **D7** | Arquivos das solicitações **centralizados neste sistema** (volume `documentos`, organizado por cliente), download pela tela ou em ZIP |
| **D8** | **ClamAV** em container ao lado da aplicação |
| **D9** | Canais **sem restrição por setor** |
| **D10** | Retenção: **24 meses** para comunicados e solicitações, **10 anos** para documentos assinados |
| **M1–M3** | Monitor da caixa por IMAP (mesmas credenciais), **só leitura**. Flags no canal, com ajuste por lote |
| **T1–T3** | Tickets por **rota nova no painel**, em nome de quem criou o lote, **um por ocorrência**: resposta do cliente e falta de confirmação em N dias (um por lote) |
| **R1** | **Reenvio individual** com o mesmo link, e-mail corrigido opcional, motivo e histórico numerado de envios |

---

## Parte 8 — Riscos

| Risco | Mitigação |
|---|---|
| Assinatura avançada **contestada** | Uso restrito a documentos internos e contratos (D5). A Folha de Assinaturas documenta as evidências. Selo PFX disponível quando marcado |
| **Vazamento do PFX** (quem tem o arquivo e a senha assina como a Gaulke) | Arquivo cifrado + senha cifrada + chave fora do banco + volume restrito + auditoria de cada uso |
| Certificado **vencer** sem ninguém perceber | Alertas 30/15/7 dias + bloqueio explícito |
| **Upload malicioso** de cliente | Magic bytes, ClamAV, quarentena, sem rota pública de download |
| **Crescimento do disco** (PDFs, fotos de documentos) | Retenção, métricas de uso por módulo no dashboard, backup dos volumes |
| E-mails caindo em **spam** com canais novos | Teste de SPF/DKIM/DMARC no cadastro do canal (4.5) |
| Monitor da caixa lendo **e-mail pessoal** de quem usa a mesma caixa | Só lê o que se liga a um envio. O resto fica como "sem vínculo", visível só na página Caixa de entrada |
| Painel fora do ar na hora de abrir o ticket | Fila de retentativa em `sys_mail_tickets` |
| Promessa LGPD do rodapé | ✅ Rotina diária de retenção (4.9), com prévia e auditoria |
| Retenção **apagar o que ainda é preciso** (documento fiscal pedido ao cliente) | Prazo por módulo e configurável; prévia antes de rodar; documento que precisa ficar mais tempo deve ir para o sistema de gestão documental (o webhook `solicitacao.concluida` serve para isso) |
