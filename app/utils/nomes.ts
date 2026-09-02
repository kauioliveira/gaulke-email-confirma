/**
 * Padronizacao de nomes na hora do envio.
 *
 * As listas chegam de origens diferentes (planilha do cliente, banco, digitado
 * a mao, sistema) e cada uma vem com uma capitalizacao. Como o nome aparece no
 * corpo do e-mail, ele precisa sair uniforme — e quem dispara escolhe o estilo.
 *
 * O e-mail NAO entra nessa escolha: ele e sempre normalizado para minusculas,
 * porque a parte do dominio e insensivel a caixa e a lista e deduplicada por
 * ele.
 */

export type FormatoNome = 'titulo' | 'maiusculas' | 'minusculas'

export const FORMATOS_NOME: { valor: FormatoNome; titulo: string; desc: string }[] = [
  { valor: 'titulo', titulo: 'Iniciais maiúsculas', desc: 'preposições em minúsculas' },
  { valor: 'maiusculas', titulo: 'TUDO MAIÚSCULO', desc: 'caixa alta' },
  { valor: 'minusculas', titulo: 'tudo minúsculo', desc: 'caixa baixa' }
]

/** Textos de amostra usados para mostrar o efeito de cada formato na tela. */
export const AMOSTRA_NOME = 'Maria Aparecida de Souza Oliveira'
export const AMOSTRA_EMPRESA = 'Empresa Exemplo LTDA'

/** Palavras que ficam em minusculas quando NAO sao a primeira do nome. */
const PARTICULAS = new Set([
  'de', 'do', 'da', 'dos', 'das', 'del', 'della', 'di', 'du',
  'e', 'em', 'a', 'o', 'na', 'no', 'nas', 'nos',
  'van', 'von', 'der', 'den', 'la', 'le', 'las', 'los', 'y'
])

/**
 * Siglas que continuam em caixa alta em "iniciais maiusculas" — sem isso
 * "EMPRESA EXEMPLO LTDA" viraria "Empresa Exemplo Ltda".
 */
const SIGLAS = new Set([
  'ltda', 'me', 'epp', 'mei', 'sa', 's/a', 's.a', 's.a.', 'eireli', 'cia',
  'ong', 'oscip', 'slu', 'ss', 'ei', 'cnpj', 'cpf', 'crc', 'tv', 'it', 'rh'
])

/** Numerais romanos (Joao Paulo II, Fabrica III). */
const RE_ROMANO = /^[ivxlcdm]+$/

function capitalizar(palavra: string) {
  return palavra.charAt(0).toUpperCase() + palavra.slice(1)
}

/**
 * Aplica a regra a cada pedaco separado por hifen ou apostrofo, para
 * "maria-clara" e "d'avila" saírem certos.
 */
function porPedacos(palavra: string, fn: (p: string) => string) {
  return palavra
    .split(/([-'’])/)
    .map(p => (/^[-'’]$/.test(p) ? p : fn(p)))
    .join('')
}

/** Iniciais maiusculas, mantendo preposicoes em minusculas e siglas em caixa alta. */
export function tituloNome(texto: string) {
  const limpo = texto.trim().replace(/\s+/g, ' ')
  if (!limpo) return ''

  const palavras = limpo.split(' ')
  return palavras
    .map((bruta, i) => {
      const baixa = bruta.toLowerCase()
      if (SIGLAS.has(baixa)) return baixa.toUpperCase()
      if (RE_ROMANO.test(baixa) && baixa.length > 1) return baixa.toUpperCase()
      // particula so fica minuscula no meio: "De Souza" no comeco continua "De"
      if (i > 0 && i < palavras.length - 1 && PARTICULAS.has(baixa)) return baixa
      return porPedacos(baixa, p => (p ? capitalizar(p) : p))
    })
    .join(' ')
}

export function maiusculasNome(texto: string) {
  return texto.trim().replace(/\s+/g, ' ').toUpperCase()
}

export function minusculasNome(texto: string) {
  return texto.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Aplica o formato escolhido a um nome ou razao social. */
export function formatarNome(texto: string | null | undefined, formato: FormatoNome) {
  const v = String(texto || '')
  if (!v.trim()) return ''
  if (formato === 'maiusculas') return maiusculasNome(v)
  if (formato === 'minusculas') return minusculasNome(v)
  return tituloNome(v)
}

/**
 * Sufixos de geracao: andam colados ao ultimo sobrenome e nunca viram inicial
 * — "Jose da Silva Junior" abreviado continua "Jose Silva Junior", e nao
 * "Jose S. Junior", que jogaria fora o sobrenome que identifica a pessoa.
 */
const SUFIXOS = new Set(['junior', 'jr', 'jr.', 'filho', 'neto', 'sobrinho', 'segundo', 'terceiro'])

/**
 * Abrevia o nome: primeiro nome e ultimo sobrenome por extenso, os do meio
 * viram inicial, as preposicoes saem.
 *
 *   Maria Aparecida de Souza Oliveira -> Maria A. S. Oliveira
 *   Jose da Silva Junior              -> Jose Silva Junior
 *
 * Roda DEPOIS do formato de caixa, entao a inicial sai na mesma caixa do
 * nome inteiro.
 */
export function abreviarNome(texto: string | null | undefined) {
  const limpo = String(texto || '').trim().replace(/\s+/g, ' ')
  if (!limpo) return ''

  const palavras = limpo.split(' ')

  // sufixo fica reservado e volta no fim, sem participar da abreviacao
  const sufixos: string[] = []
  while (palavras.length > 2 && SUFIXOS.has(palavras[palavras.length - 1]!.toLowerCase())) {
    sufixos.unshift(palavras.pop()!)
  }

  // particula no inicio faz parte do nome ("De La Cruz"), nao e ligacao
  const prefixo: string[] = []
  while (palavras.length && PARTICULAS.has(palavras[0]!.toLowerCase())) prefixo.push(palavras.shift()!)

  const nucleo = palavras.filter(p => !PARTICULAS.has(p.toLowerCase()))
  // sem material suficiente (so um nome, ou so particulas) nao ha o que abreviar
  if (nucleo.length < 2) return [...prefixo, ...(nucleo.length ? nucleo : palavras), ...sufixos].join(' ')

  const primeiro = [...prefixo, nucleo[0]!].join(' ')
  const ultimo = nucleo[nucleo.length - 1]!
  const meio = nucleo.slice(1, -1).map(p => `${[...p][0]}.`)

  return [primeiro, ...meio, ultimo, ...sufixos].join(' ')
}

/** Formatacao escolhida na tela: cada campo tem a sua, e so o nome abrevia. */
export type FormatosDestinatario = {
  nome: FormatoNome
  empresa: FormatoNome
  abreviarNome?: boolean
}

/**
 * Aplica a formatacao escolhida a um destinatario.
 *
 * Nome e empresa sao independentes — e comum querer a razao social em caixa
 * alta, como ela aparece no contrato, e o nome da pessoa so com as iniciais.
 * O e-mail nao entra na escolha: vai sempre em minusculas.
 */
export function formatarDestinatario<T extends { email: string; nome?: string; empresa?: string }>(
  d: T,
  formatos: FormatosDestinatario
): T {
  const nome = formatarNome(d.nome, formatos.nome)
  return {
    ...d,
    email: String(d.email || '').trim().toLowerCase(),
    nome: formatos.abreviarNome ? abreviarNome(nome) : nome,
    empresa: formatarNome(d.empresa, formatos.empresa)
  }
}
