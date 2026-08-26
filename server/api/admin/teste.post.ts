import { z } from 'zod'
import { renderizar, renderizarAssunto, versaoTexto } from '../../utils/render'
import { novoToken, novoCodigo } from '../../utils/ids'
import { enviarEmail } from '../../utils/mailer'

const schema = z.object({
  para: z.string().email(),
  assunto: z.string().min(1),
  html: z.string().min(1)
})

/**
 * Envio de teste antes do lote — evita queimar centenas de e-mails com um
 * HTML quebrado. Os links funcionam, mas nao ha destinatario real no banco,
 * entao nada e rastreado.
 */
export default defineEventHandler(async event => {
  const { para, assunto, html } = schema.parse(await readBody(event))
  const vars = {
    nome: 'Teste Gaulke',
    email: para,
    empresa: 'Empresa Exemplo LTDA',
    codigo: novoCodigo('TST'),
    token: novoToken(),
    dadosExtras: null
  }
  const assuntoFinal = `[TESTE] ${renderizarAssunto(assunto, vars)}`
  const info = await enviarEmail({
    para,
    assunto: assuntoFinal,
    html: renderizar(html, vars),
    texto: versaoTexto(vars, assuntoFinal)
  })
  return { ok: true, messageId: info.messageId, resposta: info.response }
})
