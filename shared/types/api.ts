/**
 * Tipos das respostas da API, compartilhados entre servidor e telas.
 *
 * Sao declarados a mao porque os caminhos passam por `api()` (suporte a
 * subcaminho via URL_ACESSO), e nesse formato o Nuxt nao consegue inferir
 * o tipo a partir da rota.
 */

export type StatusLote = 'rascunho' | 'enviando' | 'pausado' | 'concluido' | 'erro'
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
export interface RespostaLotes { lotes: Lote[] }
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
  urlAcesso: { valor: string; aviso: string | null }
  lotesAtivos: number[]
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
