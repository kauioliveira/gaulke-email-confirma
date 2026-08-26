import nodemailer, { type Transporter } from 'nodemailer'
import { semAspas } from './env'

let _transporter: Transporter | null = null

function bool(v: unknown, padrao = false) {
  if (v === undefined || v === null || v === '') return padrao
  return ['1', 'true', 'yes', 'sim', 'on'].includes(String(v).toLowerCase())
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

/** Transporter com pool: a conexao SMTP e reaproveitada por todo o lote. */
export function useTransporter() {
  if (_transporter) return _transporter
  const c = smtpConfig()
  if (!c.host) throw new Error('NUXT_SMTP_HOST nao configurado no .env')

  _transporter = nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.secure,
    requireTLS: c.requireTLS,
    auth: c.user ? { user: c.user, pass: c.pass } : undefined,
    tls: { rejectUnauthorized: c.rejectUnauthorized },
    pool: true,
    maxConnections: 1,
    maxMessages: 100
  })
  return _transporter
}

export async function verificarSmtp() {
  const c = smtpConfig()
  if (!c.enabled) return { ok: false, mensagem: 'NUXT_SMTP_ENABLED=false' }
  try {
    await useTransporter().verify()
    return { ok: true, mensagem: `Conectado em ${c.host}:${c.port}` }
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
}) {
  const c = smtpConfig()
  if (!c.enabled) {
    throw new Error('Envio desabilitado: NUXT_SMTP_ENABLED=false')
  }
  const paraRecibo = c.replyTo || c.from

  const info = await useTransporter().sendMail({
    from: c.from,
    replyTo: c.replyTo || undefined,
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
