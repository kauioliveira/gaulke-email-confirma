import type { ZodType, output } from 'zod'

/**
 * Valida o corpo da requisicao devolvendo 400 com mensagem legivel.
 *
 * `schema.parse()` lanca ZodError, que o Nitro transforma em 500 "Server
 * Error" — a mensagem escrita com carinho na regra de validacao nunca chegava
 * a tela, e o operador via um erro de servidor para um dado invalido dele.
 */
// `output<S>` e nao um generico solto: um campo com .default() tem tipo de
// ENTRADA opcional e de SAIDA obrigatorio, e inferir pelo lado errado fazia o
// TypeScript enxergar `string | undefined` depois da validacao.
export function validar<S extends ZodType>(schema: S, dados: unknown): output<S> {
  const r = schema.safeParse(dados)
  if (r.success) return r.data

  const mensagem = r.error.issues
    .map(i => {
      const campo = i.path.filter(p => typeof p !== 'number').join('.')
      return campo ? `${campo}: ${i.message}` : i.message
    })
    .join('; ')

  throw createError({ statusCode: 400, statusMessage: mensagem || 'Dados invalidos' })
}
