import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { useDb, solicitacoes, solicItens, accounts } from '../../../db'
import { operadorAtual } from '../../../utils/permissoes'
import { auditar } from '../../../utils/auditoria'
import { suprimidos } from '../../../utils/supressao'
import { criarSolicSchema, enviarEmailSolic, registrarEventoSolic } from '../../../utils/solicitacoes'
import { pastaDaSolicitacao } from '../../../utils/documentos'
import { novoCodigoSolicitacao } from '../../../utils/solicitacoes'

/**
 * Cria a solicitacao — UMA POR CLIENTE, cada uma com a sua copia dos itens
 * (o modelo pode mudar depois; o que o cliente recebeu, nao) — e dispara os
 * e-mails em segundo plano. O pedido para varios clientes fica agrupado.
 */
export default defineEventHandler(async event => {
  const op = operadorAtual(event)
  const d = validar(criarSolicSchema, await readBody(event))
  const db = useDb()

  // e-mails repetidos na lista viram uma solicitacao so
  const vistos = new Set<string>()
  const destinatarios = d.destinatarios.filter(x => (vistos.has(x.email) ? false : (vistos.add(x.email), true)))

  const bloqueados = await suprimidos(destinatarios.map(x => x.email))
  if (bloqueados.length) {
    throw createError({
      statusCode: 400,
      statusMessage: `Estes e-mails devolveram antes e estão bloqueados: ${bloqueados.map(b => b.email).join(', ')}. Corrija ou tire da lista.`
    })
  }

  let contaNome: string | null = null
  if (d.contaId) {
    const [c] = await db.select().from(accounts).where(eq(accounts.id, d.contaId))
    if (!c || c.ativa !== 'true') throw createError({ statusCode: 400, statusMessage: 'O canal escolhido não existe ou está desativado' })
    contaNome = c.nome
  }

  const grupo = destinatarios.length > 1 ? randomUUID() : null
  const ids: number[] = []
  // um codigo publico sorteado por cliente (SOL-26-X7K2P9), sem repetir entre eles
  const codigos: string[] = []
  for (const _ of destinatarios) {
    let c: string
    do c = await novoCodigoSolicitacao()
    while (codigos.includes(c))
    codigos.push(c)
  }
  const codigoDe = new Map<number, string>()

  await db.transaction(async tx => {
    for (const [n, x] of destinatarios.entries()) {
      const [s] = await tx
        .insert(solicitacoes)
        .values({
          titulo: d.titulo,
          codigo: codigos[n]!,
          mensagem: d.mensagem,
          checklistId: d.checklistId ?? null,
          destinatarioNome: x.nome,
          destinatarioEmail: x.email,
          documento: x.documento,
          empresa: x.empresa,
          token: randomUUID(),
          prazo: d.prazo,
          grupo,
          contaId: d.contaId ?? null,
          contaNome,
          responderPara: d.responderPara,
          lembretes: d.lembretes,
          avisarConclusao: d.avisarConclusao,
          criadoPorUserId: op.id,
          criadoPorNome: op.nome,
          criadoPorEmail: op.email
        })
        .returning()
      const pasta = pastaDaSolicitacao(s!)
      await tx.update(solicitacoes).set({ pasta }).where(eq(solicitacoes.id, s!.id))
      await tx.insert(solicItens).values(d.itens.map((i, n) => ({ ...i, solicId: s!.id, ordem: n + 1 })))
      ids.push(s!.id)
      codigoDe.set(s!.id, codigos[n]!)
    }
  })

  for (const id of ids) {
    await registrarEventoSolic(id, 'criada', `Solicitação criada por ${op.nome}`, { porNome: op.nome })
  }

  await auditar(event, 'solicitacao.criar', {
    entidade: 'solicitacao',
    id: ids.length === 1 ? ids[0] : grupo,
    resumo:
      ids.length === 1
        ? `Pediu documentos a ${destinatarios[0]!.email}: "${d.titulo}" (${codigoDe.get(ids[0]!)}, ${d.itens.length} itens)`
        : `Pediu documentos a ${ids.length} clientes: "${d.titulo}" (${d.itens.length} itens)`,
    dados: {
      ids,
      titulo: d.titulo,
      itens: d.itens.map(i => i.titulo),
      prazo: d.prazo,
      conta: contaNome,
      responderPara: d.responderPara,
      destinatarios: destinatarios.map(x => x.email)
    }
  })

  // o e-mail sai em segundo plano: 300 clientes nao seguram a tela. Um
  // intervalo curto entre eles evita que o servidor de e-mail nos trate como spam.
  void (async () => {
    for (const id of ids) {
      await enviarEmailSolic(id, 'pedido', { porNome: op.nome })
      if (ids.length > 1) await new Promise(r => setTimeout(r, 800))
    }
  })()

  return { ids, grupo }
})
