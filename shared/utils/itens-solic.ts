import { dataSP } from './fuso'
import { documentoValidoDV, formatarDocumento, soDigitosDoc } from './documento'
import type { ConfigItem, ItemModeloChecklist, RespostaItem, TipoItemSolic } from '../types/api'

/**
 * Tipos de item de uma solicitacao. "documento" e o envio de arquivo de
 * sempre; os demais o cliente responde na propria pagina (/r/:token).
 *
 * Este arquivo e a UNICA fonte das regras: o editor do modelo, a pagina do
 * cliente e o servidor validam com as mesmas funcoes.
 */

export type GrupoTipoItem = 'arquivo' | 'texto' | 'escolha' | 'campo' | 'declaracao' | 'informativo'

export const TIPOS_ITEM_SOLIC: { valor: TipoItemSolic; rotulo: string; icone: string; grupo: GrupoTipoItem }[] = [
  { valor: 'documento', rotulo: 'Documento (arquivo)', icone: 'i-lucide-file-up', grupo: 'arquivo' },
  { valor: 'texto_curto', rotulo: 'Texto curto', icone: 'i-lucide-type', grupo: 'texto' },
  { valor: 'texto_longo', rotulo: 'Texto longo', icone: 'i-lucide-align-left', grupo: 'texto' },
  { valor: 'escolha', rotulo: 'Escolha (alternativas)', icone: 'i-lucide-list-checks', grupo: 'escolha' },
  { valor: 'email', rotulo: 'E-mail', icone: 'i-lucide-at-sign', grupo: 'campo' },
  { valor: 'telefone', rotulo: 'Telefone', icone: 'i-lucide-phone', grupo: 'campo' },
  { valor: 'cpf_cnpj', rotulo: 'CPF / CNPJ', icone: 'i-lucide-id-card', grupo: 'campo' },
  { valor: 'data', rotulo: 'Data', icone: 'i-lucide-calendar', grupo: 'campo' },
  { valor: 'numero', rotulo: 'Número', icone: 'i-lucide-hash', grupo: 'campo' },
  { valor: 'moeda', rotulo: 'Valor (R$)', icone: 'i-lucide-banknote', grupo: 'campo' },
  { valor: 'declaracao', rotulo: 'Declaração / aceite', icone: 'i-lucide-signature', grupo: 'declaracao' },
  { valor: 'informativo', rotulo: 'Texto / informação', icone: 'i-lucide-text', grupo: 'informativo' }
]

/**
 * "Texto / informação": um texto escrito por quem pede (orientação, aviso,
 * contexto) que o cliente so le. Nao e respondido, nao e obrigatorio e fica
 * fora do progresso, da analise, dos e-mails e das exportacoes.
 */
export const ehInformativo = (i: { tipo: TipoItemSolic | string }) => i.tipo === 'informativo'

/** Classes do texto informativo, iguais na pagina do cliente e no painel. */
export function classesInformativo(c: ConfigItem) {
  const alinhamento = { justificado: 'text-justify', esquerda: 'text-left', centro: 'text-center' }[c.alinhamento ?? 'justificado']
  const caixa = c.cor
    ? {
        neutro: 'rounded-lg border border-default bg-elevated/60 px-4 py-3',
        atencao: 'rounded-lg border border-warning/40 bg-warning/10 px-4 py-3',
        alerta: 'rounded-lg border border-error/40 bg-error/10 px-4 py-3'
      }[c.cor]
    : ''
  return `whitespace-pre-line leading-relaxed ${alinhamento} ${caixa}`
}

export const TIPOS_ITEM_VALIDOS = TIPOS_ITEM_SOLIC.map(t => t.valor) as [TipoItemSolic, ...TipoItemSolic[]]

export const ehTipoItem = (v: unknown): v is TipoItemSolic => TIPOS_ITEM_VALIDOS.includes(v as TipoItemSolic)

export const rotuloTipoItem = (t: TipoItemSolic | string) => TIPOS_ITEM_SOLIC.find(x => x.valor === t)?.rotulo ?? 'Documento'
export const iconeTipoItem = (t: TipoItemSolic | string) => TIPOS_ITEM_SOLIC.find(x => x.valor === t)?.icone ?? 'i-lucide-file-up'

export const OPCOES_SIM_NAO = ['Sim', 'Não']

export const LIMITES_ITEM = {
  textoCurto: { padrao: 200, max: 500 },
  textoLongo: { padrao: 2000, max: 5000 },
  opcoes: { min: 2, max: 30, tamanho: 120 },
  declaracao: 4000,
  outro: 300
}

const DECLARACAO_PADRAO =
  'Declaro, para os devidos fins, que as informações e os documentos enviados nesta solicitação são verdadeiros e de minha responsabilidade.'

/** Item novo para o editor. */
export function novoItemSolic(tipo: TipoItemSolic = 'documento', preset?: 'sim_nao'): ItemModeloChecklist {
  const base: ItemModeloChecklist = {
    tipo,
    config: {},
    titulo: '',
    instrucao: null,
    obrigatorio: true,
    tipos: [],
    maxArquivos: 1,
    modeloPath: null,
    modeloNome: null
  }
  switch (tipo) {
    case 'documento':
      return { ...base, tipos: ['PDF', 'imagem'], maxArquivos: 5 }
    case 'escolha':
      return preset === 'sim_nao'
        ? { ...base, config: { multipla: false, opcoes: [...OPCOES_SIM_NAO], outro: false } }
        : { ...base, config: { multipla: false, opcoes: ['', ''], outro: false } }
    case 'cpf_cnpj':
      return { ...base, config: { aceita: 'ambos' } }
    case 'declaracao':
      return { ...base, titulo: 'Declaração', config: { texto: DECLARACAO_PADRAO } }
    case 'informativo':
      return { ...base, obrigatorio: false, config: { texto: '', alinhamento: 'justificado' } }
    case 'texto_curto':
      return { ...base, config: { maxLen: LIMITES_ITEM.textoCurto.padrao } }
    case 'texto_longo':
      return { ...base, config: { maxLen: LIMITES_ITEM.textoLongo.padrao } }
    default:
      return base
  }
}

/* ------------------------------------------------------------------------
 * Configuracao do item
 * --------------------------------------------------------------------- */

type Resultado<T> = { ok: true; valor: T } | { ok: false; erro: string }

const inteiro = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : undefined)
const numeroOuNada = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const dataIso = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && dataReal(v) ? v : undefined)

function dataReal(iso: string) {
  const [a, m, d] = iso.split('-').map(Number) as [number, number, number]
  const dt = new Date(Date.UTC(a, m - 1, d))
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

/**
 * Limpa a configuracao: guarda so o que vale para o tipo e confere os
 * limites. Usado no editor (para avisar) e no servidor (para gravar).
 */
export function normalizarConfig(tipo: TipoItemSolic, cfg: ConfigItem | null | undefined): Resultado<ConfigItem> {
  const c = cfg ?? {}
  const out: ConfigItem = {}
  if (c.conferir === false && tipo !== 'documento' && tipo !== 'informativo') out.conferir = false

  switch (tipo) {
    case 'documento':
      break
    case 'texto_curto':
    case 'texto_longo': {
      const lim = tipo === 'texto_curto' ? LIMITES_ITEM.textoCurto : LIMITES_ITEM.textoLongo
      const max = inteiro(c.maxLen) ?? lim.padrao
      if (max < 1 || max > lim.max) return { ok: false, erro: `O limite de caracteres vai de 1 a ${lim.max}.` }
      out.maxLen = max
      if (typeof c.placeholder === 'string' && c.placeholder.trim()) out.placeholder = c.placeholder.trim().slice(0, 120)
      break
    }
    case 'escolha': {
      const opcoes = (Array.isArray(c.opcoes) ? c.opcoes : []).map(o => String(o ?? '').trim())
      if (opcoes.some(o => !o)) return { ok: false, erro: 'Preencha todas as alternativas (ou remova as vazias).' }
      if (opcoes.length < LIMITES_ITEM.opcoes.min) return { ok: false, erro: 'Coloque pelo menos 2 alternativas.' }
      if (opcoes.length > LIMITES_ITEM.opcoes.max) return { ok: false, erro: `No máximo ${LIMITES_ITEM.opcoes.max} alternativas.` }
      if (opcoes.some(o => o.length > LIMITES_ITEM.opcoes.tamanho)) {
        return { ok: false, erro: `Cada alternativa tem no máximo ${LIMITES_ITEM.opcoes.tamanho} caracteres.` }
      }
      if (new Set(opcoes.map(o => o.toLowerCase())).size !== opcoes.length) return { ok: false, erro: 'Há alternativas repetidas.' }
      out.opcoes = opcoes
      out.multipla = !!c.multipla
      out.outro = !!c.outro
      if (out.multipla) {
        const total = opcoes.length + (out.outro ? 1 : 0)
        const min = inteiro(c.minEscolhas)
        const max = inteiro(c.maxEscolhas)
        if (min != null && (min < 1 || min > total)) return { ok: false, erro: 'Mínimo de escolhas inválido.' }
        if (max != null && (max < 1 || max > total)) return { ok: false, erro: 'Máximo de escolhas inválido.' }
        if (min != null && max != null && min > max) return { ok: false, erro: 'O mínimo de escolhas é maior que o máximo.' }
        if (min != null) out.minEscolhas = min
        if (max != null) out.maxEscolhas = max
      }
      break
    }
    case 'numero':
    case 'moeda': {
      const min = numeroOuNada(c.min)
      const max = numeroOuNada(c.max)
      if (min != null && max != null && min > max) return { ok: false, erro: 'O mínimo é maior que o máximo.' }
      if (min != null) out.min = min
      if (max != null) out.max = max
      if (tipo === 'numero') {
        const casas = inteiro(c.casas) ?? 0
        if (casas < 0 || casas > 4) return { ok: false, erro: 'Casas decimais: de 0 a 4.' }
        out.casas = casas
      }
      break
    }
    case 'data': {
      const min = dataIso(c.min)
      const max = dataIso(c.max)
      if (min && max && min > max) return { ok: false, erro: 'A data mínima é depois da máxima.' }
      if (min) out.min = min
      if (max) out.max = max
      if (c.naoFutura) out.naoFutura = true
      break
    }
    case 'cpf_cnpj':
      out.aceita = c.aceita === 'cpf' || c.aceita === 'cnpj' ? c.aceita : 'ambos'
      break
    case 'declaracao': {
      const texto = String(c.texto ?? '').trim()
      if (!texto) return { ok: false, erro: 'Escreva o texto da declaração.' }
      if (texto.length > LIMITES_ITEM.declaracao) return { ok: false, erro: `A declaração tem no máximo ${LIMITES_ITEM.declaracao} caracteres.` }
      out.texto = texto
      break
    }
    case 'informativo': {
      const texto = String(c.texto ?? '').trim()
      if (!texto) return { ok: false, erro: 'Escreva o texto que o cliente vai ler.' }
      if (texto.length > LIMITES_ITEM.declaracao) return { ok: false, erro: `O texto tem no máximo ${LIMITES_ITEM.declaracao} caracteres.` }
      out.texto = texto
      out.alinhamento = c.alinhamento === 'esquerda' || c.alinhamento === 'centro' ? c.alinhamento : 'justificado'
      if (c.cor === 'neutro' || c.cor === 'atencao' || c.cor === 'alerta') out.cor = c.cor
      break
    }
    case 'email':
    case 'telefone':
      break
  }
  return { ok: true, valor: out }
}

/* ------------------------------------------------------------------------
 * Resposta do cliente
 * --------------------------------------------------------------------- */

/** O que a pagina manda para uma escolha. */
export interface EntradaEscolha {
  escolhas: string[]
  /** null = "Outro" desmarcado; string (mesmo vazia) = marcado */
  outro?: string | null
}

const reEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const formatarMoeda = (centavos: number) =>
  (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function formatarTelefone(d: string) {
  if (d.length === 11) return d.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3')
  if (d.length === 10) return d.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3')
  return d
}

export function mascaraTelefone(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 2) return d ? `(${d}` : ''
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

const formatarDataIso = (iso: string) => iso.split('-').reverse().join('/')

/**
 * "1.234,56", "1234,56", "1234.56", 1234.56 -> 1234.56. A virgula manda:
 * havendo virgula, pontos sao milhar. Sem virgula, um unico ponto com ate 2
 * casas (numero) e decimal.
 */
export function lerNumeroBR(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  let s = v.trim().replace(/^R\$\s*/i, '').replace(/\s/g, '')
  if (!s) return null
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  else if ((s.match(/\./g) || []).length > 1 || /\.\d{3}$/.test(s)) s = s.replace(/\./g, '')
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** A entrada esta vazia (o cliente apagou ou nao respondeu)? */
export function entradaVazia(tipo: TipoItemSolic, entrada: unknown) {
  if (entrada == null) return true
  if (tipo === 'declaracao') return entrada !== true
  if (tipo === 'escolha') {
    const e = entrada as EntradaEscolha
    return !(e?.escolhas?.length) && !String(e?.outro ?? '').trim()
  }
  return String(entrada).trim() === ''
}

/**
 * Confere e normaliza a resposta. `resposta: null` = vazia (apagar).
 * A declaracao NAO recebe o sha aqui: o servidor carimba.
 */
export function validarResposta(
  tipo: TipoItemSolic,
  config: ConfigItem,
  entrada: unknown
): { ok: true; resposta: RespostaItem | null } | { ok: false; erro: string } {
  if (tipo === 'documento') return { ok: false, erro: 'Este item recebe arquivo, não resposta.' }
  if (tipo === 'informativo') return { ok: false, erro: 'Este item é só um texto para leitura.' }
  if (entradaVazia(tipo, entrada)) return { ok: true, resposta: null }
  const r = (valor: RespostaItem['valor'], exibicao: string, outro?: string) =>
    ({ ok: true as const, resposta: { v: 1 as const, valor, exibicao, ...(outro ? { outro } : {}) } })

  switch (tipo) {
    case 'texto_curto':
    case 'texto_longo': {
      if (typeof entrada !== 'string') return { ok: false, erro: 'Resposta inválida.' }
      const t = tipo === 'texto_curto' ? entrada.replace(/\s+/g, ' ').trim() : entrada.replace(/\r\n/g, '\n').trim()
      const max = config.maxLen ?? (tipo === 'texto_curto' ? LIMITES_ITEM.textoCurto.padrao : LIMITES_ITEM.textoLongo.padrao)
      if (t.length > max) return { ok: false, erro: `No máximo ${max} caracteres.` }
      return r(t, t)
    }
    case 'email': {
      const e = String(entrada).trim().toLowerCase()
      if (e.length > 320 || !reEmail.test(e)) return { ok: false, erro: 'E-mail inválido.' }
      return r(e, e)
    }
    case 'telefone': {
      let d = String(entrada).replace(/\D/g, '')
      if (d.length > 11 && d.startsWith('55')) d = d.slice(2)
      if (d.length < 10 || d.length > 11) return { ok: false, erro: 'Telefone com DDD: 10 ou 11 dígitos.' }
      return r(d, formatarTelefone(d))
    }
    case 'cpf_cnpj': {
      const d = soDigitosDoc(String(entrada))
      const aceita = config.aceita ?? 'ambos'
      if (!documentoValidoDV(d, aceita)) {
        return { ok: false, erro: aceita === 'cpf' ? 'CPF inválido.' : aceita === 'cnpj' ? 'CNPJ inválido.' : 'CPF ou CNPJ inválido.' }
      }
      return r(d, formatarDocumento(d))
    }
    case 'data': {
      const v = String(entrada).trim()
      if (!dataIso(v)) return { ok: false, erro: 'Data inválida.' }
      if (typeof config.min === 'string' && v < config.min) return { ok: false, erro: `A data não pode ser antes de ${formatarDataIso(config.min)}.` }
      if (typeof config.max === 'string' && v > config.max) return { ok: false, erro: `A data não pode ser depois de ${formatarDataIso(config.max)}.` }
      if (config.naoFutura && v > dataSP()) return { ok: false, erro: 'A data não pode estar no futuro.' }
      return r(v, formatarDataIso(v))
    }
    case 'numero': {
      const n = lerNumeroBR(entrada)
      if (n == null) return { ok: false, erro: 'Número inválido.' }
      const casas = config.casas ?? 0
      const arred = Number(n.toFixed(casas))
      if (Math.abs(arred - n) > 1e-9) return { ok: false, erro: casas ? `Use no máximo ${casas} casas decimais.` : 'Use um número inteiro.' }
      if (typeof config.min === 'number' && n < config.min) return { ok: false, erro: `O mínimo é ${config.min.toLocaleString('pt-BR')}.` }
      if (typeof config.max === 'number' && n > config.max) return { ok: false, erro: `O máximo é ${config.max.toLocaleString('pt-BR')}.` }
      return r(arred, arred.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }))
    }
    case 'moeda': {
      const n = lerNumeroBR(entrada)
      if (n == null) return { ok: false, erro: 'Valor inválido.' }
      const centavos = Math.round(n * 100)
      if (Math.abs(centavos - n * 100) > 1e-6) return { ok: false, erro: 'Use no máximo 2 casas decimais.' }
      if (Math.abs(centavos) > 1e13) return { ok: false, erro: 'Valor alto demais.' }
      if (typeof config.min === 'number' && n < config.min) return { ok: false, erro: `O mínimo é ${formatarMoeda(config.min * 100)}.` }
      if (typeof config.max === 'number' && n > config.max) return { ok: false, erro: `O máximo é ${formatarMoeda(config.max * 100)}.` }
      return r(centavos, formatarMoeda(centavos))
    }
    case 'escolha': {
      const e = entrada as EntradaEscolha
      if (!e || !Array.isArray(e.escolhas)) return { ok: false, erro: 'Resposta inválida.' }
      const opcoes = config.opcoes ?? []
      const escolhas = [...new Set(e.escolhas.map(String))]
      if (escolhas.some(x => !opcoes.includes(x))) return { ok: false, erro: 'Alternativa inexistente.' }
      const outro = config.outro ? String(e.outro ?? '').trim() : ''
      if (outro.length > LIMITES_ITEM.outro) return { ok: false, erro: `"Outro": no máximo ${LIMITES_ITEM.outro} caracteres.` }
      const total = escolhas.length + (outro ? 1 : 0)
      if (!config.multipla && total > 1) return { ok: false, erro: 'Escolha só uma alternativa.' }
      if (config.multipla) {
        if (config.minEscolhas && total < config.minEscolhas) return { ok: false, erro: `Escolha pelo menos ${config.minEscolhas}.` }
        if (config.maxEscolhas && total > config.maxEscolhas) return { ok: false, erro: `Escolha no máximo ${config.maxEscolhas}.` }
      }
      // mantem a ordem do modelo, nao a ordem do clique
      const ordenadas = opcoes.filter(o => escolhas.includes(o))
      const exibicao = [...ordenadas, ...(outro ? [`Outro: ${outro}`] : [])].join('; ')
      return r(config.multipla ? ordenadas : (ordenadas[0] ?? ''), exibicao, outro || undefined)
    }
    case 'declaracao':
      return r(true, 'Li e aceito a declaração')
  }
  return { ok: false, erro: 'Tipo de item desconhecido.' }
}

/** Valor da resposta guardada de volta como entrada do formulario (para editar). */
export function respostaParaEntrada(tipo: TipoItemSolic, resposta: RespostaItem | null): unknown {
  if (!resposta) {
    if (tipo === 'escolha') return { escolhas: [], outro: null } satisfies EntradaEscolha
    if (tipo === 'declaracao') return false
    return ''
  }
  switch (tipo) {
    case 'escolha': {
      const v = resposta.valor
      const escolhas = Array.isArray(v) ? v : v ? [String(v)] : []
      return { escolhas, outro: resposta.outro ?? null } satisfies EntradaEscolha
    }
    case 'declaracao':
      return resposta.valor === true
    case 'moeda':
      return typeof resposta.valor === 'number'
        ? (resposta.valor / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : ''
    case 'telefone':
      return formatarTelefone(String(resposta.valor))
    case 'cpf_cnpj':
      return formatarDocumento(String(resposta.valor))
    case 'numero':
      return resposta.exibicao
    default:
      return String(resposta.valor ?? '')
  }
}

/** Resumo curto da configuracao, para a linha recolhida do editor e o e-mail. */
export function descreverConfig(tipo: TipoItemSolic, c: ConfigItem): string {
  switch (tipo) {
    case 'texto_curto':
    case 'texto_longo':
      return `até ${c.maxLen ?? '—'} caracteres`
    case 'escolha': {
      const n = c.opcoes?.length ?? 0
      return `${n} alternativa${n === 1 ? '' : 's'}${c.multipla ? ', várias respostas' : ''}${c.outro ? ', com "Outro"' : ''}`
    }
    case 'cpf_cnpj':
      return c.aceita === 'cpf' ? 'só CPF' : c.aceita === 'cnpj' ? 'só CNPJ' : 'CPF ou CNPJ'
    case 'informativo':
      return `só leitura${c.texto ? ` — “${c.texto.slice(0, 60)}${c.texto.length > 60 ? '…' : ''}”` : ''}`
    case 'data':
      return [c.min && `a partir de ${formatarDataIso(String(c.min))}`, c.max && `até ${formatarDataIso(String(c.max))}`, c.naoFutura && 'não futura']
        .filter(Boolean)
        .join(', ')
    default:
      return ''
  }
}

/** Item pronto para salvar: tem nome e a configuracao do tipo confere. */
export const itemCompleto = (i: Pick<ItemModeloChecklist, 'titulo' | 'tipo' | 'config'>) =>
  (!!i.titulo.trim() || i.tipo === 'informativo') && normalizarConfig(i.tipo, i.config).ok

/** Copia funda dos itens (o editor nao pode mexer no objeto da lista carregada). */
export const copiarItens = <T extends ItemModeloChecklist>(itens: T[]): T[] => JSON.parse(JSON.stringify(itens))
