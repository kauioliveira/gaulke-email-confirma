import { exigirPapel } from '../../../utils/permissoes'
import { lerConfig } from '../../../utils/config'
import type { RespostaRetencao } from '../../../../shared/types/api'

/** Politica de retencao e o resumo da ultima execucao. So admin. */
export default defineEventHandler(async (event): Promise<RespostaRetencao> => {
  exigirPapel(event, 'admin', 'ver a retenção de dados')
  return { config: await lerConfig('retencao'), ultima: await lerConfig('retencao_ultima') }
})
