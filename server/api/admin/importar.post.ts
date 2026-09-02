import { lerPlanilha, sugerirMapeamento } from '../../utils/lista'
import { falhar } from '../../utils/erro'

const MAX_BYTES = 10 * 1024 * 1024
const MAX_LINHAS = 20000

/** Le a planilha e devolve colunas, previa e o mapeamento sugerido. */
export default defineEventHandler(async event => {
  let partes: Awaited<ReturnType<typeof readMultipartFormData>>
  try {
    partes = await readMultipartFormData(event)
  } catch (err) {
    // corpo cortado pelo proxy, boundary invalida, requisicao abortada
    throw falhar(event, 'recebimento do arquivo', err)
  }
  const arquivo = partes?.find(p => p.name === 'arquivo' && p.filename)
  if (!arquivo) throw createError({ statusCode: 400, statusMessage: 'nenhum arquivo chegou ao servidor' })
  if (arquivo.data.length > MAX_BYTES) {
    const mb = (arquivo.data.length / 1024 / 1024).toFixed(1)
    throw createError({ statusCode: 413, statusMessage: `o arquivo tem ${mb} MB e o limite e de 10 MB` })
  }
  if (!/\.(csv|txt|xlsx|xls)$/i.test(arquivo.filename!)) {
    const ext = arquivo.filename!.split('.').pop()
    throw createError({
      statusCode: 400,
      statusMessage: `extensao .${ext} nao e aceita — envie um arquivo CSV ou XLSX`
    })
  }

  console.info(
    `[gaulke-mail] importacao: "${arquivo.filename}" (${arquivo.data.length} bytes, tipo ${arquivo.type || 'nao informado'})`
  )

  let colunas: string[]
  let linhas: Awaited<ReturnType<typeof lerPlanilha>>['linhas']
  try {
    ;({ colunas, linhas } = lerPlanilha(arquivo.filename!, arquivo.data))
  } catch (err) {
    throw falhar(event, `leitura de "${arquivo.filename}"`, err)
  }
  if (!colunas.length) {
    throw createError({
      statusCode: 400,
      statusMessage: 'o arquivo foi aberto mas a primeira linha nao tem nomes de colunas'
    })
  }
  if (!linhas.length) {
    throw createError({
      statusCode: 400,
      statusMessage: 'o arquivo so tem o cabecalho, nenhuma linha de dados'
    })
  }
  if (linhas.length > MAX_LINHAS) {
    throw createError({
      statusCode: 413,
      statusMessage: `o arquivo tem ${linhas.length} linhas e o limite e de ${MAX_LINHAS} por importacao`
    })
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
