import { z } from 'zod'
import { exigirPapel } from '../../../utils/permissoes'
import { lerConfig } from '../../../utils/config'
import { executarRetencao } from '../../../utils/retencao'

const schema = z
  .object({
    comunicadosMeses: z.number().int().min(0),
    solicitacoesMeses: z.number().int().min(0),
    assinadosAnos: z.number().int().min(0),
    lixeiraDias: z.number().int().min(0)
  })
  .partial()

/**
 * Simulacao: conta o que sairia com os prazos informados (ou os gravados),
 * sem apagar nada. A tela chama antes de salvar prazos novos.
 */
export default defineEventHandler(async event => {
  const op = exigirPapel(event, 'admin', 'simular a retenção de dados')
  const d = validar(schema, (await readBody(event).catch(() => ({}))) ?? {})
  const atual = await lerConfig('retencao')
  return executarRetencao({ simular: true, automatica: false, porNome: op.nome, config: { ...atual, ...d, ativa: true } })
})
