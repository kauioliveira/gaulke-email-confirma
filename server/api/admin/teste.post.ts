import { z } from 'zod'
import { renderizar, renderizarAssunto, versaoTexto } from '../../utils/render'
import { novoToken, novoCodigo } from '../../utils/ids'
import { enviarEmail } from '../../utils/mailer'
import { blocosSchema } from '../../utils/blocos-schema'
import { renderizarBlocos } from '../../utils/blocos'

const schema = z.object({
  para: z.string().email(),
  assunto: z.string().min(1),
  // aceita HTML pronto OU os blocos do editor visual
  html: z.string().optional(),
  blocos: blocosSchema.optional()
})

/**
 * Envio de teste antes do lote — evita queimar centenas de e-mails com um
 * HTML quebrado. Os links funcionam, mas nao ha destinatario real no banco,
 * entao nada e rastreado.
 */
export default defineEventHandler(async event => {
  const { para, assunto, html, blocos } = validar(schema, await readBody(event))
  const fonte = blocos?.length ? renderizarBlocos(blocos, assunto) : html
  if (!fonte) throw createError({ statusCode: 400, statusMessage: 'Informe o HTML ou os blocos' })
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
    html: renderizar(fonte, vars),
    texto: versaoTexto(vars, assuntoFinal)
  })
  return { ok: true, messageId: info.messageId, resposta: info.response }
})
