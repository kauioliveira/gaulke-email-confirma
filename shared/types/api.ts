/**
 * Tipos das respostas da API, compartilhados entre servidor e telas.
 *
 * Sao declarados a mao porque os caminhos passam por `api()` (suporte a
 * subcaminho via URL_ACESSO), e nesse formato o Nuxt nao consegue inferir
 * o tipo a partir da rota.
 */

export type StatusLote =
  | 'rascunho'
  | 'agendado'
  | 'enviando'
  | 'pausado'
  | 'concluido'
  | 'erro'
export type StatusDestinatario = 'pendente' | 'enviando' | 'enviado' | 'erro' | 'bounce'
export type TipoEvento =
  | 'enfileirado' | 'enviado' | 'erro' | 'abertura'
  | 'acesso' | 'confirmacao' | 'download' | 'reenvio'

export interface Template {
  id: number
  nome: string
  assunto: string
  html: string
  createdAt: string
  updatedAt: string
}

export interface Lote {
  id: number
  nome: string
  templateId: number | null
  assuntoSnapshot: string
  htmlSnapshot: string
  arquivoPath: string | null
  arquivoNome: string | null
  intervaloMs: number
  exigirConfirmacao: string
  pedirRecibo: string
  status: StatusLote
  total: number
  enviados: number
  falhas: number
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  agendadoPara: string | null
  agendadoEm: string | null
  /** motivo quando o proprio sistema mudou o status do lote */
  observacao: string | null
  workerAtivo?: boolean
}

export interface Destinatario {
  id: number
  batchId: number
  nome: string | null
  email: string
  empresa: string | null
  dadosExtras: Record<string, unknown> | null
  token: string
  codigo: string
  status: StatusDestinatario
  tentativas: number
  ultimoErro: string | null
  messageId: string | null
  sentAt: string | null
  firstOpenAt: string | null
  firstHumanOpenAt: string | null
  lastOpenAt: string | null
  openCount: number
  firstAccessAt: string | null
  confirmedAt: string | null
  firstDownloadAt: string | null
  downloadCount: number
  createdAt: string
}

export interface EventoMail {
  id: number
  recipientId: number
  tipo: TipoEvento
  ip: string | null
  userAgent: string | null
  referer: string | null
  meta: unknown
  createdAt: string
}

export interface ContagemLote {
  total: number
  pendentes: number
  enviados: number
  erros: number
  aberturas: number
  aberturasPessoa: number
  aberturasMaquina: number
  acessos: number
  confirmacoes: number
  downloads: number
}

export interface ResumoRelatorio {
  total: number
  enviados: number
  erros: number
  aberturas: number
  aberturasPessoa: number
  aberturasMaquina: number
  acessos: number
  confirmacoes: number
  downloads: number
}

export interface LinhaRelatorio extends Omit<Destinatario, 'dadosExtras'> {
  loteNome: string
  ultimoIp: string | null
}

/* ---------- respostas dos endpoints ---------- */

export interface RespostaTemplates { templates: Template[] }

export interface RespostaLotes {
  lotes: Lote[]
  total: number
  pagina: number
  porPagina: number
  /** quantos lotes existem em cada status, ignorando os filtros da tela */
  contagemPorStatus: Record<string, number>
}

/** Lista enxuta para combos — nao e paginada. */
export interface RespostaLotesOpcoes {
  lotes: { id: number; nome: string; status: StatusLote }[]
}
export interface RespostaLote { lote: Lote; contagem: ContagemLote }
export interface RespostaDestinatarios {
  destinatarios: Destinatario[]
  total: number
  pagina: number
  porPagina: number
}
export interface RespostaRelatorio {
  linhas: LinhaRelatorio[]
  total: number
  pagina: number
  porPagina: number
  resumo: ResumoRelatorio
}
export interface RespostaFichaDestinatario {
  destinatario: Destinatario
  loteNome: string
  loteId: number
  arquivoNome: string | null
  assunto: string
  html: string
  link: string
  timeline: EventoMail[]
}
export interface RespostaArquivos {
  arquivos: { nome: string; tamanho: number; modificadoEm: string }[]
}
export interface RespostaStatus {
  smtp: { ok: boolean; mensagem: string; host: string; port: number; from: string; habilitado: boolean }
  urlAcesso: { valor: string; aviso: string | null; alcance: string | null }
  lotesAtivos: number[]
  migrations: {
    ok: boolean
    aplicadas: string[]
    pendentesAntes: number
    erro?: string
    em: string
  } | null
}
export interface RespostaLanding {
  nome: string | null
  empresa: string | null
  codigo: string
  loteNome: string
  arquivoNome: string | null
  temArquivo: boolean
  exigirConfirmacao: boolean
  confirmado: boolean
  confirmadoEm: string | null
  downloads: number
}
export interface RespostaImportacao {
  arquivo: string
  colunas: string[]
  total: number
  sugestao: { email: string; nome: string; empresa: string }
  previa: Record<string, string>[]
  linhas: Record<string, string>[]
}

export interface Contato {
  email: string
  nome: string | null
  empresa: string | null
  loteNome: string
  loteId: number
  sentAt: string | null
  confirmedAt: string | null
  firstDownloadAt: string | null
  status: StatusDestinatario
}

export interface RespostaContatos {
  contatos: Contato[]
  total: number
  /** quantos e-mails distintos existem no banco, ignorando os filtros */
  totalGeral: number
}

export type OrigemPessoa = 'equipe' | 'cliente'

/** Pessoa vinda das tabelas do sistema da empresa (somente leitura). */
export interface Pessoa {
  chave: string
  origem: OrigemPessoa
  nome: string
  email: string
  detalhe: string | null
  documento: string | null
}

export interface RespostaPessoas {
  pessoas: Pessoa[]
  total: number
  /** quantos existem ao todo, ignorando a busca */
  totais: { equipe: number; cliente: number }
}
