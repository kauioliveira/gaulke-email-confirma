import type { Bloco } from '~~/shared/types/blocos'

/**
 * Variáveis que o sistema preenche sozinho no envio (server/utils/render.ts).
 *
 * Qualquer outra {{chave}} só é preenchida se a planilha do lote tiver uma
 * coluna com esse nome (dados extras) — do contrário ela aparece LITERAL no
 * e-mail do cliente, com as chaves. Por isso a tela avisa, mas não proíbe:
 * pode ser de propósito.
 */
export const VARIAVEIS_CONHECIDAS = ['nome', 'email', 'empresa', 'codigo', 'link', 'pixel', 'logo', 'base']

const RE_VARIAVEL = /\{\{\s*[#/]?\s*([\w.-]+)\s*\}\}/g

/** Todos os textos que a pessoa escreveu nos blocos. */
function textosDosBlocos(blocos: Bloco[]): string[] {
  const out: string[] = []
  for (const b of blocos) {
    if ('texto' in b && typeof b.texto === 'string') out.push(b.texto)
    if (b.tipo === 'lista') out.push(...b.itens)
    if (b.tipo === 'codigo') out.push(b.rotulo, b.ajuda)
    if (b.tipo === 'imagem') out.push(b.alt)
  }
  return out
}

/** Variáveis usadas que o sistema não conhece, sem repetir. */
export function variaveisDesconhecidas(assunto: string, blocos: Bloco[] | null, html?: string) {
  const textos = [assunto, ...(blocos ? textosDosBlocos(blocos) : []), ...(html && !blocos ? [html] : [])]
  const achadas = new Set<string>()
  for (const t of textos) {
    for (const m of t.matchAll(RE_VARIAVEL)) {
      const chave = m[1]!.toLowerCase()
      if (!VARIAVEIS_CONHECIDAS.includes(chave)) achadas.add(chave)
    }
  }
  return [...achadas]
}
