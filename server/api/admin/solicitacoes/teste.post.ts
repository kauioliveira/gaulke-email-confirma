import { z } from 'zod'
import { itemSolicBase, montarEmail } from '../../../utils/solicitacoes'
import { resolverConta, enviarEmail } from '../../../utils/mailer'
import { operadorAtual } from '../../../utils/permissoes'
import { auditar } from '../../../utils/auditoria'
import type { Solicitacao, SolicItem } from '../../../db'

const schema = z.object({
  para: z.string().trim().toLowerCase().email('E-mail de teste inválido').max(320),
  titulo: z.string().trim().max(200).default(''),
  mensagem: z.string().trim().max(4000).nullish(),
  prazo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  contaId: z.number().int().positive().nullish(),
  responderPara: z.string().trim().max(300).nullish(),
  itens: z.array(itemSolicBase).max(40),
  destinatario: z.object({ nome: z.string().nullish(), empresa: z.string().nullish() }).nullish()
})

/**
 * Envia o e-mail do pedido para um endereco de teste, antes de disparar para
 * os clientes. Nada e gravado: o link do teste nao abre solicitacao nenhuma.
 * Usa o mesmo canal (conta SMTP) escolhido no envio, para conferir remetente
 * e chegada de verdade.
 */
export default defineEventHandler(async event => {
  const op = operadorAtual(event)
  const d = validar(schema, await readBody(event))
  const s = {
    id: 0,
    titulo: d.titulo || 'Título da solicitação',
    mensagem: d.mensagem || null,
    prazo: d.prazo || null,
    token: '00000000-0000-0000-0000-000000000000',
    destinatarioNome: d.destinatario?.nome || op.nome,
    destinatarioEmail: d.para,
    empresa: d.destinatario?.empresa || null
  } as Solicitacao
  const itens = d.itens
    .filter(i => i.titulo || i.tipo === 'informativo')
    .map((i, n) => ({ ...i, id: n, solicId: 0, ordem: n + 1, status: 'pendente', motivo: null }) as unknown as SolicItem)
  const { assunto, html, texto } = montarEmail('pedido', s, itens)

  try {
    const conta = await resolverConta(d.contaId)
    await enviarEmail({ conta, para: d.para, assunto: `[TESTE] ${assunto}`, html, texto, responderPara: d.responderPara || null })
  } catch (e) {
    throw createError({ statusCode: 502, statusMessage: `O e-mail de teste não saiu: ${e instanceof Error ? e.message : String(e)}` })
  }
  await auditar(event, 'solicitacao.teste', { entidade: 'solicitacao', resumo: `Enviou um teste de "${s.titulo}" para ${d.para}` })
  return { ok: true }
})
