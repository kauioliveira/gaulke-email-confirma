import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { and, eq } from 'drizzle-orm'
import { useDb, useSql, accounts, type Account } from '../../db'
import { decifrar } from '../cripto'
import { processarMensagem } from './processar'

/**
 * Monitor da caixa de entrada de cada canal (IMAP).
 *
 * SO LE — decisao da empresa: a caixa e usada por gente no Outlook, e nada
 * pode mudar para ela. A caixa e aberta em modo SOMENTE LEITURA (EXAMINE):
 * o servidor nao deixa marcar como lida, mover nem apagar, mesmo que o codigo
 * tentasse. O ponto onde a leitura parou (ultimo UID) fica no banco.
 *
 * Na primeira leitura (ou se o servidor trocar a numeracao — UIDVALIDITY),
 * olha os ultimos DIAS_INICIAIS dias, para pegar devolucoes de envios feitos
 * antes de o monitor ser ligado.
 *
 * Varre a cada 2 minutos. Um advisory lock por canal impede duas instancias
 * da aplicacao de lerem a mesma caixa ao mesmo tempo.
 */

const INTERVALO_MS = 2 * 60_000
const DIAS_INICIAIS = 30
/** teto por passada: uma caixa com milhares de mensagens antigas nao trava o resto */
const MAX_POR_PASSADA = 300
const LOCK_BASE = 827_011_400

let timer: ReturnType<typeof setInterval> | null = null
const lendo = new Set<number>()

export type ResultadoLeitura = {
  ok: boolean
  mensagem: string
  lidas: number
  novas: number
  vinculadas: number
  porTipo: Record<string, number>
}

function cliente(conta: Account) {
  return new ImapFlow({
    host: conta.imapHost || conta.host,
    port: conta.imapPort,
    secure: conta.imapSecure,
    auth: { user: conta.usuario, pass: decifrar(conta.senhaCifrada) },
    tls: { rejectUnauthorized: conta.rejectUnauthorized === 'true' },
    logger: false,
    // uma caixa que nao responde nao pode segurar a passada inteira
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 90_000
  })
}

/**
 * Testa a leitura sem processar nada: conecta, abre a caixa SOMENTE LEITURA
 * e diz quantas mensagens ha. Usa os dados informados (antes de salvar).
 */
export async function testarImap(conta: Pick<Account, 'host' | 'imapHost' | 'imapPort' | 'imapSecure' | 'usuario' | 'senhaCifrada' | 'rejectUnauthorized'>) {
  const c = cliente(conta as Account)
  try {
    await c.connect()
    const caixa = await c.mailboxOpen('INBOX', { readOnly: true })
    return { ok: true, mensagem: `Leitura OK em ${conta.imapHost || conta.host}:${conta.imapPort} — ${caixa.exists} mensagem(ns) na caixa de entrada.` }
  } catch (e) {
    return { ok: false, mensagem: e instanceof Error ? e.message : String(e) }
  } finally {
    await c.logout().catch(() => c.close())
  }
}

/** Le a caixa de UM canal agora. */
export async function lerCaixa(contaId: number): Promise<ResultadoLeitura> {
  const vazio = { lidas: 0, novas: 0, vinculadas: 0, porTipo: {} }
  if (lendo.has(contaId)) return { ok: true, mensagem: 'Leitura já em andamento.', ...vazio }

  const [conta] = await useDb().select().from(accounts).where(eq(accounts.id, contaId))
  if (!conta) return { ok: false, mensagem: 'Canal não encontrado', ...vazio }

  lendo.add(contaId)
  const reservada = await useSql().reserve()
  const c = cliente(conta)
  try {
    const [trava] = await reservada<{ ok: boolean }[]>`select pg_try_advisory_lock(${LOCK_BASE + contaId}) as ok`
    if (!trava?.ok) return { ok: true, mensagem: 'Outra instância está lendo esta caixa.', ...vazio }

    try {
      await c.connect()
      const caixa = await c.mailboxOpen('INBOX', { readOnly: true })
      const uidvalidity = Number(caixa.uidValidity)
      const continuar = conta.imapUidvalidity === uidvalidity && conta.imapUltimoUid !== null

      let uids: number[]
      if (continuar) {
        const desde = conta.imapUltimoUid! + 1
        uids = desde < caixa.uidNext ? ((await c.search({ uid: `${desde}:*` }, { uid: true })) || []) : []
        // "N:*" sempre devolve ao menos a ultima mensagem, mesmo se ela for antiga
        uids = uids.filter(u => u > conta.imapUltimoUid!)
      } else {
        uids = (await c.search({ since: new Date(Date.now() - DIAS_INICIAIS * 86_400_000) }, { uid: true })) || []
      }
      uids.sort((a, b) => a - b)
      const lote = uids.slice(0, MAX_POR_PASSADA)

      const r = { lidas: 0, novas: 0, vinculadas: 0, porTipo: {} as Record<string, number> }
      let maiorUid = continuar ? conta.imapUltimoUid! : 0

      if (lote.length) {
        for await (const msg of c.fetch(lote, { uid: true, source: true }, { uid: true })) {
          if (!msg.source) continue
          r.lidas++
          try {
            const p = await processarMensagem(conta, uidvalidity, msg.uid, await simpleParser(msg.source))
            if (p.novo) {
              r.novas++
              r.porTipo[p.classificacao] = (r.porTipo[p.classificacao] ?? 0) + 1
              if (p.vinculado) r.vinculadas++
            }
          } catch (e) {
            // uma mensagem estranha nao pode parar a leitura das outras
            console.error(`[gaulke-mail] caixa "${conta.nome}": falha na mensagem UID ${msg.uid}:`, e instanceof Error ? e.message : e)
          }
          maiorUid = Math.max(maiorUid, msg.uid)
        }
      }
      // sem mensagem nova na primeira leitura: comeca do fim atual da caixa
      if (!continuar && !lote.length) maiorUid = Math.max(0, caixa.uidNext - 1)

      await useDb()
        .update(accounts)
        .set({
          imapUidvalidity: uidvalidity,
          imapUltimoUid: maiorUid,
          imapUltimaLeituraEm: new Date(),
          imapUltimoErro: null,
          imapUltimoErroEm: null
        })
        .where(eq(accounts.id, contaId))

      const resto = uids.length - lote.length
      return {
        ok: true,
        mensagem: `${r.lidas} lida(s), ${r.novas} nova(s), ${r.vinculadas} ligada(s) a envios${resto > 0 ? ` — faltam ${resto}, continuam na próxima passada` : ''}.`,
        ...r
      }
    } finally {
      await reservada`select pg_advisory_unlock(${LOCK_BASE + contaId})`
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await useDb()
      .update(accounts)
      .set({ imapUltimoErro: msg.slice(0, 1000), imapUltimoErroEm: new Date() })
      .where(eq(accounts.id, contaId))
    console.error(`[gaulke-mail] caixa "${conta.nome}": ${msg}`)
    return { ok: false, mensagem: msg, ...vazio }
  } finally {
    await c.logout().catch(() => c.close())
    reservada.release()
    lendo.delete(contaId)
  }
}

async function passada() {
  try {
    const contas = await useDb()
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.monitorarCaixa, true), eq(accounts.ativa, 'true')))
    // uma caixa por vez: sao poucas, e o servidor de e-mail agradece
    for (const c of contas) await lerCaixa(c.id)
  } catch (e) {
    console.error('[gaulke-mail] monitor da caixa:', e instanceof Error ? e.message : e)
  }
}

export function iniciarMonitorCaixa() {
  if (timer) return
  void passada()
  timer = setInterval(passada, INTERVALO_MS)
  timer.unref?.()
  console.info('[gaulke-mail] monitor da caixa ativo (a cada 2 min, somente leitura)')
}
