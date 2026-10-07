/**
 * Descobre de QUEM e um arquivo individual pelo CPF/CNPJ — primeiro no nome,
 * depois no conteudo (lote "arquivos por cliente").
 *
 * O nome vem primeiro: quando o escritorio padronizar "CNPJ_relatorio.xlsx" a
 * regra ja vale sem ler nada. Sem documento no nome, olha o comeco do arquivo:
 * relatorios exportados costumam trazer "CNPJ: 27.851.136/0001-61 | ..." nas
 * primeiras linhas (o Relatorio do Imobilizado traz na linha 2).
 *
 * So entra documento com digito verificador conferido — numero de nota,
 * telefone ou valor com 14 digitos nao viram "cliente".
 */
import * as XLSX from 'xlsx/xlsx.mjs'
import { documentosNoNome } from '../../shared/utils/casamento'
import { cnpjValido, cpfValido } from '../../shared/utils/documento'

export type OrigemDocumento = 'nome' | 'conteudo'

/** quantas linhas do comeco do arquivo sao lidas */
const LINHAS = 15

const valido = (d: string) => (d.length === 14 ? cnpjValido(d) : d.length === 11 && cpfValido(d))

/**
 * Documentos num texto. Com rotulo ("CNPJ:", "CPF/CNPJ", "Inscricao") vale
 * CPF ou CNPJ; sem rotulo, so CNPJ formatado ou com 14 digitos — 11 digitos
 * soltos sao comuns demais (telefone com DDD) para virar pista.
 */
export function documentosNoTexto(texto: string) {
  const rotulados: string[] = []
  for (const m of texto.matchAll(/\b(?:CNPJ|CPF)(?:\s*\/\s*(?:CNPJ|CPF))?\s*(?:n[ºo°.]*)?\s*[:\-–]?\s*(\d[\d.\/\s-]{9,20}\d)/gi)) {
    const d = m[1]!.replace(/\D/g, '')
    if (valido(d)) rotulados.push(d)
  }
  if (rotulados.length) return [...new Set(rotulados)]

  const soltos: string[] = []
  for (const m of texto.matchAll(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g)) {
    const d = m[0].replace(/\D/g, '')
    if (d.length === 14 && cnpjValido(d)) soltos.push(d)
  }
  return [...new Set(soltos)]
}

/** Texto das primeiras linhas da 1a aba de uma planilha. */
function textoDaPlanilha(dados: Uint8Array) {
  const wb = XLSX.read(dados, { type: 'array', sheetRows: LINHAS })
  const aba = wb.SheetNames[0]
  if (!aba) return ''
  const linhas = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[aba]!, { header: 1, defval: '', raw: false })
  return linhas.map(l => l.map(c => String(c ?? '')).join(' | ')).join('\n')
}

function textoPuro(dados: Uint8Array) {
  const texto = new TextDecoder('utf-8', { fatal: false }).decode(dados.subarray(0, 64 * 1024))
  return texto.split(/\r?\n/).slice(0, LINHAS).join('\n')
}

export function documentosNoArquivo(original: string, dados: Uint8Array): { documentos: string[]; origem: OrigemDocumento | null } {
  const doNome = documentosNoNome(original).filter(valido)
  if (doNome.length) return { documentos: doNome, origem: 'nome' }

  let texto = ''
  try {
    if (/\.(xlsx|xlsm|xls|ods)$/i.test(original)) texto = textoDaPlanilha(dados)
    else if (/\.(csv|txt)$/i.test(original)) texto = textoPuro(dados)
    // PDF: ponto de extensao — pdfjs-dist ja esta no projeto
  } catch {
    // planilha que nao abre: fica sem documento e a pessoa informa na tela
    texto = ''
  }
  const doConteudo = texto ? documentosNoTexto(texto) : []
  return doConteudo.length ? { documentos: doConteudo, origem: 'conteudo' } : { documentos: [], origem: null }
}
