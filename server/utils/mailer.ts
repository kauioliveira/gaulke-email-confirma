import nodemailer, { type Transporter } from 'nodemailer'
import { eq, and } from 'drizzle-orm'
import { useDb, accounts, type Account } from '../db'
import { semAspas } from './env'
import { decifrar } from './cripto'

function bool(v: unknown, padrao = false) {
  if (v === undefined || v === null || v === '') return padrao
  return ['1', 'true', 'yes', 'sim', 'on'].includes(String(v).toLowerCase())
}

/**
 * Uma conta de envio ja resolvida e pronta para conectar.
 *
 * `id` nulo identifica a conta que vem do .env — a que existia antes das
 * contas irem para o banco. Ela continua valendo como ultimo recurso para que
 * uma instalacao sem nenhuma conta cadastrada nao fique sem enviar.
 */
export type ContaSmtp = {
  id: number | null
  nome: string
  enabled: boolean
  host: string
  port: number
  secure: boolean
  requireTLS: boolean
  rejectUnauthorized: boolean
  user: string
  pass: string
  from: string
  replyTo: string
  /** muda quando algo da conexao muda; e o que invalida o pool */
  versao: string
}

export function smtpConfig() {
  const c = useRuntimeConfig().smtp
  // NUXT_SMTP_FROM costuma vir entre aspas por causa do formato
  // Nome <email@dominio>; o --env-file do Docker nao as remove.
  return {
    enabled: bool(semAspas(c.enabled), true),
    host: semAspas(c.host),
    port: Number(semAspas(c.port) || 587),
    secure: bool(semAspas(c.secure)),
    requireTLS: bool(semAspas(c.requireTls), true),
    rejectUnauthorized: bool(semAspas(c.rejectUnauthorized), true),
    user: semAspas(c.user),
    pass: semAspas(c.pass),
    from: semAspas(c.from),
    replyTo: semAspas(c.replyTo)
  }
}

/** A conta herdada do .env, apresentada no mesmo formato das do banco. */
export function contaDoEnv(): ContaSmtp {
  const c = smtpConfig()
  return { id: null, nome: 'SMTP do .env', versao: 'env', ...c }
}

/** Converte uma linha do banco em conta utilizavel — aqui a senha e decifrada. */
export function contaDaLinha(a: Account): ContaSmtp {
  return {
    id: a.id,
    nome: a.nome,
    enabled: a.ativa === 'true',
    host: a.host,
    port: a.port,
    secure: a.secure === 'true',
    requireTLS: a.requireTls === 'true',
    rejectUnauthorized: a.rejectUnauthorized === 'true',
    user: a.usuario,
    pass: decifrar(a.senhaCifrada),
    from: a.remetente,
    replyTo: a.responderPara || '',
    versao: `${a.id}:${a.updatedAt.getTime()}`
  }
}

/**
 * Descobre qual conta usar.
 *
 * A ordem existe para que nada pare de funcionar durante a transicao: lotes
 * antigos nao tem conta_id, e uma instalacao nova pode ainda nao ter cadastrado
 * nenhuma conta.
 */
export async function resolverConta(contaId?: number | null): Promise<ContaSmtp> {
  const db = useDb()

  if (contaId) {
    const [a] = await db.select().from(accounts).where(eq(accounts.id, contaId))
    if (!a) throw new Error(`conta de envio ${contaId} nao existe mais`)
    if (a.ativa !== 'true') throw new Error(`a conta "${a.nome}" esta desativada`)
    return contaDaLinha(a)
  }

  const [padrao] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.padrao, 'true'), eq(accounts.ativa, 'true')))
    .limit(1)
  if (padrao) return contaDaLinha(padrao)

  const [qualquer] = await db.select().from(accounts).where(eq(accounts.ativa, 'true')).limit(1)
  if (qualquer) return contaDaLinha(qualquer)

  return contaDoEnv()
}

/**
 * Transporters com pool, um por conta.
 *
 * A conexao e reaproveitada por todo o lote; a chave inclui a versao da conta
 * para que editar as credenciais derrube o pool antigo em vez de continuar
 * enviando com a senha velha.
 */
const pools = new Map<string, Transporter>()

export function transportador(conta: ContaSmtp) {
  if (!conta.host) throw new Error(`conta "${conta.nome}" sem servidor SMTP configurado`)

  const chave = conta.versao
  const existente = pools.get(chave)
  if (existente) return existente

  // Sobrou pool de uma versao anterior desta mesma conta: fecha, senao a
  // conexao antiga fica aberta ate o servidor SMTP desistir.
  for (const [k, t] of pools) {
    if (conta.id !== null && k.startsWith(`${conta.id}:`)) {
      t.close()
      pools.delete(k)
    }
  }

  const t = nodemailer.createTransport({
    host: conta.host,
    port: conta.port,
    secure: conta.secure,
    requireTLS: conta.requireTLS,
    auth: conta.user ? { user: conta.user, pass: conta.pass } : undefined,
    tls: { rejectUnauthorized: conta.rejectUnauthorized },
    pool: true,
    maxConnections: 1,
    maxMessages: 100
  })
  pools.set(chave, t)
  return t
}

/**
 * Testa a conexao de uma conta SEM guardar nada.
 *
 * Usa um transporter descartavel de proposito: testar credenciais novas nao
 * pode reaproveitar — nem envenenar — o pool que os lotes estao usando.
 */
export async function verificarConta(conta: ContaSmtp) {
  if (!conta.host) return { ok: false, mensagem: 'Servidor SMTP nao informado' }
  const t = nodemailer.createTransport({
    host: conta.host,
    port: conta.port,
    secure: conta.secure,
    requireTLS: conta.requireTLS,
    auth: conta.user ? { user: conta.user, pass: conta.pass } : undefined,
    tls: { rejectUnauthorized: conta.rejectUnauthorized },
    // sem pool: e uma conexao so, que morre no fim do teste
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000
  })
  try {
    await t.verify()
    return { ok: true, mensagem: `Conectado em ${conta.host}:${conta.port} como ${conta.user}` }
  } catch (e) {
    return { ok: false, mensagem: e instanceof Error ? e.message : String(e) }
  } finally {
    t.close()
  }
}

/** Diagnostico da barra do admin: estado da conta que seria usada agora. */
export async function verificarSmtp() {
  try {
    const conta = await resolverConta()
    if (!conta.enabled) {
      return { ok: false, mensagem: conta.id === null ? 'NUXT_SMTP_ENABLED=false' : 'conta desativada' }
    }
    const r = await verificarConta(conta)
    return { ...r, mensagem: `${conta.nome}: ${r.mensagem}` }
  } catch (e) {
    return { ok: false, mensagem: e instanceof Error ? e.message : String(e) }
  }
}

export async function enviarEmail(opts: {
  para: string
  assunto: string
  html: string
  texto?: string
  headers?: Record<string, string>
  /**
   * Pede recibo de leitura ao cliente de e-mail do destinatario.
   * Vale lembrar: a maioria dos clientes ignora, e os que respeitam mostram
   * um "deseja confirmar a leitura?" que a pessoa pode recusar. Serve como
   * sinal extra, nunca como prova.
   */
  pedirRecibo?: boolean
  /** conta ja resolvida; sem ela, resolve a padrao */
  conta?: ContaSmtp
}) {
  const conta = opts.conta ?? (await resolverConta())
  if (!conta.enabled) {
    throw new Error(
      conta.id === null
        ? 'Envio desabilitado: NUXT_SMTP_ENABLED=false'
        : `Envio desabilitado: a conta "${conta.nome}" esta desativada`
    )
  }
  const paraRecibo = conta.replyTo || conta.from

  const info = await transportador(conta).sendMail({
    from: conta.from,
    replyTo: conta.replyTo || undefined,
    to: opts.para,
    subject: opts.assunto,
    html: opts.html,
    text: opts.texto,
    headers: {
      ...opts.headers,
      // os tres cabecalhos cobrem clientes diferentes: o padrao (RFC 8098),
      // o legado do Netscape e o do Outlook
      ...(opts.pedirRecibo && paraRecibo
        ? {
            'Disposition-Notification-To': paraRecibo,
            'Return-Receipt-To': paraRecibo,
            'X-Confirm-Reading-To': paraRecibo
          }
        : {})
    }
  })
  return { messageId: info.messageId as string, response: info.response as string }
}
