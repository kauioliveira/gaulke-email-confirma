import { exigirPapel } from '../../../utils/permissoes'
import { listarConfig } from '../../../utils/config'

/** Configuracoes gerais do sistema. So admin. */
export default defineEventHandler(async event => {
  exigirPapel(event, 'admin', 'ver as configurações gerais')
  return { itens: await listarConfig() }
})
