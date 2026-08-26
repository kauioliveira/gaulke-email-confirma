# Gaulke · Envio e Confirmação de Leitura

Sistema interno para disparar um documento em lote por e-mail e **comprovar**
quem recebeu, quem acessou, quem confirmou a leitura e quem baixou o arquivo —
com data, hora e IP de cada evento.

Nuxt 4 · Nuxt UI 4 · Drizzle ORM · PostgreSQL · Nodemailer

---

## Como funciona

Cada destinatário recebe um **link único** (`/c/<uuid>`) e um **código legível**
(`GLK-7F3K-2M9Q`) que pode ser citado por telefone. O PDF **não vai anexado**:
ele fica em área privada e só é entregue pela página com token — é assim que o
download consegue ser rastreado.

| Sinal | Como é captado | Confiabilidade |
|---|---|---|
| **Enviado** | retorno do SMTP + `Message-ID` gravado | alta |
| **Abertura** | pixel 1×1 em `/t/o/:token/pixel.png`, classificado | ⚠️ **estimativa** — veja abaixo |
| **Acesso** | GET na landing `/c/:token` | alta |
| **Leitura confirmada** | botão "Li e estou ciente" | **é esta a prova de leitura** |
| **Download** | GET em `/api/c/:token/arquivo` | alta |

### Por que abertura é estimativa

O pixel dispara tanto quando alguém lê quanto quando uma máquina baixa as
imagens sozinha. Contar os dois juntos produz um número que parece bom e não
significa nada, então [`server/utils/abertura.ts`](server/utils/abertura.ts)
classifica cada abertura em `maquina` ou `provavel-pessoa`:

| Regra | Motivo |
|---|---|
| user-agent de proxy conhecido | `GoogleImageProxy`, Yahoo, Proofpoint, Mimecast, Barracuda, previews da Microsoft, clientes automatizados |
| IP no bloco `17.0.0.0/8` | Apple Mail Privacy Protection baixa **todas** as imagens na entrega, mesmo sem ninguém abrir |
| menos de 30s após o envio | pré-carregamento do servidor de destino, não leitura |
| sem user-agent | requisição não identificada |

A conclusão e a evidência (user-agent, IP, motivo) ficam no `meta` do evento,
para poder ser auditada depois. O relatório separa **Prováveis leituras** de
**Só automático**, conta todas as aberturas (`open_count`) e mostra a última.

Mesmo assim continua sendo estimativa: **quem bloqueia imagens lê sem aparecer
em lugar nenhum**. Para comprovação, use a confirmação.

### Recibo de leitura do cliente de e-mail

Opção **por lote** (desligada por padrão) que envia `Disposition-Notification-To`,
`Return-Receipt-To` e `X-Confirm-Reading-To` apontando para o `NUXT_SMTP_REPLY_TO`.
A maioria dos clientes ignora, e os que respeitam mostram um "deseja confirmar a
leitura?" que a pessoa pode recusar — o retorno chega como e-mail na caixa de
resposta, não entra no relatório. Use só quando o atrito valer a pena.

`sys_mail_events` é append-only — nunca editamos um evento gravado. As colunas
`*_at` em `sys_mail_recipients` são só desnormalização para o relatório ser rápido.

## Telas

| Rota | O que faz |
|---|---|
| `/admin/lotes` | lista de lotes com progresso |
| `/admin/lotes/novo` | assistente: importar CSV/XLSX → PDF → e-mail → revisão |
| `/admin/lotes/:id` | console de disparo **em tempo real** (SSE), pausar/retomar/reenviar falhas |
| `/admin/templates` | editor de HTML com preview visual e envio de teste |
| `/admin/relatorio` | tabela filtrável + exportação CSV |
| `/admin/destinatario/:id` | ficha individual com a timeline completa (IP, user-agent) |
| `/c/:token` | página do destinatário (pública, por token) |

## Configuração

Todas as variáveis ficam no `.env` (veja `.env.example`):

| Variável | Para que serve |
|---|---|
| `DATABASE_URL` | Postgres. **Compartilhado com outros sistemas** — veja a seção de banco |
| `NUXT_SMTP_*` | servidor de e-mail da empresa |
| `URL_ACESSO` | **base pública de todos os links**: botão, pixel e logo |
| `ADMIN_PASSWORD` | senha única da área `/admin` |
| `SESSION_SECRET` | segredo do cookie de sessão (trocar derruba as sessões) |
| `STORAGE_DIR` | diretório privado dos PDFs (fora de `public/`, de propósito) |

## Publicação

Este **não** é um app PHP: não existe "subir os arquivos numa pasta". É um
processo Node que fica escutando numa porta, e o servidor web encaminha o
tráfego para ele.

```
                  notifica.contabilgaulke.com.br
                              │
                    Nginx/Apache (proxy reverso)
                              │
                      127.0.0.1:3000
                    (processo Node/Nuxt)
```

### Subdomínio (recomendado)

Rodando em `notifica.contabilgaulke.com.br` o app fica na raiz do próprio
subdomínio: **não** se usa `NUXT_APP_BASE_URL`, e não há conflito com o
`.htaccess` do WordPress que atende `contabilgaulke.com.br`.

Checklist:

1. **DNS** — registro A (ou CNAME) de `notifica` apontando para o servidor
2. **`.env.production`** — `cp .env.production.example .env.production` e preencha
3. **Deploy** — `bash shell/build-image-production.sh` (veja abaixo)
4. **Proxy reverso** — `deploy/nginx-notifica.conf` ou `deploy/apache-notifica.conf`
5. **SSL** — `certbot --nginx -d notifica.contabilgaulke.com.br`

### Deploy: build aqui, `docker load` lá

Mesmo padrão dos outros sistemas da empresa. A imagem é construída na máquina
do dev, exportada com `docker save` e enviada por rsync — o servidor não baixa
nada da internet e roda exatamente a imagem testada aqui.

```bash
bash shell/build-image-production.sh
```

Menu com **1) Homologação** (`root@192.168.0.10:/homologa/…`) e
**2) Produção** (`gaulke@192.168.0.204:/home/gaulke/gaulke-email-confirma-main`).
O script builda, empacota `.tar` + `docker-compose.yml` + `exec.sh` +
`.env.production`, envia e oferece rodar `bash exec.sh up` no servidor.

Antes de buildar, ele **aborta** se o `.env.production` tiver:

- `URL_ACESSO` vazia, apontando para `localhost`, ou **com subcaminho**
  (o build é feito sem `NUXT_APP_BASE_URL`, então um subcaminho geraria um
  pacote em que todo link do e-mail cai em 404)
- `DATABASE_URL`, `ADMIN_PASSWORD` ou `SESSION_SECRET` em branco

E avisa se o `ADMIN_PASSWORD` de produção for igual ao de desenvolvimento.

No servidor, `shell/exec.sh` aceita:

| Comando | O que faz |
|---|---|
| `bash exec.sh up` | `docker load`, **aplica as migrations** e sobe com `--force-recreate` |
| `bash exec.sh stop` | derruba os contêineres |
| `bash exec.sh migrate` | só as migrations, sem mexer no que está no ar |
| `bash exec.sh logs` | acompanha o log |

As migrations rodam num contêiner descartável **antes** do `up`: subir com as
tabelas faltando deixaria a aplicação no ar quebrada, e o erro só apareceria
quando alguém abrisse o relatório. Um lote interrompido pelo `--force-recreate`
volta sozinho no boot, sem reenviar quem já recebeu.

`APP_HOST_PORT` (padrão `8551`) define a porta que o compose abre **no
loopback** do servidor — é o endereço que o proxy reverso consulta.

### Subcaminho (`/notifica`), se for mesmo necessário

Funciona, mas exige duas coisas a mais:

```bash
# no BUILD, não só na execução: os caminhos dos assets são gravados no bundle
NUXT_APP_BASE_URL=/notifica/ npm run build
```

`URL_ACESSO` precisa incluir o mesmo subcaminho
(`https://contabilgaulke.com.br/notifica`), e o `proxy_pass` **não** pode ter
barra no fim, senão o prefixo é removido. Além disso, o `.htaccess` do
WordPress precisa de uma exceção, ou ele engole a rota antes do proxy:

```apache
RewriteCond %{REQUEST_URI} !^/notifica
```

O app compara `URL_ACESSO` com o caminho em que está servindo e avisa no boot
e na barra do admin quando os dois divergem — esse erro não quebra o envio,
só faz a logo, o botão e o pixel darem 404 na caixa de entrada de todo mundo.

### "Blocked request. This host is not allowed"

Erro do **Vite**, só no `npm run dev` — o build de produção não faz essa
checagem. Ele recusa domínios que não conhece, como proteção contra DNS
rebinding, e aparece assim que o dev roda atrás de um proxy ou domínio real.

O `nuxt.config.ts` já libera automaticamente o host do `URL_ACESSO`, então na
maioria dos casos basta ter a variável certa no `.env`. Para nomes adicionais:

```bash
DEV_HOSTS=homologa.contabilgaulke.com.br,outro.exemplo.com
```

Endereços IP e `localhost` são sempre aceitos; qualquer outro host continua
bloqueado.

### Duas coisas que não podem faltar no proxy

- **`X-Forwarded-For`** — sem ele o relatório grava o IP do proxy, e a
  evidência de acesso perde o valor
- **`proxy_buffering off`** — sem isso o acompanhamento em tempo real (SSE)
  só entrega os eventos quando a conexão fecha

## Banco de dados

Todas as tabelas usam o prefixo `sys_mail_`: `sys_mail_templates`,
`sys_mail_batches`, `sys_mail_recipients`, `sys_mail_events`.

> ⚠️ **Nunca rode `drizzle-kit push` neste banco.** Ele compara o schema inteiro
> e gera `DROP` das tabelas dos outros sistemas da empresa — o `tablesFilter`
> não impediu isso na prática. Por isso o comando foi removido do `package.json`.

Para alterar o schema: escreva um `.sql` novo em `server/db/migrations/`
(só instruções sobre `sys_mail_*`) e rode:

```bash
npm run db:migrate         # desenvolvimento (.env)
npm run db:migrate:prod    # produção (.env.production)
```

O `scripts/migrate.mjs` aplica os arquivos em ordem, registra o que já foi
aplicado em `sys_mail_migrations` e **recusa** qualquer migration que contenha
`DROP`/`TRUNCATE`.

## Comandos

```bash
npm install
npm run db:migrate     # cria as tabelas sys_mail_*
npm run dev            # http://localhost:3000
npm run typecheck
npm run build && node .output/server/index.mjs
```

## LGPD

- **Não** coletamos CPF/CNPJ. O token UUID já identifica o destinatário e o
  aceite é comprovado por IP + user-agent + timestamp — princípio da
  minimização (art. 6º, III).
- O e-mail e a landing informam explicitamente que acesso e download são
  registrados (transparência, art. 6º, VI).
- IP é dado pessoal: aparece só na área autenticada, nunca em página pública.
- Retenção declarada ao titular: **24 meses**. O expurgo ainda é manual —
  veja "Pendências".

## Pendências conhecidas

- **Bounces**: o status `bounce` existe no schema, mas não há coletor
  (IMAP/webhook). Uma mensagem aceita pelo relay aparece como "enviado" mesmo
  que volte depois.
- **Expurgo de 24 meses**: prometido ao titular, ainda não automatizado.
- **PDF por destinatário**: hoje é um arquivo por lote.
- **Múltiplos operadores**: a autenticação é uma senha única compartilhada.
- **Entregabilidade**: confira SPF, DKIM e DMARC do domínio antes de lotes
  grandes; sem isso o intervalo de 10s não impede a queda em spam.
