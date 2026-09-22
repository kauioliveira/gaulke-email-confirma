import { z } from 'zod'

/**
 * Validacao dos blocos vindos da tela.
 *
 * O front nunca e a ultima palavra: o rodape e obrigatorio aqui tambem, senao
 * bastaria um POST direto para gerar um e-mail sem o aviso de LGPD.
 */

/**
 * Caminho da imagem: 'brand/x.png', 'img/y.png' ou o nome solto legado.
 *
 * O valor vira `src` de um <img> no e-mail, entao nao pode ser texto livre:
 * antes daqui um POST direto conseguia gravar qualquer string no campo.
 */
const CAMINHO_IMAGEM = /^(?:(?:brand|img)\/)?[A-Za-z0-9][A-Za-z0-9._-]*$/

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
    arquivo: z
      .string()
      .max(260)
      .refine(v => v === '' || CAMINHO_IMAGEM.test(v), {
        message: 'Caminho de imagem invalido'
      }),
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

/**
 * O botao de acesso e obrigatorio SO QUANDO HA ANEXO.
 *
 * Antes ele era exigido sempre, por um `.refine` dentro do proprio
 * `blocosSchema`. A regra vinha de um caso de uso unico — mandar um PDF e
 * cobrar confirmacao — e impedia o outro, que e so avisar o cliente de alguma
 * coisa: sem documento, o botao leva a uma pagina que nao tem o que entregar.
 *
 * A checagem saiu do schema porque o schema nao sabe se o lote tem arquivo.
 * Quem sabe e o handler, e e la que esta funcao e chamada.
 */
export function faltaBotaoDeAcesso(blocos: unknown[]) {
  return !blocos.some(b => (b as { tipo?: string })?.tipo === 'botao')
}

export const MSG_BOTAO_OBRIGATORIO =
  'Este envio tem um arquivo anexo, entao o e-mail precisa do botao de acesso — e ele que leva ao documento'
