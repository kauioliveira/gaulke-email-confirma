import { eq } from 'drizzle-orm'
import { useDb, recipients } from '../../../../db'
import { registrarAbertura } from '../../../../utils/tracking'

// PNG 1x1 totalmente transparente
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)

/**
 * Pixel de abertura em /t/o/:token/pixel.png
 *
 * O token fica em um segmento proprio de proposito: o roteador do Nitro nao
 * extrai o parametro quando a extensao vem colada nele (/t/o/[token].png).
 *
 * ATENCAO: este sinal e apenas um INDICIO. Apple Mail, Gmail e antivirus
 * corporativos pre-carregam imagens sozinhos (falso positivo) e quem bloqueia
 * imagens nunca dispara (falso negativo). Por isso cada abertura e
 * classificada em `maquina` ou `provavel-pessoa` — veja utils/abertura.ts.
 * A prova real de leitura continua sendo a confirmacao explicita na landing.
 */
export default defineEventHandler(async event => {
  const responder = () => {
    setResponseHeaders(event, {
      'content-type': 'image/png',
      'cache-control': 'no-store, no-cache, must-revalidate, private',
      pragma: 'no-cache',
      expires: '0'
    })
    return PIXEL
  }

  const token = getRouterParam(event, 'token') || ''
  if (!token) return responder()

  try {
    const r = (
      await useDb()
        .select({ id: recipients.id, sentAt: recipients.sentAt })
        .from(recipients)
        .where(eq(recipients.token, token))
    )[0]
    if (r) await registrarAbertura(event, r)
  } catch (e) {
    // rastreio nunca pode quebrar a renderizacao do e-mail
    console.error('[gaulke-mail] falha ao registrar abertura:', e instanceof Error ? e.message : e)
  }
  return responder()
})
