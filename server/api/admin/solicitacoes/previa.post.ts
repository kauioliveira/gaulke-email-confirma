import { z } from 'zod'
import { itemSolicSchema, montarEmail } from '../../../utils/solicitacoes'
import type { Solicitacao, SolicItem } from '../../../db'

const schema = z.object({
  titulo: z.string().trim().max(200).default(''),
  mensagem: z.string().trim().max(4000).nullish(),
  prazo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  itens: z.array(itemSolicSchema.extend({ titulo: z.string().trim().max(200) })).max(40),
  destinatario: z.object({ nome: z.string().nullish(), email: z.string().default('cliente@exemplo.com.br'), empresa: z.string().nullish() }).nullish()
})

/** Previa do e-mail do pedido, com o primeiro cliente da lista. Nada e gravado. */
export default defineEventHandler(async event => {
  const d = validar(schema, await readBody(event))
  const s = {
    id: 0,
    titulo: d.titulo || 'Título da solicitação',
    mensagem: d.mensagem || null,
    prazo: d.prazo || null,
    token: '00000000-0000-0000-0000-000000000000',
    destinatarioNome: d.destinatario?.nome || 'Maria',
    destinatarioEmail: d.destinatario?.email || 'cliente@exemplo.com.br',
    empresa: d.destinatario?.empresa || null
  } as Solicitacao
  const itens = d.itens
    .filter(i => i.titulo)
    .map((i, n) => ({ ...i, id: n, solicId: 0, ordem: n + 1, status: 'pendente', motivo: null }) as unknown as SolicItem)
  const { assunto, html } = montarEmail('pedido', s, itens)
  return { assunto, html }
})
