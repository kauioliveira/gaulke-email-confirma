import { linkAcesso, linkPixel, linkLogo } from './urls'

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

/**
 * Substitui {{variavel}} no HTML. Valores sao escapados: um nome vindo da
 * planilha nunca deve conseguir injetar tag no corpo do e-mail.
 * `link`, `pixel` e `logo` sao URLs geradas por nos, entao entram cruas.
 */
export function renderizar(html: string, r: VarsDestinatario, base?: string) {
  const seguras: Record<string, string> = {
    link: linkAcesso(r.token, base),
    pixel: linkPixel(r.token, base),
    logo: linkLogo(base)
  }
  const escapadas: Record<string, string> = {
    nome: escapeHtml(r.nome || r.email.split('@')[0]),
    email: escapeHtml(r.email),
    empresa: escapeHtml(r.empresa || ''),
    codigo: escapeHtml(r.codigo)
  }
  for (const [k, v] of Object.entries(r.dadosExtras || {})) {
    if (!(k in seguras) && !(k in escapadas)) escapadas[k] = escapeHtml(v)
  }

  let out = html.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m, chave: string) => {
    const k = chave.toLowerCase()
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
  return assunto.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m, chave: string) => {
    const k = chave.toLowerCase()
    if (k === 'nome') return r.nome || r.email.split('@')[0] || ''
    if (k === 'empresa') return r.empresa || ''
    if (k === 'codigo') return r.codigo
    if (k === 'email') return r.email
    return m
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
