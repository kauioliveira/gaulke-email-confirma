import { lerPlanilha, sugerirMapeamento } from '../../utils/lista'

const MAX_BYTES = 10 * 1024 * 1024
const MAX_LINHAS = 20000

/** Le a planilha e devolve colunas, previa e o mapeamento sugerido. */
export default defineEventHandler(async event => {
  const partes = await readMultipartFormData(event)
  const arquivo = partes?.find(p => p.name === 'arquivo' && p.filename)
  if (!arquivo) throw createError({ statusCode: 400, statusMessage: 'Nenhum arquivo enviado' })
  if (arquivo.data.length > MAX_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'Arquivo maior que 10 MB' })
  }
  if (!/\.(csv|txt|xlsx|xls)$/i.test(arquivo.filename!)) {
    throw createError({ statusCode: 400, statusMessage: 'Envie um arquivo CSV ou XLSX' })
  }

  const { colunas, linhas } = lerPlanilha(arquivo.filename!, arquivo.data)
  if (!colunas.length) {
    throw createError({ statusCode: 400, statusMessage: 'Nao foi possivel ler as colunas do arquivo' })
  }
  if (linhas.length > MAX_LINHAS) {
    throw createError({ statusCode: 413, statusMessage: `Limite de ${MAX_LINHAS} linhas por importacao` })
  }

  return {
    arquivo: arquivo.filename,
    colunas,
    total: linhas.length,
    sugestao: sugerirMapeamento(colunas, linhas),
    previa: linhas.slice(0, 10),
    linhas
  }
})
