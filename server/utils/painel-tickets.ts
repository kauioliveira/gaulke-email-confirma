import { and, desc, eq, isNotNull, lte, ne, sql } from 'drizzle-orm'
import { useDb, useSql, ticketsPainel, batches, recipients, type Batch, type Recipient } from '../db'
import { lerConfig } from './config'
import { decifrar } from './cripto'
import { semAspas } from './env'
import { baseUrl } from './urls'

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
  const r = await fetch(`${cfg.url}/api/integracoes/comunica${caminho}`, {
    method: metodo,
    headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json', accept: 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(20000)
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
  const descricao = [
    `${quem}${o.destinatario.empresa ? ` (${o.destinatario.empresa})` : ''} respondeu ao envio "${o.lote.nome}".`,
    '',
    `De: ${o.de ?? o.destinatario.email}`,
    `Assunto: ${o.assunto ?? '—'}`,
    `Recebida em: ${formatarDataHora(o.recebidoEm)} (Brasília)`,
    `Código do envio: ${o.destinatario.codigo}`,
    '',
    'Mensagem:',
    o.trecho?.trim() || '(sem texto — veja a mensagem na caixa de e-mail)',
    '',
    linkAdmin(`/admin/destinatario/${o.destinatario.id}`) ? `Histórico do destinatário: ${linkAdmin(`/admin/destinatario/${o.destinatario.id}`)}` : ''
  ].join('\n').trim()

  await useDb().insert(ticketsPainel).values({
    motivo: 'resposta',
    batchId: o.lote.id,
    recipientId: o.destinatario.id,
    inboundId: o.inboundId,
    solicitanteUserId: solicitanteDo(o.lote),
    titulo: `Resposta de ${quem} — ${o.lote.nome}`.slice(0, 255),
    descricao,
    externalCode: `comunica:resposta:${o.inboundId}`,
    externalUrl: linkAdmin(`/admin/destinatario/${o.destinatario.id}`)
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

        // resposta: comenta no chamado aberto do MESMO destinatario, se houver
        if (!acao && t.motivo === 'resposta' && t.recipientId) {
          const [anterior] = await db
            .select({ uuid: ticketsPainel.ticketUuid })
            .from(ticketsPainel)
            .where(
              and(
                eq(ticketsPainel.recipientId, t.recipientId),
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
          await chamarPainel(cfg, 'POST', `/tickets/${alvo}/comentarios`, {
            solicitanteUserId: t.solicitanteUserId,
            corpo: `Nova mensagem do cliente:\n\n${t.descricao}`
          })
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
          const r = await chamarPainel<RespostaAbrir>(cfg, 'POST', '/tickets', {
            solicitanteUserId: t.solicitanteUserId,
            titulo: t.titulo,
            descricao: t.descricao,
            externalCode: t.externalCode,
            externalUrl: t.externalUrl ?? undefined,
            metadata: { motivo: t.motivo, loteId: t.batchId, destinatarioId: t.recipientId }
          })
          await db
            .update(ticketsPainel)
            .set({
              acao: 'abrir',
              ticketUuid: r.ticket.uuid,
              ticketCode: r.ticket.code,
              statusEnvio: 'criado',
              erro: r.solicitante.substituido ? `Aberto em nome de ${r.solicitante.nome}: quem criou o lote não pode mais agir no painel.` : null,
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
