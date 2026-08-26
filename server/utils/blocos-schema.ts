import { z } from 'zod'

/**
 * Validacao dos blocos vindos da tela.
 *
 * O front nunca e a ultima palavra: o rodape e obrigatorio aqui tambem, senao
 * bastaria um POST direto para gerar um e-mail sem o aviso de LGPD.
 */

const alinhamento = z.enum(['esquerda', 'centro', 'direita'])

export const blocoSchema = z.discriminatedUnion('tipo', [
  z.object({ id: z.string(), tipo: z.literal('logo'), alinhamento }),
  z.object({ id: z.string(), tipo: z.literal('titulo'), texto: z.string().max(300) }),
  z.object({ id: z.string(), tipo: z.literal('texto'), texto: z.string().max(4000) }),
  z.object({ id: z.string(), tipo: z.literal('botao'), texto: z.string().min(1).max(80) }),
  z.object({
    id: z.string(),
    tipo: z.literal('codigo'),
    rotulo: z.string().max(80),
    ajuda: z.string().max(300)
  }),
  z.object({
    id: z.string(),
    tipo: z.literal('aviso'),
    texto: z.string().max(2000),
    cor: z.enum(['neutro', 'atencao', 'alerta'])
  }),
  z.object({ id: z.string(), tipo: z.literal('lista'), itens: z.array(z.string().max(500)).max(30) }),
  z.object({ id: z.string(), tipo: z.literal('separador') }),
  z.object({
    id: z.string(),
    tipo: z.literal('imagem'),
    arquivo: z.string().max(260),
    alt: z.string().max(200),
    largura: z.number().int().min(40).max(600),
    alinhamento
  }),
  z.object({ id: z.string(), tipo: z.literal('rodape'), texto: z.string().min(1).max(2000) })
])

export const blocosSchema = z
  .array(blocoSchema)
  .min(1)
  .max(60)
  .refine(bs => bs.filter(b => b.tipo === 'rodape').length === 1, {
    message: 'O e-mail precisa de exatamente um rodape com o aviso de LGPD'
  })
  .refine(bs => bs.some(b => b.tipo === 'botao'), {
    message: 'O e-mail precisa do botao de acesso — e ele que leva ao documento'
  })
