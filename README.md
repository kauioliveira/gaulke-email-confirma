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

## De onde vem a lista de destinatários

O passo 1 do assistente aceita quatro origens, todas passando pela **mesma**
validação (e-mail válido, duplicados removidos, com aviso do que foi descartado):

As quatro origens **somam** no mesmo lote, como um carrinho: você busca em uma,
acrescenta, muda para outra e acrescenta mais. A lista é indexada por e-mail em
minúsculas, então a deduplicação acontece por construção — duas origens
trazendo a mesma pessoa resultam em **um** destinatário, e a tela avisa quantos
já estavam lá.

| Origem | Quando usar |
|---|---|
| **Importar arquivo** | CSV ou XLSX. A tela mostra o formato esperado e oferece um modelo para download (`/api/admin/modelo-lista`). Só a coluna de **e-mail** é obrigatória; o mapeamento é sugerido e pode ser corrigido. |
| **Do banco** | Quem já recebeu algum envio. Cada pessoa aparece uma vez, com nome e empresa do envio mais recente. Filtra por lote e por comportamento — "não confirmaram a leitura" é o caso mais comum de retrabalho. |
| **Digitar** | Colar ou digitar, um por linha. Aceita `email@x.com`, `Nome <email@x.com>`, `Nome; email@x.com; Empresa` e a variação com vírgula. Linhas com `#` são ignoradas. |
| **Do sistema** | Pessoas cadastradas nas tabelas da empresa: **colaboradores** (`users`) e **clientes pessoa física** (`client`). Busca por nome, e-mail, setor, CPF/CNPJ ou código. |

A seleção feita em "Do banco" guarda o contato inteiro, não só o que está
visível: trocar o filtro no meio da escolha não derruba ninguém da lista.

### "Do sistema": o que dá e o que não dá

[`server/api/admin/pessoas.get.ts`](server/api/admin/pessoas.get.ts) lê as
tabelas de **outros sistemas** — por isso usa SQL puro e elas **não** entram em
`server/db/schema.ts`: nenhuma ferramenta de migration pode chegar perto delas.

| Fonte | Registros | Com e-mail |
|---|---|---|
| `users` (colaboradores) | 76 (46 ativos) | **46** — o e-mail é o `username` |
| `client` (pessoa física) | 1.064 | **9** |
| `company` (empresas) | 743 | **0 — a tabela não tem coluna de e-mail** |

> **As empresas clientes não aparecem** porque não há para onde enviar: nem
> `company`, nem `partner`, nem `internal_whatsapp_contacts` têm e-mail
> preenchido. Um seletor de empresas ficaria bonito e não mandaria nada. Para
> habilitar, é preciso primeiro uma fonte de e-mail por empresa.

Clientes **bloqueados, inativos ou falecidos** são excluídos da busca — são
situações em que disparar um comunicado seria, no mínimo, constrangedor.

## Telas

| Rota | O que faz |
|---|---|
| `/admin/lotes` | lista com busca, filtro por status e período, e ordenação |
| `/admin/lotes/novo` | assistente: lista → PDF → e-mail → revisão |
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
| `ADMIN_PASSWORD` | senha da área `/admin` — **reserva**, usada só quando não há sessão do painel |
| `SESSION_SECRET` | segredo do cookie de sessão (trocar derruba as sessões) |
| `SMTP_CRYPTO_KEY` | cifra as senhas das contas de envio — sem ela não há cadastro de contas |
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
                      127.0.0.1:8551
                 (container; APP_HOST_PORT, vindo
                    de shell/deploy.conf)
                              │
                        :3000 dentro do
                    container (fixo, Dockerfile)
```

São três portas diferentes e vale não confundi-las:

| Onde | Porta | Definida em |
|---|---|---|
| `npm run dev`, nesta máquina | **2005** | `PORT`, no `.env` |
| No host de homologação/produção | **8551** | `HOMOLOG_PORT` / `PRODUCTION_PORT`, em [`shell/deploy.conf`](shell/deploy.conf) |
| Dentro do container | 3000, fixa | `ENV PORT` do `Dockerfile` — não mexer |

É a do meio que o vhost do Nginx consulta.

### Nginx Proxy Manager

O NPM roda **em container**, numa rede Docker própria (`proxy-gaulke_default`).
Isso decide como o app precisa publicar a porta:

| Para o NPM, `127.0.0.1` é… | …ele mesmo, não o servidor |
|---|---|
| Redes bridge diferentes | isoladas: nem por IP (`172.30.0.2`) nem por nome |

Por isso o app publica em **todas as interfaces**, e não só no loopback — é o
mesmo desenho dos outros sistemas da casa. No NPM, o destino é o **IP do
servidor com a porta publicada**, nunca a porta interna:

| Campo do NPM | Valor |
|---|---|
| Forward Hostname / IP | `192.168.0.204` |
| Forward Port | o `PRODUCTION_PORT` de [`shell/deploy.conf`](shell/deploy.conf) |

> **A porta interna do container é 3000**, e ela não vai no NPM. Em sistemas
> PHP/nginx a interna é 80; aqui é um processo Node. O que o NPM consulta é
> sempre a porta **publicada** no host (`0.0.0.0:<porta>->3000`), do mesmo jeito
> que os outros sistemas são consultados pelas portas 2002, 2003 e 2004.

Um bind só em loopback faz o container subir **saudável** e o site não
responder — sem erro em lugar nenhum.

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

### Portas e destinos: `shell/deploy.conf`

Servidor, usuário, diretório e **porta** de cada ambiente ficam em
[`shell/deploy.conf`](shell/deploy.conf) — não é preciso editar o script para
trocar. A porta escolhida é gravada como `APP_HOST_PORT` no `.env.production`
que viaja no pacote, **sobrescrevendo** o que estiver no arquivo: assim uma
cópia vinda de outro servidor nunca leva a porta errada.

É essa porta que o `docker-compose` abre **no loopback** do servidor, e é o
endereço que o proxy reverso consulta — trocou aqui, troque no vhost.

Para descobrir o que já está ocupado antes de escolher:

```bash
bash shell/build-image-production.sh   # opção 3
```

Lista as portas TCP em escuta e os contêineres publicando portas em cada
servidor, e diz se a porta configurada está livre. Antes de enviar o pacote o
script confere de novo e avisa se alguém ocupou — descobrir isso depois do
rsync custa uma rodada inteira de deploy.

A porta do ambiente **local** é `PORT` no `.env` (padrão 3000); ela não tem
relação com as dos servidores.

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

### As migrations rodam sozinhas no boot

Em **qualquer ambiente**, sem variável e sem passo manual: subiu a aplicação,
o schema está pronto ([`server/utils/migrations.ts`](server/utils/migrations.ts),
chamado por [`server/plugins/retomar-lotes.ts`](server/plugins/retomar-lotes.ts)).

Isso só é seguro porque:

- os arquivos são idempotentes (`CREATE ... IF NOT EXISTS`);
- o que já rodou fica registrado em `sys_mail_migrations`;
- qualquer `DROP`/`TRUNCATE` é **recusado** — este banco é compartilhado;
- um `pg_advisory_xact_lock` serializa instâncias subindo ao mesmo tempo, então
  duas réplicas nunca aplicam o mesmo arquivo em paralelo.

Se falhar, a aplicação **sobe mesmo assim** — um contêiner em crash-loop
esconderia o log que explica o problema. O erro aparece no log e em
`/api/admin/status`.

Para alterar o schema, escreva um `.sql` novo em `server/db/migrations/`
(só instruções sobre `sys_mail_*`). Ele será aplicado no próximo boot.

Para aplicar **sem** subir a aplicação:

```bash
npm run db:migrate         # desenvolvimento (.env)
npm run db:migrate:prod    # produção (.env.production)
bash exec.sh migrate       # no servidor, contêiner descartável
```

> O `scripts/migrate.mjs` roda fora do Nitro (não consegue importar o TS do
> servidor), então repete a mesma lógica. Se mudar as regras em um, mude no outro.

## Comandos

```bash
npm install
npm run db:migrate     # cria as tabelas sys_mail_*
npm run dev            # http://localhost:2005 — a porta sai de PORT no .env
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

## Contas de envio

O SMTP saiu do `.env` e virou cadastro, em **Configurações**. O servidor
costuma ser o mesmo para todo mundo — por isso ele já vem pré-preenchido — mas
usuário e senha mudam por setor, e **cada lote escolhe de qual conta sai**.

Na primeira execução a conta do `.env` é importada sozinha, já como padrão, e
passa a ser editável pela tela. Ninguém precisa recadastrar o que já
funcionava, e nada muda para quem não abrir a tela.

### Só salva se conectar

Criar ou editar uma conta **testa a conexão antes de gravar**. Falhou, nada é
salvo. A trava existe nos dois lados: a tela bloqueia o botão até o teste
passar, e o servidor repete a checagem — sem isso, uma conta salva por fora
viraria uma fila de falhas no meio do próximo disparo.

O efeito colateral é proposital: com o servidor SMTP fora do ar não dá para
editar a conta, nem para trocar só o rótulo. Para esse caso existe **Desativar**,
que não testa — justamente porque precisa funcionar quando nada responde.

### A senha é cifrada, não tem hash

Hash é de via única: serve para conferir uma senha digitada, nunca para
recuperá-la. O SMTP exige a senha **em claro** na hora de autenticar, então o
que cabe aqui é cifra reversível — **AES-256-GCM**
([`server/utils/cripto.ts`](server/utils/cripto.ts)), que além de cifrar
autentica: adulterar o texto cifrado faz a decifragem falhar em vez de devolver
lixo.

A chave fica em `SMTP_CRYPTO_KEY`, no `.env`:

```bash
openssl rand -hex 32
```

| Situação | Consequência |
|---|---|
| Chave ausente | não dá para cadastrar conta; os envios seguem pelo SMTP do `.env` |
| Chave perdida | as senhas gravadas viram ilegíveis — basta recadastrar as contas |
| Chave trocada | idem: o que já estava gravado deixa de abrir |
| Mesmo banco, chaves diferentes | um ambiente não lê o que o outro gravou |

Não há queda para `SESSION_SECRET` de propósito: rotacionar o segredo de sessão
é rotina, e derrubaria todas as contas de e-mail junto — sem que o motivo
aparecesse em lugar nenhum.

A senha **nunca** sai numa resposta da API, nem cifrada.

### O que fica registrado

O lote grava `conta_id` **e** `conta_nome`. O nome é snapshot: se a conta for
excluída depois, o relatório continua dizendo de qual caixa aquele e-mail saiu.
Excluir uma conta com lote em andamento, pausado ou agendado é recusado — cortar
as credenciais no meio de um disparo transformaria o resto da lista em erro.

## Entrada pela sessão do painel

Quem já está logado no painel (`gaulke-data-tools-ts`) **entra sem senha**, e o
lote passa a registrar quem o criou e quem o disparou.

Funciona porque o painel grava o cookie `gaulke_auth_session` com
`Domain=contabilgaulke.com.br` — o navegador já o envia para este subdomínio
sozinho — e o hash SHA-256 dele fica em `public.user_session`, no **mesmo
banco** que este app usa. Então basta calcular o hash e procurar a linha viva
([`server/utils/sessao-painel.ts`](server/utils/sessao-painel.ts)).

| Situação | O que acontece |
|---|---|
| Sessão do painel, admin ou supervisor | entra sem senha, autoria registrada |
| Sessão do painel, usuário comum | **403** — disparo é restrito (13 podem, 33 não) |
| Sessão expirada ou inválida | mensagem específica, e a senha continua valendo |
| Sem cookie (ex.: acesso por IP) | pede a senha do `.env`, como antes |

**Validação pelo banco, não por segredo compartilhado.** Não precisamos do
`authJwtSecret` do painel, e o logout tem efeito **imediato**: quando o painel
apaga a linha da sessão, o acesso aqui morre junto. Um token assinado
continuaria valendo até expirar.

**Acoplamento assumido:** se o painel trocar o nome do cookie ou o algoritmo do
hash, deixamos de reconhecer a sessão. O sistema não quebra — cai na senha — mas
perderia a autoria em silêncio; por isso `/api/admin/sessao` devolve `origem`,
distinguindo "sem cookie" de "cookie não reconhecido".

> **Por que não liberar por IP interno.** `clientIp()` lê `X-Forwarded-For`, que
> é enviado pelo cliente — foi assim que simulei o proxy do Gmail nos testes.
> Dispensar a senha por IP deixaria qualquer um entrar mandando
> `X-Forwarded-For: 192.168.0.10`. Mesmo blindado, "estar na rede" não é
> "ser autorizado": o relatório tem e-mail e IP de cliente.

## Editor visual do e-mail

O template é montado com **blocos**, não escrito em HTML: logo, título,
parágrafo, aviso destacado, lista, botão, código, imagem, separador e rodapé.
A pessoa arrasta para reordenar, escreve em campos comuns e insere `{{nome}}`
clicando numa etiqueta — a variável entra na posição do cursor.

**Por que gerar o HTML em vez de deixar editar:** cliente de e-mail não é
navegador. O Outlook ignora CSS moderno, então a marcação precisa ser tabela
aninhada com estilo inline. Um editor livre produziria `div` e `span`, e o
e-mail chegaria quebrado sem ninguém perceber até o cliente reclamar. Com
blocos, [`server/utils/blocos.ts`](server/utils/blocos.ts) gera sempre a
marcação testada.

Três garantias que vêm do modelo, não de disciplina:

- **O rodapé de LGPD não pode ser removido** — é ele que avisa o destinatário
  sobre o registro de acesso. O texto é editável; o bloco, não. A regra vale
  também no servidor ([`blocos-schema.ts`](server/utils/blocos-schema.ts)):
  um POST direto sem rodapé é recusado.
- **O botão de acesso não some** e sempre aponta para `{{link}}`.
- **O texto do operador é escapado** — um `<script>` colado num parágrafo
  chega como texto, não como código.

O `html` continua sendo a fonte para o envio: ao salvar em modo blocos, ele é
**gerado** e gravado junto. Preview, criação de lote, disparo e relatório
seguem funcionando sem saber que blocos existem.

A aba **HTML** mostra o resultado em somente-leitura (com as variáveis ainda no
lugar) e oferece "Converter para HTML livre" — caminho de mão única, para quem
quiser assumir a marcação. Templates escritos à mão continuam em modo `html` e
não são migrados.

## Busca e ordenação dos lotes

A lista filtra **no servidor** e é paginada (20 por página) — filtrar no cliente
exigiria baixar todos os lotes a cada carregamento, e esse número só cresce.

A busca cobre **nome, assunto e nome do arquivo**: quase sempre é por um desses
que a pessoa lembra do lote, e não pelo nome dado na criação.

Ordenações: mais recentes/antigos, último disparo, última conclusão, mais
enviados, mais falhas, mais destinatários e nome. As de data usam
`nulls last` — sem isso, ordenar por "último disparo" colocaria no topo
justamente os lotes que **nunca** dispararam.

Os atalhos de status (`agendado (5)`, `erro (3)`…) mostram a contagem real e só
aparecem quando existe algo naquele status, para ninguém clicar num filtro que
não traz nada.

> Os combos de "filtrar por lote" do relatório e do assistente usam
> `/api/admin/batches/opcoes`, uma lista enxuta e **não paginada**. Se
> continuassem consumindo a listagem principal, passariam a mostrar só os lotes
> da primeira página e os antigos sumiriam do filtro sem aviso.

## Agendamento

O lote pode nascer agendado (passo 4 do assistente) ou ser agendado depois. O
[`server/utils/agendador.ts`](server/utils/agendador.ts) varre a cada 30s e
dispara o que venceu, com posse atômica — duas instâncias nunca disparam o
mesmo lote.

**Se o sistema estiver fora do ar na hora marcada:** ele dispara ao voltar,
desde que o atraso seja menor que a tolerância (padrão 120 min,
`AGENDAMENTO_TOLERANCIA_MIN`). Passando disso o lote fica **pausado** com o
motivo em `observacao`, visível na tela — um comunicado marcado para as 8h não
deve sair sozinho às 15h sem ninguém acompanhando.

O horário é escolhido no fuso do navegador e convertido para UTC antes de ir
ao banco (`new Date(valor).toISOString()`): mandar a string crua do
`datetime-local` faria 14h de Brasília virar 14h UTC.

## Limite de requisições

As quatro rotas públicas gravam um evento por acerto, e `sys_mail_events` é a
trilha de auditoria — sem freio, um loop na URL do pixel infla a evidência.
[`server/middleware/rate-limit.ts`](server/middleware/rate-limit.ts) concentra
a política:

| Rota | Limite | Chave |
|---|---|---|
| landing `/api/c/:token` | 60/min | IP + token |
| confirmar | 10/min | IP + token |
| arquivo | 20/min | IP + token |
| pixel | 60/min | IP + token |
| qualquer rota pública | 200/min | IP |
| login | 5 **falhas** / 10 min | IP |

Duas decisões que valem registro:

- **A chave é IP + token.** Rede corporativa faz NAT: limitar só por IP
  bloquearia uma empresa inteira quando o comunicado fosse aberto por todos ao
  mesmo tempo. O freio global por IP cobre varredura de tokens.
- **O pixel nunca devolve erro.** Um 429 renderizaria imagem quebrada dentro
  do e-mail; excedido o limite ele entrega o PNG e apenas não registra.

Os contadores são em memória (um limitador em Postgres gravaria uma linha por
request, que é o que queremos evitar). Com mais de uma réplica cada uma tem seu
contador, e um restart zera tudo — aceitável, já que o objetivo é barrar loop e
força bruta, não cobrar quota. Ajustáveis por `RATE_LIMIT_*`.

## Pendências conhecidas

- **Bounces**: o status `bounce` existe no schema, mas não há coletor
  (IMAP/webhook). Uma mensagem aceita pelo relay aparece como "enviado" mesmo
  que volte depois.
- **Expurgo de 24 meses**: prometido ao titular, ainda não automatizado.
- **PDF por destinatário**: hoje é um arquivo por lote.
- **Múltiplos operadores**: a autenticação é uma senha única compartilhada.
- **Entregabilidade**: confira SPF, DKIM e DMARC do domínio antes de lotes
  grandes; sem isso o intervalo de 10s não impede a queda em spam.
