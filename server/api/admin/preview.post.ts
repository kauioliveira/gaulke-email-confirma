import { z } from 'zod'
import { renderizar, renderizarAssunto } from '../../utils/render'
import { novoToken, novoCodigo } from '../../utils/ids'
import { baseUrlDoRequest } from '../../utils/urls'

const schema = z.object({
  html: z.string(),
  assunto: z.string().default(''),
  exemplo: z
    .object({
      nome: z.string().optional(),
      email: z.string().optional(),
      empresa: z.string().optional()
    })
    .optional()
})

/** Renderiza o template com dados ficticios para o preview visual. */
export default defineEventHandler(async event => {
  const { html, assunto, exemplo } = schema.parse(await readBody(event))
  const vars = {
    nome: exemplo?.nome || 'Maria Oliveira',
    email: exemplo?.email || 'maria.oliveira@exemplo.com.br',
    empresa: exemplo?.empresa || 'Empresa Exemplo LTDA',
    codigo: novoCodigo(),
    token: novoToken(),
    dadosExtras: null
  }
  /**
   * O preview usa o endereco de onde a tela foi aberta, e nao URL_ACESSO:
   * assim a logo aparece mesmo antes de o app estar publicado no endereco
   * definitivo. O envio real continua usando URL_ACESSO.
   */
  return {
    html: renderizar(html, vars, baseUrlDoRequest(event)),
    assunto: renderizarAssunto(assunto, vars)
  }
})
