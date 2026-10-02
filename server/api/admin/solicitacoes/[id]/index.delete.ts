import { z } from 'zod'
import { useSql } from '../../../../db'
import { operadorAtual, temPapel } from '../../../../utils/permissoes'
import { auditar } from '../../../../utils/auditoria'
import { carregarSolicitacao } from '../../../../utils/solicitacoes'
import { apagarDocumento, apagarPastaDocumento, codigoSolicitacao } from '../../../../utils/documentos'

const schema = z.object({
  // dupla confirmacao: a tela pede para digitar o codigo, e o servidor confere
  confirmacao: z.string().trim()
})

/**
 * Exclui uma solicitacao DE VEZ: registro, itens, respostas, historico, as
 * mensagens da caixa ligadas a ela e os arquivos do cliente no disco. Nao ha
 * lixeira — para so encerrar, existe "Cancelar".
 *
 *  - o cliente ainda nao entregou nada: quem criou, ou supervisor/admin;
 *  - ja entregou (arquivo ou resposta): so supervisor/admin — ali ha
 *    documento de cliente sendo destruido.
 *
 * Fica so a linha da auditoria, com o resumo do que foi apagado.
 */
export default defineEventHandler(async event => {
  const op = operadorAtual(event)
  const s = await carregarSolicitacao(Number(getRouterParam(event, 'id')))
  const codigo = codigoSolicitacao(s)
  const d = validar(schema, await readBody(event))
  if (d.confirmacao.toUpperCase() !== codigo.toUpperCase()) {
    throw createError({ statusCode: 400, statusMessage: `Para confirmar, digite o código ${codigo}.` })
  }

  const sql = useSql()
  const arquivos = await sql<{ caminho: string; removido: boolean }[]>`
    select caminho, removido_em is not null as removido from sys_mail_solic_arquivos where solic_id = ${s.id}`
  const [{ respostas } = { respostas: 0 }] = await sql<{ respostas: number }[]>`
    select count(*)::int as respostas from sys_mail_solic_itens where solic_id = ${s.id} and resposta is not null`
  const entregues = arquivos.filter(a => !a.removido).length
  const clienteEntregou = entregues > 0 || respostas > 0

  const eDono = s.criadoPorUserId === null || s.criadoPorUserId === op.id
  if (clienteEntregou && !temPapel(op, 'supervisor')) {
    throw createError({
      statusCode: 403,
      statusMessage: 'O cliente já enviou arquivos ou respostas: só supervisores e administradores excluem. Você pode cancelar a solicitação.'
    })
  }
  if (!eDono && !temPapel(op, 'supervisor')) {
    throw createError({ statusCode: 403, statusMessage: `Só quem pediu (${s.criadoPorNome}), supervisores e administradores excluem.` })
  }

  await sql.begin(async tx => {
    // a caixa nao tem FK para a solicitacao: sai antes, a mao (como na retencao)
    await tx`delete from sys_mail_inbound where solic_id = ${s.id}`
    // itens, arquivos (registro) e historico caem junto (ON DELETE CASCADE)
    await tx`delete from sys_mail_solic where id = ${s.id}`
  })

  // banco ja apagado: agora o disco. Falha aqui so vira aviso (o registro nao volta).
  const avisos: string[] = []
  for (const a of arquivos) {
    try {
      await apagarDocumento(a.caminho)
    } catch (e) {
      avisos.push(`${a.caminho}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  if (s.pasta) {
    try {
      await apagarPastaDocumento(s.pasta)
    } catch (e) {
      avisos.push(`pasta: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  if (avisos.length) console.error('[gaulke-mail] exclusao da solicitacao', s.id, avisos)

  await auditar(event, 'solicitacao.excluir', {
    entidade: 'solicitacao',
    id: s.id,
    resumo: `Excluiu definitivamente a ${codigo} "${s.titulo}" de ${s.destinatarioEmail}${clienteEntregou ? ` (${entregues} arquivo(s) e ${respostas} resposta(s) do cliente apagados)` : ''}`,
    dados: {
      codigo,
      titulo: s.titulo,
      cliente: { nome: s.destinatarioNome, email: s.destinatarioEmail, documento: s.documento, empresa: s.empresa },
      status: s.status,
      criadoPor: s.criadoPorNome,
      criadoEm: s.createdAt,
      arquivos: entregues,
      respostas,
      pasta: s.pasta,
      avisos
    }
  })
  return { ok: true, avisos: avisos.length }
})
