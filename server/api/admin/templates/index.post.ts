import { useDb, templates } from '../../../db'
import { operadorAtual, setorAoSalvar } from '../../../utils/permissoes'
import { auditar } from '../../../utils/auditoria'
import { templateSchema, htmlDoTemplate, exigirPodeMarcarOficial, salvarVersao } from '../../../utils/templates'

export default defineEventHandler(async event => {
  const op = operadorAtual(event)
  const dados = validar(templateSchema, await readBody(event))
  exigirPodeMarcarOficial(event, dados.oficial, false)

  // Em modo blocos o HTML e GERADO, nunca recebido: e isso que garante que a
  // marcacao de tabelas continue correta para o Outlook.
  const html = htmlDoTemplate(dados)

  const [t] = await useDb()
    .insert(templates)
    .values({
      nome: dados.nome,
      assunto: dados.assunto,
      formato: dados.formato,
      blocos: (dados.blocos ?? null) as never,
      html,
      tipo: dados.tipo ?? null,
      categoria: dados.categoria || null,
      oficial: dados.oficial ?? false,
      // sem escolha, nasce no setor de quem criou
      departamentoId: dados.departamentoId === undefined ? op.departamentoId : setorAoSalvar(op, dados.departamentoId),
      criadoPorUserId: op.id,
      criadoPorNome: op.nome,
      atualizadoPorUserId: op.id,
      atualizadoPorNome: op.nome
    })
    .returning()

  await salvarVersao(t!, op)
  await auditar(event, 'template.criar', {
    entidade: 'template',
    id: t!.id,
    resumo: `Criou o template "${t!.nome}"${t!.tipo ? ` (${t!.tipo})` : ''}`,
    dados: { nome: t!.nome, assunto: t!.assunto, formato: t!.formato, tipo: t!.tipo, categoria: t!.categoria }
  })

  return { template: t }
})
