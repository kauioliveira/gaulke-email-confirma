import { and, desc, eq, isNotNull, lte, ne, sql } from 'drizzle-orm'
import { useDb, useSql, ticketsPainel, batches, recipients, inbound, type Batch, type Recipient, type Solicitacao, type AnexoRecebido } from '../db'
import { lerConfig } from './config'
import { decifrar } from './cripto'
import { semAspas } from './env'
import { baseUrl } from './urls'
import { readFile } from 'node:fs/promises'
import { caminhoDocumento } from './documentos'
import { semCitacao } from './caixa/classificar'

/**
 * Chamados no painel (gaulke-data-tools-ts) a partir do que acontece nos envios.
 *
 * Dois motivos, decididos com a empresa:
 *  - RESPOSTA do cliente: um chamado por ocorrencia. Se o mesmo cliente
 *    responde de novo e o chamado dele ainda esta aberto, vira COMENTARIO;
 *  - SEM CONFIRMACAO em N dias: um chamado por LOTE, listando quem falta.
 *
 * O chamado nasce em nome de quem CRIOU o lote (a rota de integracao do
 * painel age "em nome de"). Devolucao e recibo NAO abrem chamado: ficam so
 * no sistema.
 *
 * Tudo passa por uma FILA (sys_mail_tickets): o painel pode estar fora do ar
 * na hora, e o pedido e tentado de novo com espera crescente.
 */

export type ConfigPainel = { url: string; token: string; origem: 'config' | 'env' }

/** URL e token da integracao: os da tela (Configuracoes) ou os do .env. */
export async function configPainel(): Promise<ConfigPainel | null> {
  const c = await lerConfig('painel_integracao')
  if (c?.url && c.tokenCifrado) {
    try {
      return { url: c.url.replace(/\/+$/, ''), token: decifrar(c.tokenCifrado), origem: 'config' }
    } catch {
      // chave de cifra trocada: cai no .env, se houver
    }
  }
  const url = semAspas(process.env.PAINEL_API_URL || process.env.PAINEL_URL || '')
  const token = semAspas(process.env.PAINEL_API_TOKEN || '')
  return url && token ? { url: url.replace(/\/+$/, ''), token, origem: 'env' } : null
}

class ErroPainel extends Error {
  constructor(public status: number, mensagem: string) {
    super(mensagem)
  }
}

async function chamarPainel<T>(cfg: ConfigPainel, metodo: 'GET' | 'POST', caminho: string, corpo?: unknown): Promise<T> {
  // com anexos o corpo e grande: mais tempo para subir
  const r = await fetch(`${cfg.url}/api/integracoes/comunica${caminho}`, {
    method: metodo,
    headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json', accept: 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(corpo && JSON.stringify(corpo).length > 1_000_000 ? 120_000 : 20_000)
  })
  const texto = await r.text()
  let json: any = null
  try { json = JSON.parse(texto) } catch { /* resposta nao-JSON (proxy, pagina de erro) */ }
  if (!r.ok) throw new ErroPainel(r.status, json?.message || json?.statusMessage || `HTTP ${r.status}: ${texto.slice(0, 200)}`)
  return json as T
}

type RespostaAbrir = { ticket: { uuid: string; code: string | null }; solicitante: { nome: string; substituido: boolean } }
type RespostaEstado = { ticket: { uuid: string; code: string | null; status: { isFinal: boolean } } }

/** Testa URL e token: uma consulta a um chamado inexistente deve dar 404, e nao 401/403. */
export async function testarPainel(cfg: ConfigPainel) {
  try {
    await chamarPainel(cfg, 'GET', '/tickets/00000000-0000-0000-0000-000000000000')
    return { ok: true, mensagem: 'Conectado ao painel.' }
  } catch (e) {
    if (e instanceof ErroPainel && e.status === 404) return { ok: true, mensagem: 'Conectado ao painel: token aceito.' }
    if (e instanceof ErroPainel && (e.status === 401 || e.status === 403)) {
      return { ok: false, mensagem: `O painel recusou o token: ${e.message}` }
    }
    return { ok: false, mensagem: e instanceof Error ? e.message : String(e) }
  }
}

/* -------------------------------------------------------------------------- */
/* Enfileirar                                                                  */
/* -------------------------------------------------------------------------- */

function linkAdmin(caminho: string) {
  const base = baseUrl()
  return base ? `${base}${caminho}` : null
}

/** Quem "pede" o chamado: quem criou o lote; na falta, quem disparou. */
function solicitanteDo(lote: Batch) {
  return lote.criadoPorUserId ?? lote.disparadoPorUserId ?? null
}

const tamanhoLegivel = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} KB`

/**
 * Texto do chamado de RESPOSTA, no formato do painel (cada linha e um
 * paragrafo; **negrito** destaca). A resposta do cliente vem inteira e em
 * primeiro lugar: quem le o chamado quase nunca tem acesso a caixa do canal.
 */
async function textoDaResposta(o: {
  inboundId: number
  quem: string
  empresa: string | null
  referente: string
  de: string | null
  assunto: string | null
  recebidoEm: Date | null
  trecho: string | null
}) {
  const [m] = await useDb()
    .select({ corpo: inbound.corpoTexto, anexos: inbound.anexos })
    .from(inbound)
    .where(eq(inbound.id, o.inboundId))
  // o corpo guardado e o texto todo; sem a citacao do nosso e-mail fica so o que o cliente escreveu
  const resposta = (m?.corpo ? semCitacao(m.corpo) : '') || o.trecho?.trim() || ''
  const anexos = (m?.anexos ?? []) as AnexoRecebido[]
  const link = linkAdmin(`/admin/caixa/${o.inboundId}`)
  return [
    `${o.quem}${o.empresa ? ` (${o.empresa})` : ''} respondeu ${o.referente}.`,
    '',
    '**O cliente respondeu:**',
    resposta ? resposta.slice(0, 15000) + (resposta.length > 15000 ? '\n[…continua no e-mail completo]' : '') : '(sem texto — veja o e-mail completo)',
    '',
    `**De:** ${o.de ?? '—'}`,
    `**Assunto:** ${o.assunto ?? '—'}`,
    `**Recebida em:** ${formatarDataHora(o.recebidoEm ?? new Date())} (Brasília)`,
    anexos.length
      ? `**Anexos do cliente:** ${anexos.map(a => `${a.nome} (${tamanhoLegivel(a.tamanho)})${a.antivirus === 'infectado' ? ' — bloqueado pelo antivírus' : ''}`).join('; ')}`
      : '**Anexos do cliente:** nenhum',
    '',
    `**Para ler o e-mail completo, baixar os anexos e responder ao cliente:** botão "Abrir sistema externo"${link ? ` (${link})` : ''}.`
  ].join('\n').trim()
}

export async function enfileirarResposta(o: {
  lote: Batch
  destinatario: Recipient
  inboundId: number
  de: string | null
  assunto: string | null
  recebidoEm: Date | null
  trecho: string | null
}) {
  const quem = o.destinatario.nome || o.destinatario.email
  const descricao = await textoDaResposta({
    ...o,
    quem,
    empresa: o.destinatario.empresa,
    referente: `ao envio "${o.lote.nome}" (código ${o.destinatario.codigo})`
  })

  await useDb().insert(ticketsPainel).values({
    motivo: 'resposta',
    batchId: o.lote.id,
    recipientId: o.destinatario.id,
    inboundId: o.inboundId,
    solicitanteUserId: solicitanteDo(o.lote),
    titulo: `Resposta de ${quem} — ${o.lote.nome}`.slice(0, 255),
    descricao,
    externalCode: `comunica:resposta:${o.inboundId}`,
    externalUrl: linkAdmin(`/admin/caixa/${o.inboundId}`) ?? linkAdmin(`/admin/destinatario/${o.destinatario.id}`)
  })
}

/**
 * Resposta do cliente ao e-mail de uma SOLICITACAO (com "criar chamado"
 * ligado). Mesmo jeito do lote: um chamado por resposta, em nome de quem
 * pediu; se o chamado anterior da mesma solicitacao ainda esta aberto, a nova
 * resposta vira comentario nele.
 */
export async function enfileirarRespostaSolic(o: {
  solic: Solicitacao
  codigo: string
  inboundId: number
  de: string | null
  assunto: string | null
  recebidoEm: Date | null
  trecho: string | null
}) {
  const s = o.solic
  const quem = s.destinatarioNome || s.destinatarioEmail
  const descricao = await textoDaResposta({
    ...o,
    quem,
    empresa: s.empresa,
    referente: `por e-mail à solicitação "${s.titulo}" (${o.codigo})`
  })

  await useDb()
    .insert(ticketsPainel)
    .values({
      motivo: 'resposta',
      solicId: s.id,
      inboundId: o.inboundId,
      solicitanteUserId: s.criadoPorUserId,
      titulo: `Resposta de ${quem} — ${s.titulo}`.slice(0, 255),
      descricao,
      externalCode: `comunica:resposta:${o.inboundId}`,
      externalUrl: linkAdmin(`/admin/caixa/${o.inboundId}`) ?? linkAdmin(`/admin/solicitacoes/${s.id}`)
    })
    .onConflictDoNothing()
}

/**
 * A equipe respondeu o cliente pelo Comunica: vira comentario no chamado
 * aberto por aquela mensagem (se houver). A fila espera o chamado existir.
 */
export async function enfileirarRespostaEnviada(o: {
  inboundId: number
  solicitanteUserId: number | null
  porNome: string
  para: string
  texto: string
  anexos: string[]
}) {
  const corpo = [
    `**Respondido ao cliente por ${o.porNome}, pelo Comunica:**`,
    o.texto.trim().slice(0, 15000),
    '',
    `**Para:** ${o.para}`,
    o.anexos.length ? `**Anexos enviados:** ${o.anexos.join('; ')}` : ''
  ]
    .join('\n')
    .trim()
  await useDb()
    .insert(ticketsPainel)
    .values({
      motivo: 'resposta_enviada',
      inboundId: o.inboundId,
      solicitanteUserId: o.solicitanteUserId,
      titulo: 'Resposta enviada ao cliente',
      descricao: corpo,
      externalCode: `comunica:resposta-enviada:${o.inboundId}:${Date.now()}`,
      acao: 'comentar'
    })
}

/**
 * Lotes com "criar chamados" ligado, concluidos ha N dias (N do canal), em que
 * alguem recebeu e ainda nao confirmou. Um chamado por lote, uma vez so (o
 * indice unico do banco garante mesmo com duas instancias).
 */
export async function verificarSemConfirmacao() {
  const sqlc = useSql()
  const lotes = await sqlc<{ id: number }[]>`
    select b.id
      from sys_mail_batches b
      join sys_mail_accounts a on a.id = b.conta_id
     where b.criar_tickets
       and b.status = 'concluido'
       and b.excluido_em is null
       and b.finished_at < now() - make_interval(days => a.dias_sem_confirmacao)
       and not exists (select 1 from sys_mail_tickets t where t.batch_id = b.id and t.motivo = 'sem_confirmacao')
       and exists (select 1 from sys_mail_recipients r
                    where r.batch_id = b.id and r.status = 'enviado' and r.confirmed_at is null)
     limit 20`

  for (const { id } of lotes) {
    const [lote] = await useDb().select().from(batches).where(eq(batches.id, id))
    if (!lote) continue
    const pendentes = await useDb()
      .select({ nome: recipients.nome, email: recipients.email, empresa: recipients.empresa, codigo: recipients.codigo })
      .from(recipients)
      .where(and(eq(recipients.batchId, id), eq(recipients.status, 'enviado'), sql`${recipients.confirmedAt} is null`))
      .limit(51)

    const total =
      (await sqlc<{ n: number }[]>`select count(*)::int n from sys_mail_recipients where batch_id = ${id} and status = 'enviado' and confirmed_at is null`)[0]?.n ?? 0
    const lista = pendentes
      .slice(0, 50)
      .map(p => `- ${p.nome || p.email}${p.empresa ? ` (${p.empresa})` : ''} — ${p.email} — ${p.codigo}`)
    const descricao = [
      `${total} destinatário(s) do envio "${lote.nome}" receberam o e-mail e ainda não confirmaram a leitura.`,
      `Envio concluído em ${formatarDataHora(lote.finishedAt)} (Brasília).`,
      '',
      ...lista,
      total > 50 ? `… e mais ${total - 50}.` : '',
      '',
      linkAdmin(`/admin/lotes/${id}`) ? `Lote: ${linkAdmin(`/admin/lotes/${id}`)} (dá para reenviar para quem não confirmou)` : ''
    ].join('\n').trim()

    await useDb()
      .insert(ticketsPainel)
      .values({
        motivo: 'sem_confirmacao',
        batchId: id,
        solicitanteUserId: solicitanteDo(lote),
        titulo: `${total} cliente(s) sem confirmar a leitura — ${lote.nome}`.slice(0, 255),
        descricao,
        externalCode: `comunica:sem-confirmacao:${id}`,
        externalUrl: linkAdmin(`/admin/lotes/${id}`),
        acao: 'abrir'
      })
      .onConflictDoNothing()
  }
}

/* -------------------------------------------------------------------------- */
/* Processar a fila                                                            */
/* -------------------------------------------------------------------------- */

const MAX_TENTATIVAS = 12

/** teto do que vai anexado num chamado (base64 cresce ~33%; o proxy corta perto de 30 MB) */
const MAX_ANEXOS_CHAMADO = 18 * 1024 * 1024

type AnexoPainel = { nome: string; mimeType: string; base64: string }

/**
 * O .eml original e os arquivos do cliente, para irem anexados ao chamado.
 * Infectado nao vai; passando do teto, vai o que couber (o resto fica no
 * Comunica, e o texto do chamado ja aponta para la).
 */
async function anexosDaMensagem(inboundId: number | null): Promise<AnexoPainel[]> {
  if (!inboundId) return []
  const [m] = await useDb().select({ pasta: inbound.pasta, anexos: inbound.anexos }).from(inbound).where(eq(inbound.id, inboundId))
  if (!m?.pasta) return []
  const saida: AnexoPainel[] = []
  let total = 0
  const incluir = async (arquivo: string, nome: string, mimeType: string) => {
    const dados = await readFile(caminhoDocumento(`${m.pasta}/${arquivo}`)).catch(() => null)
    if (!dados || total + dados.length > MAX_ANEXOS_CHAMADO) return
    total += dados.length
    saida.push({ nome, mimeType, base64: dados.toString('base64') })
  }
  for (const a of (m.anexos ?? []) as AnexoRecebido[]) {
    if (a.antivirus !== 'infectado') await incluir(a.arquivo, a.nome, a.tipo)
  }
  await incluir('mensagem.eml', 'email-do-cliente.eml', 'message/rfc822')
  return saida
}

/** Envia com anexos; se o painel recusar o tamanho, manda sem eles. */
async function comAnexos<T>(cfg: ConfigPainel, caminho: string, corpo: Record<string, unknown>, anexos: AnexoPainel[]) {
  if (!anexos.length) return chamarPainel<T>(cfg, 'POST', caminho, corpo)
  try {
    return await chamarPainel<T>(cfg, 'POST', caminho, { ...corpo, anexos })
  } catch (e) {
    if (!(e instanceof ErroPainel) || ![400, 413].includes(e.status)) throw e
    const nota = '\n\n(Os anexos não couberam no chamado: baixe pelo botão "Abrir sistema externo".)'
    const semAnexos = { ...corpo }
    if (typeof semAnexos.descricao === 'string') semAnexos.descricao += nota
    if (typeof semAnexos.corpo === 'string') semAnexos.corpo += nota
    return chamarPainel<T>(cfg, 'POST', caminho, semAnexos)
  }
}

/** 1, 2, 4, 8... minutos, ate 1h entre tentativas. */
function espera(tentativas: number) {
  return Math.min(60, 2 ** Math.max(0, tentativas - 1)) * 60_000
}

let processando = false

export async function processarFilaTickets() {
  if (processando) return
  processando = true
  try {
    const cfg = await configPainel()
    const db = useDb()
    const pendentes = await db
      .select()
      .from(ticketsPainel)
      .where(and(eq(ticketsPainel.statusEnvio, 'pendente'), lte(ticketsPainel.proximaTentativaEm, new Date())))
      .orderBy(ticketsPainel.id)
      .limit(20)
    if (!pendentes.length) return

    // sem integracao configurada: nao gasta tentativa, so espera
    if (!cfg) {
      await db
        .update(ticketsPainel)
        .set({ erro: 'Integração com o painel não configurada (Configurações → Painel).', proximaTentativaEm: new Date(Date.now() + 30 * 60_000) })
        .where(and(eq(ticketsPainel.statusEnvio, 'pendente'), lte(ticketsPainel.proximaTentativaEm, new Date())))
      return
    }

    for (const t of pendentes) {
      // outra instancia pode ter pegado: so segue quem conseguir "reservar"
      const [reservado] = await db
        .update(ticketsPainel)
        .set({ tentativas: t.tentativas + 1, atualizadoEm: new Date(), proximaTentativaEm: new Date(Date.now() + 10 * 60_000) })
        .where(and(eq(ticketsPainel.id, t.id), eq(ticketsPainel.tentativas, t.tentativas), eq(ticketsPainel.statusEnvio, 'pendente')))
        .returning({ id: ticketsPainel.id })
      if (!reservado) continue

      try {
        let acao = t.acao
        let alvo = t.ticketUuid

        // resposta que a EQUIPE mandou ao cliente: comentario no chamado daquela conversa
        if (t.motivo === 'resposta_enviada' && !alvo) {
          const [dono] = await db
            .select({ uuid: ticketsPainel.ticketUuid, status: ticketsPainel.statusEnvio })
            .from(ticketsPainel)
            .where(and(eq(ticketsPainel.inboundId, t.inboundId!), eq(ticketsPainel.motivo, 'resposta')))
            .orderBy(desc(ticketsPainel.id))
            .limit(1)
          if (!dono) {
            // essa conversa nao virou chamado: nao ha onde comentar
            await db.update(ticketsPainel).set({ statusEnvio: 'ignorado', erro: null, atualizadoEm: new Date() }).where(eq(ticketsPainel.id, t.id))
            continue
          }
          if (!dono.uuid) {
            // o chamado ainda nao saiu: tenta de novo daqui a pouco, sem gastar tentativa
            await db
              .update(ticketsPainel)
              .set({ tentativas: t.tentativas, proximaTentativaEm: new Date(Date.now() + 5 * 60_000) })
              .where(eq(ticketsPainel.id, t.id))
            continue
          }
          acao = 'comentar'
          alvo = dono.uuid
        }

        // resposta: comenta no chamado aberto do MESMO destinatario (lote) ou
        // da MESMA solicitacao, se houver
        if (!acao && t.motivo === 'resposta' && (t.recipientId || t.solicId)) {
          const [anterior] = await db
            .select({ uuid: ticketsPainel.ticketUuid })
            .from(ticketsPainel)
            .where(
              and(
                t.recipientId ? eq(ticketsPainel.recipientId, t.recipientId) : eq(ticketsPainel.solicId, t.solicId!),
                eq(ticketsPainel.motivo, 'resposta'),
                isNotNull(ticketsPainel.ticketUuid),
                ne(ticketsPainel.id, t.id)
              )
            )
            .orderBy(desc(ticketsPainel.id))
            .limit(1)
          acao = 'abrir'
          if (anterior?.uuid) {
            const q = t.solicitanteUserId ? `?solicitanteUserId=${t.solicitanteUserId}` : ''
            const estado = await chamarPainel<RespostaEstado>(cfg, 'GET', `/tickets/${anterior.uuid}${q}`).catch(() => null)
            if (estado && !estado.ticket.status.isFinal) {
              acao = 'comentar'
              alvo = anterior.uuid
            }
          }
        }

        if (acao === 'comentar' && alvo) {
          await comAnexos(
            cfg,
            `/tickets/${alvo}/comentarios`,
            {
              solicitanteUserId: t.solicitanteUserId,
              corpo: t.motivo === 'resposta' ? `**Nova mensagem do cliente**\n\n${t.descricao}` : t.descricao
            },
            t.motivo === 'resposta' ? await anexosDaMensagem(t.inboundId) : []
          )
          await db
            .update(ticketsPainel)
            .set({ acao, ticketUuid: alvo, statusEnvio: 'comentado', erro: null, atualizadoEm: new Date() })
            .where(eq(ticketsPainel.id, t.id))
          // o codigo TCK vem do chamado original
          await db.execute(sql`
            update sys_mail_tickets set ticket_code = (
              select ticket_code from sys_mail_tickets where ticket_uuid = ${alvo} and ticket_code is not null limit 1)
             where id = ${t.id}`)
        } else {
          const r = await comAnexos<RespostaAbrir>(
            cfg,
            '/tickets',
            {
              solicitanteUserId: t.solicitanteUserId,
              titulo: t.titulo,
              descricao: t.descricao,
              externalCode: t.externalCode,
              externalUrl: t.externalUrl ?? undefined,
              metadata: { motivo: t.motivo, loteId: t.batchId, destinatarioId: t.recipientId, solicitacaoId: t.solicId }
            },
            t.motivo === 'resposta' ? await anexosDaMensagem(t.inboundId) : []
          )
          await db
            .update(ticketsPainel)
            .set({
              acao: 'abrir',
              ticketUuid: r.ticket.uuid,
              ticketCode: r.ticket.code,
              statusEnvio: 'criado',
              erro: r.solicitante.substituido
                ? `Aberto em nome de ${r.solicitante.nome}: quem criou o ${t.solicId ? 'pedido' : 'lote'} não pode mais agir no painel.`
                : null,
              atualizadoEm: new Date()
            })
            .where(eq(ticketsPainel.id, t.id))
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        const tentativas = t.tentativas + 1
        // 4xx (fora 408/429) nao melhora tentando de novo: desiste ja
        const semJeito = e instanceof ErroPainel && e.status >= 400 && e.status < 500 && ![408, 429].includes(e.status)
        await db
          .update(ticketsPainel)
          .set({
            erro: msg.slice(0, 1000),
            statusEnvio: semJeito || tentativas >= MAX_TENTATIVAS ? 'erro' : 'pendente',
            proximaTentativaEm: new Date(Date.now() + espera(tentativas)),
            atualizadoEm: new Date()
          })
          .where(eq(ticketsPainel.id, t.id))
        console.error(`[gaulke-mail] chamado no painel falhou (fila #${t.id}, tentativa ${tentativas}): ${msg}`)
      }
    }
  } finally {
    processando = false
  }
}
