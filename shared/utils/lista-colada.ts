/**
 * Lista digitada ou colada (do Excel, do Outlook, de um e-mail): um
 * destinatario por linha, nos formatos que a pessoa naturalmente usa:
 *
 *   maria@empresa.com.br
 *   Maria Oliveira <maria@empresa.com.br>
 *   Maria Oliveira; maria@empresa.com.br; Empresa Exemplo LTDA
 *   12.345.678/0001-95 <tab> Empresa Exemplo <tab> maria@empresa.com.br   (colunas em qualquer ordem)
 *
 * O e-mail e reconhecido pelo @ e o CPF/CNPJ por ter 11 ou 14 digitos; o
 * resto, na ordem, vira nome e empresa. Linhas com # no comeco sao ignoradas.
 * A validacao e a deduplicacao ficam para quem recebe (o carrinho).
 */

export interface LinhaColada {
  email: string
  nome: string
  empresa: string
  documento: string
  /** numero da linha no texto, para apontar o que nao entrou */
  linha: number
}

const ehDocumento = (c: string) => /^[\d.\-/\s]+$/.test(c) && [11, 14].includes(c.replace(/\D/g, '').length)

export function lerListaColada(texto: string): LinhaColada[] {
  const saida: LinhaColada[] = []
  // \n sem +: a numeracao precisa acompanhar o que a pessoa ve no campo
  texto.split(/\r?\n/).forEach((bruta, i) => {
    const linha = bruta.trim()
    const numero = i + 1
    if (!linha || linha.startsWith('#')) return

    const comAngulo = /^(.*?)<([^>]+)>\s*[;,\t]?\s*(.*)$/.exec(linha)
    if (comAngulo) {
      const resto = comAngulo[3]!.split(/[;\t]/).map(c => c.trim()).filter(Boolean)
      const documento = resto.find(ehDocumento) ?? ''
      saida.push({
        nome: comAngulo[1]!.trim().replace(/^["']|["']$/g, ''),
        email: comAngulo[2]!.trim(),
        documento: documento.replace(/\D/g, ''),
        empresa: resto.filter(c => c !== documento)[0] ?? '',
        linha: numero
      })
      return
    }

    // tab e ; primeiro (Excel e CSV brasileiro); virgula so se nao houver outro
    const sep = /[\t;]/.test(linha) ? /[\t;]/ : /,/
    const cols = linha.split(sep).map(c => c.trim()).filter(Boolean)
    const email = cols.find(c => c.includes('@')) ?? (cols.length === 1 ? cols[0]! : '')
    const documento = cols.find(c => c !== email && ehDocumento(c)) ?? ''
    const textos = cols.filter(c => c !== email && c !== documento)
    saida.push({ email, nome: textos[0] ?? '', empresa: textos[1] ?? '', documento: documento.replace(/\D/g, ''), linha: numero })
  })
  return saida
}
