import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { and, arrayContains, eq, or } from 'drizzle-orm'
import { useDb, useSql, webhooks, webhookEntregas, type Webhook } from '../db'
import { cifrar, decifrar } from './cripto'
import { baseUrl } from './urls'

/**
 * Webhooks: avisam outro sistema (o n8n, tipicamente) quando algo acontece
 * aqui — "assinatura concluida", "cliente entregou os documentos" — para que
 * ele mova arquivos, abra tarefa, mande WhatsApp...
 *
 * Como funciona:
 *  - o evento entra numa FILA no banco (sys_mail_webhook_entregas), uma linha
 *    por webhook interessado. Emitir nunca falha nem atrasa quem emitiu: a
 *    assinatura do cliente nao pode dar erro porque o n8n esta fora;
 *  - o agendador entrega a fila a cada 30s, com novas tentativas espacadas
 *    (1 min, 5 min, 15 min, 1 h, 3 h, 6 h) e desiste depois de 7;
 *  - cada entrega vai assinada: X-Gaulke-Assinatura = sha256=HMAC(segredo,
 *    "<timestamp>.<corpo>"). O n8n confere e descarta o que nao veio daqui;
 *  - o payload leva IDs, nomes, e-mails e LINKS para as telas — nunca o
 *    arquivo em si nem segredos. Quem precisar do PDF busca pela API.
 */

export const EVENTOS_WEBHOOK = {
  'lote.concluido': 'Lote terminou de enviar',
  'comunicado.confirmado': 'Destinatário confirmou o recebimento',
  'comunicado.respondido': 'Destinatário respondeu o e-mail',
  'comunicado.devolvido': 'E-mail devolvido (endereço inexistente)',
  'solicitacao.entregue': 'Cliente entregou os documentos obrigatórios',
  'solicitacao.concluida': 'Solicitação concluída',
  'solicitacao.respondida': 'Cliente respondeu o e-mail da solicitação',
  'assinatura.assinada': 'Um signatário assinou',
  'assinatura.recusada': 'Um signatário recusou',
  'assinatura.concluida': 'Documento assinado por todos'
} as const

export type EventoWebhook = keyof typeof EVENTOS_WEBHOOK | 'teste'

const ESPERAS_MIN = [1, 5, 15, 60, 180, 360]
const MAX_TENTATIVAS = ESPERAS_MIN.length + 1
const TIMEOUT_MS = 10_000

export function novoSegredo() {
  return `whsec_${randomBytes(24).toString('base64url')}`
}

export function cifrarSegredo(s: string) {
  return cifrar(s)
}

/** Corpo e cabecalhos de uma entrega. Exportado para o teste conferir o HMAC. */
export function montarEntrega(segredo: string, entrega: { uuid: string; evento: string; payload: unknown }, agora = Date.now()) {
  const corpo = JSON.stringify({ id: entrega.uuid, evento: entrega.evento, ...(entrega.payload as object) })
  const ts = String(Math.floor(agora / 1000))
  const assinatura = createHmac('sha256', segredo).update(`${ts}.${corpo}`).digest('hex')
  return {
    corpo,
    cabecalhos: {
      'content-type': 'application/json',
      'user-agent': 'Gaulke-Comunica-Webhook/1.0',
      'x-gaulke-evento': entrega.evento,
      'x-gaulke-entrega': entrega.uuid,
      'x-gaulke-timestamp': ts,
      'x-gaulke-assinatura': `sha256=${assinatura}`
    }
  }
}

/**
 * Enfileira um evento para todos os webhooks ativos que o assinam. NUNCA lanca.
 * `dados` e o que o n8n recebe em `dados`; o link da tela vai em `link`.
 */
export async function emitirWebhook(evento: EventoWebhook, dados: Record<string, unknown>, linkTela?: string | null) {
  try {
    const alvos = await useDb()
      .select({ id: webhooks.id })
      .from(webhooks)
      .where(
        and(
          eq(webhooks.ativo, true),
          or(arrayContains(webhooks.eventos, [evento]), arrayContains(webhooks.eventos, ['*']))
        )
      )
    if (!alvos.length) return 0
    const payload = {
      ocorridoEm: new Date().toISOString(),
      origem: 'gaulke-comunica',
      link: linkTela ? `${baseUrl()}${linkTela}` : null,
      dados
    }
    await useDb()
      .insert(webhookEntregas)
      .values(alvos.map(a => ({ webhookId: a.id, entregaUuid: randomUUID(), evento, payload: payload as never })))
    return alvos.length
  } catch (e) {
    console.error(`[gaulke-mail] webhook ${evento}: falha ao enfileirar:`, e instanceof Error ? e.message : e)
    return 0
  }
}

type ResultadoEntrega = { ok: boolean; status: number | null; erro: string | null; ms: number }

async function postar(w: Pick<Webhook, 'url' | 'segredoCifrado'>, entrega: { uuid: string; evento: string; payload: unknown }): Promise<ResultadoEntrega> {
  const inicio = Date.now()
  let segredo: string
  try {
    segredo = decifrar(w.segredoCifrado)
  } catch {
    return { ok: false, status: null, erro: 'segredo ilegível (a chave de cifra mudou?)', ms: 0 }
  }
  const { corpo, cabecalhos } = montarEntrega(segredo, entrega)
  try {
    const resp = await fetch(w.url, {
      method: 'POST',
      headers: cabecalhos,
      body: corpo,
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    const ok = resp.status >= 200 && resp.status < 300
    let erro: string | null = null
    if (!ok) {
      const texto = await resp.text().catch(() => '')
      erro = `HTTP ${resp.status}${texto ? `: ${texto.slice(0, 300)}` : ''}`
    }
    return { ok, status: resp.status, erro, ms: Date.now() - inicio }
  } catch (e) {
    const msg = e instanceof Error ? (e.name === 'TimeoutError' ? `sem resposta em ${TIMEOUT_MS / 1000}s` : e.message) : String(e)
    const causa = e instanceof Error && e.cause instanceof Error ? ` (${e.cause.message})` : ''
    return { ok: false, status: null, erro: `${msg}${causa}`, ms: Date.now() - inicio }
  }
}

/** Entrega de teste, na hora, sem passar pela fila: a tela mostra o resultado. */
export async function testarWebhook(w: Webhook) {
  const r = await postar(w, {
    uuid: randomUUID(),
    evento: 'teste',
    payload: {
      ocorridoEm: new Date().toISOString(),
      origem: 'gaulke-comunica',
      link: `${baseUrl()}/admin/configuracoes`,
      dados: { mensagem: 'Teste do webhook do Gaulke Comunica', webhook: w.nome }
    }
  })
  await useDb()
    .update(webhooks)
    .set({ ultimaEntregaEm: new Date(), ultimoStatus: r.status, ultimoErro: r.erro })
    .where(eq(webhooks.id, w.id))
  return r
}

let processando = false

/**
 * Entrega o que esta na fila. Reivindica com FOR UPDATE SKIP LOCKED e ja
 * empurra a proxima tentativa: duas instancias nunca mandam a mesma entrega
 * ao mesmo tempo, e uma queda no meio nao deixa a linha presa.
 */
export async function processarWebhooks() {
  if (processando) return
  processando = true
  try {
    const sql = useSql()
    const lote = await sql<
      { id: number; webhook_id: number; entrega_uuid: string; evento: string; payload: unknown; tentativas: number }[]
    >`
      update sys_mail_webhook_entregas e
         set proxima_tentativa_em = now() + interval '2 minutes'
       where e.id in (
         select id from sys_mail_webhook_entregas
          where status = 'pendente' and proxima_tentativa_em <= now()
          order by id
          limit 20
          for update skip locked)
      returning e.id, e.webhook_id, e.entrega_uuid, e.evento, e.payload, e.tentativas`
    if (!lote.length) return

    const ws = new Map(
      (await useDb().select().from(webhooks)).map(w => [w.id, w])
    )
    for (const e of lote) {
      const w = ws.get(e.webhook_id)
      if (!w || !w.ativo) {
        // desligado depois de enfileirar: nao entrega, e nao insiste
        await sql`update sys_mail_webhook_entregas set status = 'erro', ultimo_erro = 'webhook desativado' where id = ${e.id}`
        continue
      }
      const r = await postar(w, { uuid: e.entrega_uuid, evento: e.evento, payload: e.payload })
      const tentativas = e.tentativas + 1
      if (r.ok) {
        await sql`
          update sys_mail_webhook_entregas
             set status = 'entregue', tentativas = ${tentativas}, entregue_em = now(),
                 ultimo_status_http = ${r.status}, ultimo_erro = null
           where id = ${e.id}`
      } else {
        const desistiu = tentativas >= MAX_TENTATIVAS
        const espera = ESPERAS_MIN[Math.min(tentativas - 1, ESPERAS_MIN.length - 1)]!
        await sql`
          update sys_mail_webhook_entregas
             set status = ${desistiu ? 'erro' : 'pendente'}, tentativas = ${tentativas},
                 ultimo_status_http = ${r.status}, ultimo_erro = ${r.erro},
                 proxima_tentativa_em = now() + make_interval(mins => ${espera})
           where id = ${e.id}`
      }
      await sql`
        update sys_mail_webhooks
           set ultima_entrega_em = now(), ultimo_status = ${r.status}, ultimo_erro = ${r.ok ? null : r.erro}
         where id = ${w.id}`
    }
  } catch (e) {
    console.error('[gaulke-mail] webhooks:', e instanceof Error ? e.message : e)
  } finally {
    processando = false
  }
}
