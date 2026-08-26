import { semAspas } from './env'
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
