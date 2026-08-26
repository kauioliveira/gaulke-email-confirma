import { semAspas } from './env'
import { lookup } from 'node:dns/promises'

/**
 * URL_ACESSO e a base publica de TUDO que vai dentro do e-mail:
 * link do botao, pixel de abertura e logo. Nada e hardcoded.
 */
export function baseUrl() {
  const raw = useRuntimeConfig().public.urlAcesso || process.env.URL_ACESSO
  return semAspas(raw).replace(/\/+$/, '')
}

/** Subcaminho em que o app esta servindo ('' quando e a raiz). */
export function basePath() {
  return (useRuntimeConfig().app?.baseURL || '/').replace(/\/+$/, '')
}

/**
 * Base usada pelo PREVIEW na tela: o proprio endereco de onde a requisicao
 * veio. Assim o operador enxerga a logo mesmo antes de o app estar publicado
 * no endereco definitivo de URL_ACESSO.
 */
export function baseUrlDoRequest(event: Parameters<typeof getRequestURL>[0]) {
  return `${getRequestURL(event).origin}${basePath()}`
}

export function linkAcesso(token: string, base = baseUrl()) {
  return `${base}/c/${token}`
}

export function linkPixel(token: string, base = baseUrl()) {
  return `${base}/t/o/${token}/pixel.png`
}

export function linkLogo(base = baseUrl()) {
  return `${base}/brand/logo.png`
}

/** Avisa no boot e na barra do admin quando a base publica nao serve. */
export function checarBaseUrl() {
  const url = baseUrl()
  if (!url) return 'URL_ACESSO nao esta definida no .env — os links do e-mail nao vao funcionar.'

  let caminho: string
  try {
    caminho = new URL(url).pathname.replace(/\/+$/, '')
  } catch {
    return `URL_ACESSO ("${url}") nao e uma URL valida.`
  }

  /**
   * O erro mais silencioso do sistema: URL_ACESSO aponta para um subcaminho
   * que o app nao esta servindo. Nada quebra no envio — mas a logo, o botao
   * e o pixel dao 404 na caixa de entrada de todo mundo.
   */
  const app = basePath()
  if (caminho !== app) {
    return (
      `URL_ACESSO aponta para "${caminho || '/'}" mas o app esta servindo em "${app || '/'}". ` +
      `A logo, o botao e o pixel dos e-mails vao dar 404. ` +
      (caminho
        ? `Suba o app com NUXT_APP_BASE_URL=${caminho}/ ou remova "${caminho}" de URL_ACESSO.`
        : `Remova NUXT_APP_BASE_URL ou acrescente "${app}" a URL_ACESSO.`)
    )
  }

  if (/localhost|127\.0\.0\.1/.test(url)) {
    return `URL_ACESSO aponta para "${url}" — destinatarios externos nao conseguirao abrir esse link.`
  }
  return null
}

/** 10.x, 172.16-31.x, 192.168.x, 127.x e o link-local 169.254.x */
function ehIpPrivado(ip: string) {
  const p = ip.split('.').map(Number)
  if (p.length !== 4 || p.some(n => Number.isNaN(n))) return false
  const [a, b] = p as [number, number]
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  )
}

let avisoAlcance: string | null = null

/** Ultimo resultado de `checarAlcancePublico`, exposto no /api/admin/status. */
export function alcancePublico() {
  return avisoAlcance
}

/**
 * Resolve o host de URL_ACESSO e avisa quando ele aponta para a rede interna.
 *
 * Este e o erro mais confuso do sistema porque ele funciona pela metade: de
 * dentro da empresa o link abre normalmente e o acesso e registrado, mas o
 * servidor de e-mail do destinatario (o proxy de imagens do Gmail, por
 * exemplo) esta na internet e nao alcanca 192.168.x. Resultado: a logo nao
 * carrega, o pixel nunca dispara e "Aberturas" fica zerado para sempre —
 * sem nenhum erro aparecer em lugar nenhum.
 *
 * Roda uma vez, no boot: DNS a cada request seria desperdicio.
 */
export async function checarAlcancePublico() {
  avisoAlcance = null
  const url = baseUrl()
  if (!url) return null

  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    return null
  }

  try {
    const { address } = await lookup(host, { family: 4 })
    if (ehIpPrivado(address)) {
      avisoAlcance =
        `URL_ACESSO (${host}) resolve para ${address}, um endereco de rede interna. ` +
        `Servidores de e-mail externos nao alcancam esse IP: a logo do e-mail nao ` +
        `carrega e o pixel de abertura nunca dispara, entao "Aberturas" fica zerado. ` +
        `Links clicados de dentro da rede continuam funcionando.`
    }
  } catch {
    avisoAlcance = `Nao foi possivel resolver o host de URL_ACESSO (${host}).`
  }

  return avisoAlcance
}
