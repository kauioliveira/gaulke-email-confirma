import type { H3Event } from 'h3'
import { contar, marcar, msAteReset, zerar } from './limite'
import { clientIp } from './request'

/**
 * Trava de forca bruta no login.
 *
 * Conta FALHAS, e nao requisicoes: quem acerta a senha nunca e penalizado,
 * por mais que entre e saia. O atraso fixo de 600ms do handler continua
 * valendo — ele encarece cada tentativa; esta trava limita quantas existem.
 */

const JANELA_MS = 10 * 60 * 1000
const MAX_FALHAS = Number(process.env.RATE_LIMIT_LOGIN_FALHAS) || 5

function chave(event: H3Event) {
  return `login:${clientIp(event) || 'desconhecido'}`
}

/** Segundos restantes de bloqueio, ou 0 se pode tentar. */
export function bloqueioRestante(event: H3Event) {
  const k = chave(event)
  if (contar(k, JANELA_MS) < MAX_FALHAS) return 0
  return Math.max(1, Math.ceil(msAteReset(k, JANELA_MS) / 1000))
}

export function registrarFalha(event: H3Event) {
  return marcar(chave(event), JANELA_MS)
}

/** Login correto limpa o historico daquele IP. */
export function registrarSucesso(event: H3Event) {
  zerar(chave(event))
}
