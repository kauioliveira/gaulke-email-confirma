import { lerPeriodo } from '../../../utils/periodo'
import { montarResumo } from '../../../utils/resumo'

/** Relatorio resumido do periodo: funil por lote, usuario, setor e canal. */
export default defineEventHandler(async event => {
  const p = lerPeriodo(getQuery(event))
  return { periodo: { de: p.de, ate: p.ate }, ...(await montarResumo(p.inicio, p.fim)) }
})
