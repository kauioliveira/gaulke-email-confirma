import { z } from 'zod'
import { renderizar, renderizarAssunto } from '../../utils/render'
import { novoToken, novoCodigo } from '../../utils/ids'
import { baseUrlDoRequest } from '../../utils/urls'
import { blocosSchema } from '../../utils/blocos-schema'
import { renderizarBlocos } from '../../utils/blocos'

const schema = z.object({
  // o preview aceita HTML pronto OU os blocos do editor visual, e nesse caso
  // gera o HTML pelo MESMO caminho do salvamento — o que a pessoa ve e
  // exatamente o que sera gravado
  html: z.string().optional(),
  blocos: blocosSchema.optional(),
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
  const { html, blocos, assunto, exemplo } = validar(schema, await readBody(event))
  const fonte = blocos?.length ? renderizarBlocos(blocos, assunto) : html
  if (!fonte) throw createError({ statusCode: 400, statusMessage: 'Informe o HTML ou os blocos' })
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
    html: renderizar(fonte, vars, baseUrlDoRequest(event)),
    assunto: renderizarAssunto(assunto, vars),
    // HTML do template ANTES da substituicao das variaveis: e o que a aba
    // "HTML" mostra quando o e-mail e montado por blocos
    fonte
  }
})
