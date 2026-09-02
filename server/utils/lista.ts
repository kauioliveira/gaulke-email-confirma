import Papa from 'papaparse'
/**
 * O ENTRYPOINT ESM, e nao o pacote 'xlsx'.
 *
 * O build padrao (xlsx.js, CommonJS) faz `require('./dist/cpexcel.js')` para a
 * tabela de codepages legada. O Nitro converte esse require num import com o
 * CAMINHO ABSOLUTO da maquina que compilou — no container, /app/node_modules/
 * xlsx/dist/cpexcel.js. Como a imagem de runtime copia so o .output, o arquivo
 * nao existe la e QUALQUER importacao de lista quebrava em producao com
 * ERR_MODULE_NOT_FOUND — inclusive CSV, que nem chega a usar o xlsx. Em
 * desenvolvimento passava despercebido porque o caminho existia de verdade.
 *
 * O xlsx.mjs nao tem esse require: ele recebe a tabela por set_cptable, que
 * nao usamos. Planilhas modernas (xlsx/xlsm) sao UTF-8 e nao dependem dela.
 */
import * as XLSX from 'xlsx/xlsx.mjs'

export type LinhaBruta = Record<string, string>

/** Le CSV (com deteccao de ; ou ,) ou XLSX e devolve colunas + linhas. */
export function lerPlanilha(nomeArquivo: string, dados: Buffer) {
  const ehExcel = /\.(xlsx|xls)$/i.test(nomeArquivo)
  let linhas: LinhaBruta[] = []

  if (ehExcel) {
    const wb = XLSX.read(dados, { type: 'buffer' })
    const primeira = wb.SheetNames[0]
    if (!primeira) {
      throw createError({ statusCode: 400, statusMessage: 'a planilha nao tem nenhuma aba com conteudo' })
    }
    linhas = XLSX.utils.sheet_to_json<LinhaBruta>(wb.Sheets[primeira]!, { defval: '', raw: false })
  } else {
    // remove BOM do Excel brasileiro, senao a 1a coluna vem com ﻿ no nome
    const texto = dados.toString('utf8').replace(/^﻿/, '')
    const r = Papa.parse<LinhaBruta>(texto, {
      header: true,
      skipEmptyLines: 'greedy',
      delimitersToGuess: [';', ',', '\t', '|']
    })
    linhas = r.data
  }

  linhas = linhas.map(l =>
    Object.fromEntries(
      Object.entries(l).map(([k, v]) => [String(k).trim(), String(v ?? '').trim()])
    )
  )

  const colunas = [...new Set(linhas.flatMap(l => Object.keys(l)))].filter(Boolean)
  return { colunas, linhas }
}

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** Sugere qual coluna e o e-mail, o nome e a empresa, pelo cabecalho. */
export function sugerirMapeamento(colunas: string[], linhas: LinhaBruta[]) {
  const norm = (s: string) =>
    s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '')

  const acha = (chaves: string[]) =>
    colunas.find(c => chaves.some(k => norm(c) === k)) ||
    colunas.find(c => chaves.some(k => norm(c).includes(k)))

  let email = acha(['email', 'mail', 'correio', 'enderecoeletronico'])
  // se o cabecalho nao ajudou, procura a coluna que mais parece conter e-mails
  if (!email && linhas.length) {
    const amostra = linhas.slice(0, 30)
    let melhor = { col: '', acertos: 0 }
    for (const c of colunas) {
      const acertos = amostra.filter(l => RE_EMAIL.test(l[c] || '')).length
      if (acertos > melhor.acertos) melhor = { col: c, acertos }
    }
    if (melhor.acertos > 0) email = melhor.col
  }

  return {
    email: email || '',
    nome: acha(['nome', 'name', 'razaosocial', 'cliente', 'contato', 'responsavel']) || '',
    empresa: acha(['empresa', 'razaosocial', 'fantasia', 'company', 'organizacao']) || ''
  }
}

/** Linha de planilha ja validada, ainda nao gravada no banco. */
export type LinhaImportada = {
  nome: string
  email: string
  empresa: string
  extras: Record<string, string>
}

/**
 * Aplica o mapeamento, valida e-mail e remove duplicados.
 * Devolve tambem as linhas rejeitadas, para o operador saber o que ficou de fora.
 */
export function normalizarLista(
  linhas: LinhaBruta[],
  mapa: { email: string; nome?: string; empresa?: string },
  colunasExtras: string[] = []
) {
  const validos: LinhaImportada[] = []
  const rejeitados: { linha: number; email: string; motivo: string }[] = []
  const vistos = new Set<string>()

  linhas.forEach((l, i) => {
    const email = (l[mapa.email] || '').trim().toLowerCase()
    if (!email) return rejeitados.push({ linha: i + 2, email: '', motivo: 'E-mail em branco' })
    if (!RE_EMAIL.test(email)) {
      return rejeitados.push({ linha: i + 2, email, motivo: 'E-mail invalido' })
    }
    if (vistos.has(email)) {
      return rejeitados.push({ linha: i + 2, email, motivo: 'E-mail duplicado na lista' })
    }
    vistos.add(email)

    const extras: Record<string, string> = {}
    for (const c of colunasExtras) if (l[c]) extras[c] = l[c]!

    validos.push({
      email,
      nome: (mapa.nome && l[mapa.nome]) || '',
      empresa: (mapa.empresa && l[mapa.empresa]) || '',
      extras
    })
  })

  return { validos, rejeitados }
}

/**
 * Modelo de planilha mostrado na tela e oferecido para download.
 *
 * Fonte unica: a tela de importacao e o arquivo de exemplo saem daqui, entao
 * o que o operador ve documentado e o que o importador realmente aceita.
 */
export const COLUNAS_MODELO = ['Nome', 'E-mail', 'Empresa'] as const

export function linhasModelo(): string[][] {
  return [
    ['Maria Oliveira', 'maria.oliveira@empresa.com.br', 'Empresa Exemplo LTDA'],
    ['Joao Souza', 'joao.souza@outraempresa.com.br', 'Outra Empresa ME'],
    ['', 'contato@terceiraempresa.com.br', 'Terceira Empresa SA']
  ]
}

/**
 * Le uma lista digitada a mao. Aceita os formatos que a pessoa naturalmente
 * digita ou cola de outro lugar:
 *
 *   maria@empresa.com.br
 *   Maria Oliveira <maria@empresa.com.br>
 *   Maria Oliveira; maria@empresa.com.br; Empresa Exemplo
 *   Maria Oliveira, maria@empresa.com.br, Empresa Exemplo
 *
 * A validacao e a deduplicacao continuam sendo feitas depois, pelo mesmo
 * caminho da planilha — aqui so extraimos os campos.
 */
export function lerListaDigitada(texto: string): LinhaImportada[] {
  const saida: LinhaImportada[] = []

  for (const linha of texto.split(/[\r\n]+/)) {
    const bruta = linha.trim()
    if (!bruta || bruta.startsWith('#')) continue

    // "Nome <email>"
    const comAngulo = bruta.match(/^(.*?)<([^>]+)>\s*$/)
    if (comAngulo) {
      saida.push({
        nome: comAngulo[1]!.trim().replace(/^["']|["']$/g, ''),
        email: comAngulo[2]!.trim(),
        empresa: '',
        extras: {}
      })
      continue
    }

    // separado por ; ou , ou tab
    const partes = bruta.split(/[;,\t]/).map(p => p.trim())
    if (partes.length > 1) {
      // o e-mail pode estar em qualquer posicao: procuramos pelo @
      const idx = partes.findIndex(p => p.includes('@'))
      const email = idx >= 0 ? partes[idx]! : partes[1]!
      const resto = partes.filter((_, i) => i !== (idx >= 0 ? idx : 1))
      saida.push({
        nome: resto[0] || '',
        email,
        empresa: resto[1] || '',
        extras: {}
      })
      continue
    }

    saida.push({ nome: '', email: bruta, empresa: '', extras: {} })
  }

  return saida
}
