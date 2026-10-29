import { baseUrl, linkAcesso, linkPixel, linkLogo } from './urls'
import { chaveVariavel } from '../../shared/utils/variaveis'

export type VarsDestinatario = {
  nome?: string | null
  email: string
  empresa?: string | null
  codigo: string
  token: string
  dadosExtras?: Record<string, unknown> | null
}

function escapeHtml(v: unknown) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// aceita acento e espaco: colunas extras chegam com o nome da planilha
// ("Alíquota do Simples"), e a chave e normalizada por chaveVariavel
const RE_VARIAVEL = /\{\{\s*([^{}#/]+?)\s*\}\}/g
const RE_SECAO = /\{\{\s*#([^{}#/]+?)\s*\}\}([\s\S]*?)\{\{\s*\/\1\s*\}\}/g

/**
 * Trecho condicional: `{{#empresa}}, da {{empresa}}{{/empresa}}` so aparece
 * quando o campo veio preenchido da planilha.
 *
 * Existe porque `empresa` e opcional na importacao: sem isto, um destinatario
 * sem empresa receberia "para a sua analise, referente a ." — pontuacao solta
 * que o operador so descobriria depois do lote enviado.
 *
 * Nao aninha: uma secao dentro da outra nao e suportada de proposito, porque
 * o editor visual nao tem como mostrar isso de forma compreensivel.
 */
function aplicarSecoes(texto: string, preenchida: (chave: string) => boolean) {
  return texto.replace(RE_SECAO, (_m, chave: string, corpo: string) =>
    preenchida(chaveVariavel(chave)) ? corpo : ''
  )
}

/**
 * Substitui {{variavel}} no HTML. Valores sao escapados: um nome vindo da
 * planilha nunca deve conseguir injetar tag no corpo do e-mail.
 * `link`, `pixel` e `logo` sao URLs geradas por nos, entao entram cruas.
 */
export function renderizar(html: string, r: VarsDestinatario, base?: string) {
  const seguras: Record<string, string> = {
    link: linkAcesso(r.token, base),
    pixel: linkPixel(r.token, base),
    logo: linkLogo(base),
    // usada pelo bloco de imagem do editor visual, que monta {{base}}/brand/arquivo
    base: base ?? baseUrl()
  }
  const escapadas: Record<string, string> = {
    nome: escapeHtml(r.nome || r.email.split('@')[0]),
    email: escapeHtml(r.email),
    empresa: escapeHtml(r.empresa || ''),
    codigo: escapeHtml(r.codigo)
  }
  for (const [coluna, v] of Object.entries(r.dadosExtras || {})) {
    const k = chaveVariavel(coluna)
    if (k && !(k in seguras) && !(k in escapadas)) escapadas[k] = escapeHtml(v)
  }

  const comSecoes = aplicarSecoes(html, k => !!(seguras[k] || escapadas[k]))

  let out = comSecoes.replace(RE_VARIAVEL, (m, chave: string) => {
    const k = chaveVariavel(chave)
    if (k in seguras) return seguras[k]!
    if (k in escapadas) return escapadas[k]!
    return m
  })

  // Garante o pixel de abertura mesmo que o template nao use {{pixel}}
  if (!out.includes(seguras.pixel!)) {
    const img = `<img src="${seguras.pixel}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px" />`
    out = out.includes('</body>') ? out.replace('</body>', `${img}</body>`) : out + img
  }
  return out
}

export function renderizarAssunto(assunto: string, r: VarsDestinatario) {
  const valores: Record<string, string> = {
    nome: r.nome || r.email.split('@')[0] || '',
    empresa: r.empresa || '',
    codigo: r.codigo,
    email: r.email
  }
  for (const [coluna, v] of Object.entries(r.dadosExtras || {})) {
    const k = chaveVariavel(coluna)
    if (k && !(k in valores)) valores[k] = String(v ?? '')
  }
  return aplicarSecoes(assunto, k => !!valores[k]).replace(RE_VARIAVEL, (m, chave: string) => {
    const k = chaveVariavel(chave)
    return k in valores ? valores[k]! : m
  })
}

/** Versao texto puro, para clientes que nao renderizam HTML. */
export function versaoTexto(r: VarsDestinatario, assunto: string, base?: string) {
  return [
    `Ola ${r.nome || ''},`.trim(),
    '',
    assunto,
    '',
    `Acesse o documento pelo link abaixo:`,
    linkAcesso(r.token, base),
    '',
    `Codigo de referencia: ${r.codigo}`,
    '',
    'Este acesso e individual. Registramos data, hora e IP do acesso e do download para fins de comprovacao.'
  ].join('\n')
}
