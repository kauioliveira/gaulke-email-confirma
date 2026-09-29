import { exigirPapel } from '../../../../utils/permissoes'
import { lerCaixa } from '../../../../utils/caixa/monitor'
import { auditar } from '../../../../utils/auditoria'

/** "Ler agora": uma passada do monitor neste canal, sem esperar os 2 minutos. */
export default defineEventHandler(async event => {
  exigirPapel(event, 'admin', 'ler a caixa agora')
  const id = Number(getRouterParam(event, 'id'))
  const r = await lerCaixa(id)
  await auditar(event, 'conta.ler_caixa', {
    entidade: 'conta',
    id,
    resumo: `Leu a caixa do canal agora: ${r.mensagem}`,
    dados: { ok: r.ok, lidas: r.lidas, novas: r.novas, vinculadas: r.vinculadas, porTipo: r.porTipo }
  })
  return r
})
