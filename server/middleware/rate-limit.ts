import { consumir } from '../utils/limite'
import { clientIp } from '../utils/request'

/**
 * Freio das rotas PUBLICAS.
 *
 * Toda politica fica aqui, num lugar so, porque as regras conversam entre si
 * e espalha-las pelos handlers faria elas divergirem com o tempo.
 *
 * Por que existe: os quatro endpoints publicos gravam uma linha em
 * sys_mail_events a cada acerto. Essa tabela E a evidencia que o sistema
 * vende — um loop na URL do pixel infla a trilha de auditoria sem esforco.
 */

const MINUTO = 60_000

function num(env: string | undefined, padrao: number) {
  const n = Number(env)
  return Number.isFinite(n) && n > 0 ? n : padrao
}

const LIMITES = {
  landing: num(process.env.RATE_LIMIT_LANDING, 60),
  confirmar: num(process.env.RATE_LIMIT_CONFIRMAR, 10),
  arquivo: num(process.env.RATE_LIMIT_ARQUIVO, 20),
  pixel: num(process.env.RATE_LIMIT_PIXEL, 60),
  // freio geral por IP: barra varredura de tokens sem punir uso legitimo
  porIp: num(process.env.RATE_LIMIT_IP, 200)
}

/**
 * A chave e IP + TOKEN, nao so IP.
 *
 * Rede corporativa faz NAT: dezenas de pessoas saem pelo mesmo endereco.
 * Limitar por IP puro bloquearia uma empresa inteira quando um comunicado
 * fosse aberto por todo mundo ao mesmo tempo. Pessoas diferentes tem tokens
 * diferentes, entao o MESMO token martelado do MESMO IP e que e abuso.
 */
function chave(prefixo: string, ip: string, token: string) {
  return `${prefixo}:${ip}:${token}`
}

function extrairToken(path: string) {
  const m =
    path.match(/^\/api\/c\/([^/]+)/) ||
    path.match(/^\/t\/o\/([^/]+)\//)
  return m?.[1] ?? ''
}

function recusar(event: Parameters<typeof setResponseHeader>[0], resetEmMs: number): never {
  const segundos = Math.max(1, Math.ceil(resetEmMs / 1000))
  setResponseHeader(event, 'retry-after', segundos)
  throw createError({
    statusCode: 429,
    statusMessage: `Muitas requisicoes. Tente novamente em ${segundos}s.`
  })
}

export default defineEventHandler(event => {
  const path = getRequestURL(event).pathname

  const ehPixel = path.startsWith('/t/o/')
  const ehLanding = path.startsWith('/api/c/')
  if (!ehPixel && !ehLanding) return

  const ip = clientIp(event) || 'desconhecido'
  const token = extrairToken(path)

  // freio geral por IP, antes do especifico
  const geral = consumir(`ip:${ip}`, LIMITES.porIp, MINUTO)
  if (!geral.permitido) {
    // mesmo estourando, o pixel nunca devolve erro (veja abaixo)
    if (ehPixel) {
      event.context.pularRegistro = true
      return
    }
    recusar(event, geral.resetEmMs)
  }

  if (ehPixel) {
    const r = consumir(chave('pixel', ip, token), LIMITES.pixel, MINUTO)
    /**
     * O PIXEL NUNCA RETORNA ERRO. Um 429 renderiza imagem quebrada dentro do
     * e-mail do cliente. Excedido o limite, o handler devolve o PNG normal e
     * apenas NAO registra a abertura.
     */
    if (!r.permitido) event.context.pularRegistro = true
    return
  }

  if (path.endsWith('/confirmar')) {
    const r = consumir(chave('confirmar', ip, token), LIMITES.confirmar, MINUTO)
    if (!r.permitido) recusar(event, r.resetEmMs)
    return
  }

  if (path.endsWith('/arquivo')) {
    const r = consumir(chave('arquivo', ip, token), LIMITES.arquivo, MINUTO)
    if (!r.permitido) recusar(event, r.resetEmMs)
    return
  }

  const r = consumir(chave('landing', ip, token), LIMITES.landing, MINUTO)
  if (!r.permitido) recusar(event, r.resetEmMs)
})
