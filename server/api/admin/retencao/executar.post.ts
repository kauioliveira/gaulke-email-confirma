import { exigirPapel } from '../../../utils/permissoes'
import { auditar } from '../../../utils/auditoria'
import { rodarRetencao, descreverResumo } from '../../../utils/retencao'
import { lerConfig } from '../../../utils/config'

/** Roda a retencao agora, com os prazos gravados. Irreversivel: so admin, e auditado. */
export default defineEventHandler(async event => {
  const op = exigirPapel(event, 'admin', 'executar a retenção de dados')
  if (!(await lerConfig('retencao')).ativa) {
    throw createError({ statusCode: 400, statusMessage: 'A retenção está desligada. Ligue e salve os prazos antes de rodar.' })
  }
  const r = await rodarRetencao({ automatica: false, porNome: op.nome })
  if (!r) throw createError({ statusCode: 409, statusMessage: 'A retenção já está rodando agora. Tente de novo em instantes.' })
  await auditar(event, 'retencao.executar', {
    entidade: 'retencao',
    resumo: `Rodou a retenção LGPD manualmente: ${descreverResumo(r)}${r.erros.length ? ` · ${r.erros.length} erro(s)` : ''}`,
    dados: { ...r, exemplos: r.exemplos.slice(0, 10) }
  })
  return r
})
