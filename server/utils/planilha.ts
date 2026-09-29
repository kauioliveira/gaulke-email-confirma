import * as XLSX from 'xlsx/xlsx.mjs'

/**
 * Gera um .xlsx em memoria a partir de abas com linhas (a primeira e o
 * cabecalho).
 *
 * Importa o ENTRYPOINT ESM do xlsx pelo mesmo motivo de server/utils/lista.ts:
 * o build CommonJS faz um require de dist/cpexcel.js que nao sobrevive ao
 * empacotamento do Nitro.
 *
 * Texto que comeca com = + - @ ganha um apostrofo: e injecao de formula, o
 * mesmo cuidado do CSV. Datas viram texto no horario de Sao Paulo, para a
 * planilha mostrar a hora como aconteceu aqui.
 */
export type Aba = { nome: string; linhas: unknown[][]; larguras?: number[] }

function celula(v: unknown) {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return formatarDataHora(v, '')
  if (typeof v === 'number' || typeof v === 'boolean') return v
  const s = String(v)
  return /^[=+\-@]/.test(s) ? `'${s}` : s
}

export function gerarXlsx(abas: Aba[]): Buffer {
  const livro = XLSX.utils.book_new()
  for (const a of abas) {
    const folha = XLSX.utils.aoa_to_sheet(a.linhas.map(l => l.map(celula)))
    if (a.larguras) folha['!cols'] = a.larguras.map(wch => ({ wch }))
    // nome de aba: ate 31 caracteres, sem / \ ? * [ ]
    XLSX.utils.book_append_sheet(livro, folha, a.nome.replace(/[\\/?*[\]:]/g, '-').slice(0, 31))
  }
  return XLSX.write(livro, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

export function enviarXlsx(event: Parameters<typeof setResponseHeaders>[0], arquivo: string, dados: Buffer) {
  setResponseHeaders(event, {
    'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'content-disposition': `attachment; filename="${arquivo}"`,
    'content-length': dados.length
  })
  return dados
}
