/**
 * Lote "arquivos por cliente": o operador sobe um ZIP (ou vários arquivos),
 * o servidor descobre o CPF/CNPJ de cada arquivo (nome ou conteúdo) e o
 * cadastro de contatos devolve os e-mails. Cada linha é UM arquivo; cada
 * e-mail marcado vira um destinatário com o seu link e o seu código.
 */

export type ContatoLinha = {
  email: string
  nome: string | null
  marcado: boolean
  /** devolveu definitivamente: não adianta mandar */
  suprimido: boolean
  /** digitado na tela (vai para o cadastro ao criar o lote) */
  manual: boolean
}

export type LinhaArquivo = {
  /** nome no storage */
  nome: string
  original: string
  tamanho: number
  tipo: string
  /** o que o servidor achou no arquivo */
  documentos: string[]
  docOrigem: 'nome' | 'conteudo' | 'manual' | null
  /** o documento escolhido (só dígitos) */
  documento: string | null
  empresa: string | null
  /** null = ainda não consultado; false = não está no cadastro nem no histórico */
  cadastrado: boolean | null
  emails: ContatoLinha[]
}

export type SituacaoLinha = 'pronto' | 'sem_email' | 'sem_documento' | 'varios_documentos'

export function situacaoLinha(l: LinhaArquivo): SituacaoLinha {
  if (!l.documento) return l.documentos.length > 1 ? 'varios_documentos' : 'sem_documento'
  return l.emails.some(e => e.marcado && !e.suprimido) ? 'pronto' : 'sem_email'
}

export const SITUACOES: Record<SituacaoLinha, { rotulo: string; cor: 'success' | 'warning' | 'error'; icone: string }> = {
  pronto: { rotulo: 'Pronto', cor: 'success', icone: 'i-lucide-check-circle-2' },
  sem_email: { rotulo: 'Sem e-mail', cor: 'warning', icone: 'i-lucide-mail-question' },
  sem_documento: { rotulo: 'CNPJ não encontrado', cor: 'warning', icone: 'i-lucide-file-search' },
  varios_documentos: { rotulo: 'Vários CNPJs', cor: 'warning', icone: 'i-lucide-files' }
}

/** Os destinatários do lote: um por e-mail marcado de cada arquivo pronto. */
export function destinatariosDasLinhas(linhas: LinhaArquivo[]) {
  const saida: {
    email: string
    nome: string
    empresa: string
    documento: string
    arquivoNome: string
    arquivoOriginal: string
  }[] = []
  for (const l of linhas) {
    if (situacaoLinha(l) !== 'pronto') continue
    for (const e of l.emails) {
      if (!e.marcado || e.suprimido) continue
      saida.push({
        email: e.email,
        // {{nome}} do e-mail: o contato quando se sabe quem é; senão a empresa
        nome: e.nome || l.empresa || '',
        empresa: l.empresa || '',
        documento: l.documento!,
        arquivoNome: l.nome,
        arquivoOriginal: l.original
      })
    }
  }
  return saida
}

/** Nome sugerido para o lote a partir do ZIP: "Relatorio_Imobilizado_08-2026.zip" -> "Relatorio Imobilizado 08-2026". */
export function nomeDoLotePeloArquivo(arquivo: string) {
  return arquivo
    .replace(/\.[A-Za-z0-9]{1,6}$/, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
}
