import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto'
import type { H3Event } from 'h3'
import { semAspas } from './env'

const COOKIE = 'gaulke_admin'
const VALIDADE_MS = 12 * 60 * 60 * 1000 // 12h

function segredo() {
  const s = semAspas(useRuntimeConfig().sessionSecret || process.env.SESSION_SECRET)
  if (!s) throw new Error('SESSION_SECRET nao configurado no .env')
  return s
}

function assinar(payload: string) {
  return createHmac('sha256', segredo()).update(payload).digest('base64url')
}

function comparar(a: string, b: string) {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

export function senhaConfere(informada: string) {
  const esperada = semAspas(useRuntimeConfig().adminPassword || process.env.ADMIN_PASSWORD)
  if (!esperada) throw new Error('ADMIN_PASSWORD nao configurado no .env')
  // hash dos dois lados para o timingSafeEqual nao vazar o tamanho da senha
  const h = (v: string) => createHmac('sha256', segredo()).update(v).digest('base64url')
  return comparar(h(informada), h(esperada))
}

export function criarSessao(event: H3Event) {
  const expira = Date.now() + VALIDADE_MS
  const payload = `${expira}.${randomBytes(8).toString('hex')}`
  setCookie(event, COOKIE, `${payload}.${assinar(payload)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: !import.meta.dev,
    path: '/',
    maxAge: VALIDADE_MS / 1000
  })
}

export function encerrarSessao(event: H3Event) {
  deleteCookie(event, COOKIE, { path: '/' })
}

export function sessaoValida(event: H3Event) {
  const raw = getCookie(event, COOKIE)
  if (!raw) return false
  const idx = raw.lastIndexOf('.')
  if (idx < 0) return false
  const payload = raw.slice(0, idx)
  const assinatura = raw.slice(idx + 1)
  if (!comparar(assinatura, assinar(payload))) return false
  const expira = Number(payload.split('.')[0])
  return Number.isFinite(expira) && expira > Date.now()
}

export function exigirAdmin(event: H3Event) {
  if (!sessaoValida(event)) {
    throw createError({ statusCode: 401, statusMessage: 'Nao autenticado' })
  }
}
