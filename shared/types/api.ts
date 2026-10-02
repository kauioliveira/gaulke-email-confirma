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
  // lidos da caixa do canal pelo monitor (Fase 3)
  | 'devolucao' | 'recibo' | 'auto_resposta' | 'resposta'

/** documento: o cliente acessa, confirma e baixa um arquivo; comunicado: só um aviso */
export type TipoTemplate = 'documento' | 'comunicado'

export interface Template {
  id: number
  nome: string
  assunto: string
  html: string
  formato: 'blocos' | 'html'
  blocos: unknown[] | null
  tipo: TipoTemplate | null
  categoria: string | null
  /** oficial: só supervisor/admin editam; os demais duplicam */
  oficial: boolean
  /** setor que vê o template; null = todos os setores */
  departamentoId: number | null
  departamentoNome: string | null
  arquivadoEm: string | null
  criadoPorNome: string | null
  atualizadoPorNome: string | null
  /** envios disparados com este template */
  usos: number
  createdAt: string
  updatedAt: string
}

export interface VersaoTemplate {
  versao: number
  nome: string
  assunto: string
  formato: string
  tipo: TipoTemplate | null
  categoria: string | null
  salvoPorNome: string | null
  salvoEm: string
}

/** Conta de envio (SMTP). A senha nunca chega ao cliente. */
export interface ContaEnvio {
  id: number
  nome: string
  host: string
  port: number
  secure: boolean
  requireTls: boolean
  rejectUnauthorized: boolean
  usuario: string
  remetente: string
  responderPara: string | null
  ativa: boolean
  padrao: boolean
  ultimoTesteEm: string | null
  ultimoTesteOk: boolean | null
  ultimoTesteMsg: string | null
  /** monitor da caixa (somente leitura) e chamados no painel */
  monitorarCaixa: boolean
  imapHost: string | null
  imapPort: number
  imapSecure: boolean
  criarTickets: boolean
  diasSemConfirmacao: number
  imapUltimaLeituraEm: string | null
  imapUltimoErro: string | null
  imapUltimoErroEm: string | null
  criadoPorNome: string | null
  createdAt: string
  updatedAt: string
}

export interface ResultadoLeituraCaixa {
  ok: boolean
  mensagem: string
  lidas: number
  novas: number
  vinculadas: number
  porTipo: Record<string, number>
}

export type ClassificacaoInbound =
  | 'devolucao_definitiva' | 'devolucao_temporaria' | 'recibo' | 'auto_resposta' | 'aviso_servidor' | 'resposta'

export interface MensagemCaixa {
  id: number
  contaNome: string | null
  de: string | null
  assunto: string | null
  recebidoEm: string | null
  processadoEm: string
  classificacao: ClassificacaoInbound
  vinculo: string | null
  trecho: string | null
  detalhe: { status?: string | null; diagnostico?: string | null; destinatarioFalho?: string | null } | null
  recipientId: number | null
  destinatarioEmail: string | null
  destinatarioNome: string | null
  batchId: number | null
  loteNome: string | null
  /** resposta/devolucao de um e-mail de solicitacao ou de assinatura */
  solicId?: number | null
  solicTitulo?: string | null
  solicCodigo?: string | null
  assinDocumentoId?: number | null
  assinTitulo?: string | null
  assinCodigo?: string | null
  ticketCode: string | null
  ticketStatus: string | null
}

export interface EnderecoSuprimido {
  email: string
  motivo: string | null
  origem: 'devolucao' | 'manual'
  recipientId: number | null
  criadoEm: string
  criadoPorNome: string | null
}

export interface RespostaContas {
  contas: ContaEnvio[]
  /** sem a chave no .env nao da para guardar senha nenhuma */
  chave: { configurada: boolean; impressao: string | null }
  /** servidor de partida do canal novo: o padrao das Configuracoes, ou o do .env */
  sugestao: {
    host: string
    port: number
    secure: boolean
    requireTls: boolean
    rejectUnauthorized: boolean
    origem: 'config' | 'env'
  }
}

/** Registros de DNS que decidem se o e-mail do canal cai no spam. */
export interface VerificacaoDns {
  dominio: string
  spf: { ok: boolean; valor: string | null }
  dmarc: { ok: boolean; valor: string | null }
  /** DKIM depende do seletor, que nao e publico: procuramos os mais comuns */
  dkim: { ok: boolean; seletor: string | null }
  avisos: string[]
}

export interface RespostaTesteConta {
  ok: boolean
  mensagem: string
  dns?: VerificacaoDns | null
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
  /**
   * Autoria. Nula em lotes criados antes do login pela sessao do painel, e
   * tambem quando se entrou pela senha do .env — que e anonima por natureza.
   */
  criadoPorUserId: number | null
  criadoPorNome: string | null
  disparadoPorNome: string | null
  /** conta de envio usada; o nome e snapshot e sobrevive a exclusao da conta */
  contaId: number | null
  contaNome: string | null
  /** "Respostas para" escolhido no envio; nulo = o do proprio canal */
  responderPara: string | null
  arquivadoEm: string | null
  arquivadoPorNome: string | null
  /** lixeira (exclusao logica): so o admin ve estes lotes */
  excluidoEm: string | null
  excluidoPorNome: string | null
  excluidoMotivo: string | null
  /** lembrete automatico: a cada N dias ate `lembreteMax` vezes; nulo = desligado */
  lembreteDias?: number | null
  lembreteMax?: number
  criarTickets: boolean
  modoAnexo: 'nenhum' | 'unico' | 'individual'
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
  /** reenvio aguardando na fila do lote */
  reenvioPendente: { motivo: string; porNome: string | null; statusAnterior: string } | null
  /** CPF/CNPJ (só dígitos) e o arquivo individual desta pessoa */
  documento: string | null
  arquivoPath: string | null
  arquivoNome: string | null
  /** o que voltou pela caixa do canal */
  bounceAt: string | null
  bounceTipo: 'definitiva' | 'temporaria' | null
  bounceMotivo: string | null
  respondeuAt: string | null
  respostaCount: number
  reciboAt: string | null
  createdAt: string
  /** e-mails que ja sairam para a pessoa (original + reenvios); so na lista do lote */
  envios?: number
}

/** Um e-mail que saiu para o destinatario: o original (no 1) ou um reenvio. */
export interface EnvioMail {
  id: number
  recipientId: number
  numero: number
  origem: 'lote' | 'reenvio' | 'lembrete'
  para: string
  messageId: string | null
  contaId: number | null
  contaNome: string | null
  responderPara: string | null
  status: 'enviado' | 'erro'
  erro: string | null
  /** o que o servidor SMTP respondeu ao aceitar a mensagem */
  respostaSmtp: string | null
  motivo: string | null
  enviadoPorUserId: number | null
  enviadoPorNome: string | null
  enviadoEm: string
}

/** Domínio de destinatário com problema (não recebe e-mail ou parece digitado errado). */
export interface ProblemaDominio {
  dominio: string
  /** false = não recebe e-mail; null = não deu para verificar */
  recebe: boolean | null
  sugestao: string | null
  emails: string[]
}

/** Linha do log permanente do lote. */
export interface LinhaLogLote {
  id: number
  tipo: 'enviado' | 'reenvio' | 'erro'
  meta: Record<string, any> | null
  at: string
  recipientId: number
  email: string
  codigo: string
}

export interface ResultadoReenvio {
  ok: boolean
  numero: number
  para: string
  canal: string
  resposta?: string
  erro?: string
  emailAnterior: string | null
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
  /** receberam e ainda nao confirmaram (alvo do "reenviar para quem nao confirmou") */
  naoConfirmaram: number
  reenviosNaFila: number
  /** pessoas com ao menos um reenvio */
  reenviados: number
  /** lidos da caixa do canal pelo monitor */
  devolucoes: number
  respostas: number
  recibos: number
  /** lembretes automaticos ja enviados no lote (soma) */
  lembretes?: number
}

/** Chamado no painel aberto a partir de um lote. */
export interface ChamadoPainel {
  motivo: 'resposta' | 'sem_confirmacao'
  ticketCode: string | null
  statusEnvio: 'pendente' | 'criado' | 'comentado' | 'erro'
  erro: string | null
  recipientId: number | null
  criadoEm: string
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
  loteDisparadoPor: string | null
  ultimoIp: string | null
}

/* ---------- respostas dos endpoints ---------- */

export interface RespostaTemplates {
  templates: Template[]
  /** categorias já usadas, para filtro e sugestão */
  categorias: string[]
}

export interface RespostaLotes {
  lotes: Lote[]
  total: number
  pagina: number
  porPagina: number
  /** quantos lotes existem em cada status, ignorando os filtros da tela */
  contagemPorStatus: Record<string, number>
  /** arquivados escondidos pelo filtro padrao */
  arquivados: number
}

export interface LoteLixeira {
  id: number
  nome: string
  assunto: string
  total: number
  enviados: number
  criadoPorNome: string | null
  disparadoPorNome: string | null
  startedAt: string | null
  excluidoEm: string
  excluidoPorNome: string | null
  excluidoMotivo: string | null
}

/** Lista enxuta para combos — nao e paginada. */
export interface RespostaLotesOpcoes {
  lotes: { id: number; nome: string; status: StatusLote }[]
}
export interface RespostaLote {
  lote: Lote
  contagem: ContagemLote
  chamados: ChamadoPainel[]
  /** canal de saida do lote (nulo = o do .env, ou canal excluido) */
  canal: { nome: string; remetente: string; responderPara: string | null; ativa: boolean } | null
}
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
  envios: EnvioMail[]
  loteStatus: StatusLote
  loteStartedAt: string | null
  loteExcluidoEm: string | null
  loteContaId: number | null
  loteContaNome: string | null
  loteResponderPara: string | null
}
export interface RespostaArquivos {
  arquivos: { nome: string; tamanho: number; modificadoEm: string }[]
}
export interface RespostaStatus {
  smtp: {
    ok: boolean
    mensagem: string
    host: string
    port: number
    from: string
    habilitado: boolean
    /** conta que seria usada agora; id nulo = a herdada do .env */
    conta: { id: number | null; nome: string } | null
    chaveConfigurada: boolean
  }
  urlAcesso: { valor: string; aviso: string | null; alcance: string | null }
  lotesAtivos: number[]
  painel: {
    tabelaOk: boolean
    cookie: 'reconhecido' | 'nao-reconhecido' | 'ausente'
    nomeCookie: string
    usuario: string | null
    aviso: string | null
  }
  migrations: {
    ok: boolean
    aplicadas: string[]
    pendentesAntes: number
    erro?: string
    em: string
  } | null
  /** canais com o monitor da caixa ligado */
  caixa: { conta: string; ultimaLeituraEm: string | null; erro: string | null; erroEm: string | null }[]
  /** fila de chamados no painel */
  chamados: { pendentes: number; erros: number } | undefined
  /** ClamAV das solicitacoes de documentos */
  antivirus: { configurado: boolean; ok: boolean; mensagem: string; quarentena: number }
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
  sugestao: { email: string; nome: string; empresa: string; documento: string }
  previa: Record<string, string>[]
  linhas: Record<string, string>[]
}

export interface Contato {
  email: string
  nome: string | null
  empresa: string | null
  documento: string | null
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

/** De onde veio a credencial do operador. */
export type OrigemSessao = 'painel' | 'senha' | 'painel-invalido' | 'nenhuma'

/** Papel do operador: limita as ACOES, nao o acesso (todo usuario ativo entra). */
export type PapelOperador = 'usuario' | 'supervisor' | 'admin'

export interface RespostaDepartamentos {
  /** o que a pessoa pode escolher: todos para o admin, só o próprio para os demais */
  departamentos: { id: number; nome: string }[]
  meu: number | null
}

export interface RespostaSessao {
  autenticado: boolean
  origem: OrigemSessao
  /** o acesso de emergencia por senha local esta ligado? */
  senhaLocal: boolean
  /** `id` nulo = acesso pela senha local, que nao identifica a pessoa */
  usuario: { id: number | null; nome: string; email: string | null; papel: PapelOperador } | null
}

/** Uma linha da trilha de auditoria. */
export interface RegistroAuditoria {
  id: number
  quando: string
  userId: number | null
  userNome: string | null
  papel: PapelOperador | null
  acao: string
  entidade: string | null
  entidadeId: string | null
  resumo: string
  dados: Record<string, unknown> | null
  ip: string | null
  userAgent: string | null
}

export interface RespostaAuditoria {
  registros: RegistroAuditoria[]
  total: number
  pagina: number
  porPagina: number
  /** acoes distintas ja registradas, para o filtro */
  acoes: string[]
}

export interface ItemConfig {
  chave: string
  valor: unknown
  atualizadoPorNome: string | null
  atualizadoEm: string | null
}

/* -------------------------------------------------------------------------
 * Solicitacao de documentos
 * ---------------------------------------------------------------------- */

/** aberta = esperando o cliente; "atrasada" e aberta com prazo vencido (calculado na tela). */
export type StatusSolicitacao = 'aberta' | 'em_analise' | 'concluida' | 'cancelada'
export type StatusItemSolicitacao = 'pendente' | 'enviado' | 'aprovado' | 'recusado' | 'nao_possui'
export type StatusAntivirus = 'pendente' | 'limpo' | 'infectado' | 'sem_antivirus' | 'erro'

/** documento = envio de arquivo; os demais o cliente responde na pagina (shared/utils/itens-solic.ts) */
export type TipoItemSolic =
  | 'documento'
  | 'texto_curto'
  | 'texto_longo'
  | 'escolha'
  | 'email'
  | 'telefone'
  | 'cpf_cnpj'
  | 'data'
  | 'numero'
  | 'moeda'
  | 'declaracao'
  | 'informativo'

/** Configuracao por tipo. So os campos do tipo sao gravados (normalizarConfig). */
export interface ConfigItem {
  /** false = a resposta e aprovada sozinha, sem conferencia da equipe */
  conferir?: boolean
  /** texto */
  maxLen?: number
  placeholder?: string
  /** escolha */
  opcoes?: string[]
  multipla?: boolean
  outro?: boolean
  minEscolhas?: number
  maxEscolhas?: number
  /** numero/moeda: numero; data: 'AAAA-MM-DD' */
  min?: number | string
  max?: number | string
  casas?: number
  naoFutura?: boolean
  /** cpf_cnpj */
  aceita?: 'cpf' | 'cnpj' | 'ambos'
  /** declaracao e informativo */
  texto?: string
  /** informativo: como o texto aparece (padrao justificado, como nos comunicados) */
  alinhamento?: 'justificado' | 'esquerda' | 'centro'
  /** informativo: caixa colorida; ausente = texto corrido */
  cor?: 'neutro' | 'atencao' | 'alerta'
}

/** Resposta do cliente a um item que nao e documento (jsonb). */
export interface RespostaItem {
  v: 1
  /** texto; numero (moeda em centavos); data ISO; escolha: string ou string[]; declaracao: true */
  valor: string | number | string[] | boolean
  /** texto do "Outro" na escolha */
  outro?: string
  /** pronto para mostrar ("R$ 1.234,56", "02/10/2026") */
  exibicao: string
  /** declaracao: sha-256 do texto aceito, para provar o que foi lido */
  declaracaoSha256?: string
}

export interface ItemModeloChecklist {
  tipo: TipoItemSolic
  config: ConfigItem
  titulo: string
  instrucao: string | null
  obrigatorio: boolean
  /** familias aceitas (FAMILIAS_SOLICITACAO); vazio = qualquer formato */
  tipos: string[]
  maxArquivos: number
  modeloPath: string | null
  modeloNome: string | null
}

export interface ModeloChecklist {
  id: number
  nome: string
  descricao: string | null
  /** nome do setor; null = todos os setores */
  setor: string | null
  departamentoId: number | null
  ativo: boolean
  criadoPorNome: string | null
  atualizadoPorNome: string | null
  updatedAt: string
  itens: ItemModeloChecklist[]
  /** solicitacoes que ja usaram este modelo */
  usos: number
}

export interface ArquivoSolicitacao {
  id: number
  nome: string
  tamanho: number
  enviadoEm: string
  antivirus: StatusAntivirus
  antivirusMsg: string | null
  sha256: string
  removidoEm: string | null
}

export interface ItemSolicitacao {
  id: number
  ordem: number
  tipo: TipoItemSolic
  config: ConfigItem
  resposta: RespostaItem | null
  respondidoEm: string | null
  respostaIp: string | null
  titulo: string
  instrucao: string | null
  obrigatorio: boolean
  tipos: string[]
  maxArquivos: number
  modeloNome: string | null
  status: StatusItemSolicitacao
  /** motivo da recusa (Gaulke) ou justificativa do "nao possuo" (cliente) */
  motivo: string | null
  analisadoPorNome: string | null
  analisadoEm: string | null
  recusaAvisadaEm: string | null
  arquivos: ArquivoSolicitacao[]
}

export interface ResumoSolicitacao {
  id: number
  codigo: string
  titulo: string
  destinatarioNome: string | null
  destinatarioEmail: string
  empresa: string | null
  documento: string | null
  status: StatusSolicitacao
  prazo: string | null
  grupo: string | null
  criadoPorNome: string | null
  createdAt: string
  enviadoEm: string | null
  envioErro: string | null
  primeiroAcessoEm: string | null
  ultimaEntregaEm: string | null
  concluidaEm: string | null
  totalItens: number
  obrigatorios: number
  /** obrigatorios que o cliente ja entregou (enviado, aprovado ou "nao possuo") */
  obrigatoriosEntregues: number
  aprovados: number
  paraAnalisar: number
  recusados: number
}

export interface EventoSolicitacao {
  id: number
  itemId: number | null
  tipo: string
  descricao: string
  porNome: string | null
  ip: string | null
  criadoEm: string
}

export interface DetalheSolicitacao extends ResumoSolicitacao {
  criadoPorUserId: number | null
  mensagem: string | null
  contaId: number | null
  contaNome: string | null
  responderPara: string | null
  lembretes: boolean
  lembretesEnviados: number
  ultimoLembreteEm: string | null
  avisarConclusao: boolean
  link: string
  pasta: string | null
  concluidaPorNome: string | null
  canceladaEm: string | null
  canceladaPorNome: string | null
  canceladaMotivo: string | null
  /** recusas que o cliente ainda nao recebeu por e-mail */
  recusasNaoAvisadas: number
  itens: ItemSolicitacao[]
  eventos: EventoSolicitacao[]
}

/** O que a pagina publica /r/:token recebe. Nada interno (pasta, hash, IP). */
export interface LandingSolicitacao {
  titulo: string
  mensagem: string | null
  nome: string | null
  empresa: string | null
  codigo: string
  prazo: string | null
  status: StatusSolicitacao
  itens: {
    id: number
    tipo: TipoItemSolic
    config: ConfigItem
    resposta: RespostaItem | null
    respondidoEm: string | null
    titulo: string
    instrucao: string | null
    obrigatorio: boolean
    tipos: string[]
    maxArquivos: number
    modeloNome: string | null
    status: StatusItemSolicitacao
    motivo: string | null
    /** a equipe ja analisou (aprovou ou aceitou o "nao possuo"): o cliente nao desfaz mais */
    analisado: boolean
    arquivos: { id: number; nome: string; tamanho: number; enviadoEm: string; antivirus: StatusAntivirus }[]
  }[]
}

/**
 * Um destinatario escolhido na tela (SeletorDestinatarios): lote e
 * solicitacao montam a lista do mesmo jeito. A chave do carrinho e o e-mail
 * em minusculas.
 */
/** De onde o SeletorDestinatarios pode trazer gente. */
export type OrigemDestinatario = 'empresa' | 'arquivo' | 'lista' | 'banco' | 'manual' | 'sistema'

export interface ItemDestinatario {
  email: string
  nome: string
  empresa: string
  /** CPF/CNPJ so com digitos (ou vazio) */
  documento: string
  /** de onde veio: "arquivo", "empresa", "lista: Clientes"... */
  origem: string
  /** colunas a mais da planilha, usadas como variaveis no e-mail do lote */
  extras: Record<string, string>
}

/** E-mail conhecido de uma empresa (sys_mail_empresa_contatos), aprendido com os envios. */
export interface ContatoEmpresa {
  id: number
  email: string
  nome: string | null
  usos: number
  ultimoUso: string
  /** devolveu definitivamente: nao adianta mandar */
  suprimido: boolean
}

/** Resultado da busca de clientes (company, client e o historico de envios). */
export interface EmpresaEncontrada {
  nome: string
  fantasia: string | null
  documento: string | null
  tipo: 'empresa' | 'pessoa'
  ativo: boolean
  /** de onde veio: o cadastro da Gaulke ou so o historico de envios */
  origem: 'cadastro' | 'historico'
  /** e-mails que ja receberam por este documento, o mais recente primeiro */
  emails: ContatoEmpresa[]
}

/* -------------------------------------------------------------------------
 * Assinatura digital
 * ---------------------------------------------------------------------- */

/** O que a tela mostra de um certificado A1. A chave privada nunca sai do servidor. */
export interface ResumoCertificado {
  id: number | null
  nome: string | null
  titular: string
  documento: string | null
  documentoTipo: 'CNPJ' | 'CPF' | string | null
  responsavel: string | null
  emissor: string | null
  serial: string | null
  fingerprintSha256: string
  validoDe: string
  validoAte: string
  diasParaVencer: number
  /** a cadeia chega a uma AC ICP-Brasil */
  icpBrasil: boolean
  cadeia: { assunto: string; emissor: string }[]
}

export interface CertificadoCadastrado extends ResumoCertificado {
  id: number
  nome: string
  padrao: boolean
  nomeArquivo: string | null
  criadoPorNome: string | null
  criadoEm: string
  ultimoTesteEm: string | null
  ultimoTesteOk: boolean | null
  ultimoTesteMsg: string | null
}

export type StatusAssinatura = 'rascunho' | 'aguardando' | 'concluido' | 'recusado' | 'cancelado'
export type StatusSignatario = 'pendente' | 'aguardando' | 'assinado' | 'recusado'
export type TipoCampoAssinatura = 'assinatura' | 'rubrica' | 'data' | 'nome'

/** Campo no PDF, em pontos do PDF (origem no canto INFERIOR esquerdo). */
export interface CampoAssinatura {
  id?: number
  /** na criacao: indice do signatario na lista; lido do banco: o id dele */
  signatario: number
  tipo: TipoCampoAssinatura
  pagina: number
  x: number
  y: number
  largura: number
  altura: number
}

export interface SignatarioAssinatura {
  id: number
  ordem: number
  nome: string
  email: string
  cpf: string | null
  papel: string | null
  status: StatusSignatario
  conviteEnviadoEm: string | null
  envioErro: string | null
  visualizadoEm: string | null
  assinadoEm: string | null
  recusadoEm: string | null
  recusaMotivo: string | null
  ip: string | null
  tipoAssinatura: 'digitada' | 'desenhada' | null
  lembretesEnviados: number
}

export interface ResumoAssinatura {
  id: number
  codigo: string
  titulo: string
  status: StatusAssinatura
  ordem: 'paralela' | 'sequencial'
  assinarComoGaulke: boolean
  prazo: string | null
  clienteNome: string | null
  criadoPorNome: string | null
  createdAt: string
  enviadoEm: string | null
  concluidoEm: string | null
  total: number
  assinados: number
  /** quem esta com a vez agora */
  aguardando: string[]
  finalizacaoErro: string | null
}

export interface DetalheAssinatura extends ResumoAssinatura {
  mensagem: string | null
  criadoPorUserId: number | null
  clienteDocumento: string | null
  originalNome: string | null
  originalSha256: string | null
  originalPaginas: number | null
  finalSha256: string | null
  codigoVerificacao: string
  linkValidacao: string
  contaNome: string | null
  responderPara: string | null
  certificado: { nome: string; titular: string; validoAte: string } | null
  canceladoEm: string | null
  canceladoPorNome: string | null
  canceladoMotivo: string | null
  pasta: string | null
  signatarios: SignatarioAssinatura[]
  campos: Required<CampoAssinatura>[]
  eventos: { id: number; tipo: string; descricao: string; porNome: string | null; ip: string | null; criadoEm: string; hash: string }[]
  /** o historico encadeado confere? */
  corrente: { ok: boolean; eventos: number; quebraNoEvento: number | null }
}

/** O que a pagina publica /a/:token recebe. */
export interface LandingAssinatura {
  titulo: string
  mensagem: string | null
  codigo: string
  status: StatusAssinatura
  prazo: string | null
  remetente: string | null
  paginas: number
  eu: {
    nome: string
    email: string
    status: StatusSignatario
    assinadoEm: string | null
    codigoEnviadoEm: string | null
  }
  signatarios: { nome: string; status: StatusSignatario; assinadoEm: string | null; eu: boolean }[]
  /** os MEUS campos, para destacar no PDF */
  campos: Omit<CampoAssinatura, 'signatario' | 'id'>[]
  temFinal: boolean
}

export interface ValidacaoAssinatura {
  codigo: string
  titulo: string
  status: StatusAssinatura
  enviadoEm: string | null
  concluidoEm: string | null
  paginas: number | null
  originalSha256: string | null
  finalSha256: string | null
  /** o que bateu: o codigo digitado, o PDF final ou o PDF original */
  conferido: 'codigo' | 'pdf_final' | 'pdf_original'
  selado: boolean
  signatarios: { nome: string; email: string; status: StatusSignatario; assinadoEm: string | null }[]
}

/* -------------------------------------------------------------------------
 * Fase 8: retencao, listas, lembretes, linha do tempo do cliente, webhooks
 * ---------------------------------------------------------------------- */

/** Politica de retencao (decisao D10), editada pelo admin. */
export interface ConfigRetencao {
  ativa: boolean
  /** comunicados (lotes) e documentos para assinar que nao foram concluidos */
  comunicadosMeses: number
  solicitacoesMeses: number
  /** documentos assinados por todos */
  assinadosAnos: number
  /** lote na lixeira e apagado de vez depois destes dias */
  lixeiraDias: number
}

/** O que uma execucao da retencao apagou (ou apagaria, na previa). */
export interface ResumoRetencao {
  em: string
  simulacao: boolean
  automatica: boolean
  porNome: string | null
  lotes: number
  lixeira: number
  destinatarios: number
  solicitacoes: number
  assinaturas: number
  arquivos: number
  caixa: number
  auditoriaAnonimizada: number
  webhookEntregas: number
  /** amostra do que sai, para a previa na tela */
  exemplos: { tipo: 'lote' | 'lixeira' | 'solicitacao' | 'assinatura'; id: number; nome: string; quando: string }[]
  erros: string[]
}

export interface RespostaRetencao {
  config: ConfigRetencao
  ultima: ResumoRetencao | null
}

export interface ResumoLista {
  id: number
  nome: string
  descricao: string | null
  total: number
  criadoPorNome: string | null
  atualizadoPorNome: string | null
  atualizadoEm: string
}

export interface MembroLista {
  id: number
  email: string
  nome: string | null
  empresa: string | null
  documento: string | null
  extras: Record<string, string> | null
  adicionadoEm: string
  /** devolveu definitivamente: fica de fora dos envios */
  suprimido: string | null
}

export interface DetalheLista extends ResumoLista {
  membros: MembroLista[]
}

/** Pessoa ou empresa encontrada na busca da linha do tempo. */
export interface ClienteEncontrado {
  email: string
  nome: string | null
  empresa: string | null
  documento: string | null
  comunicados: number
  solicitacoes: number
  assinaturas: number
  ultimoEm: string | null
}

export type ModuloLinha = 'comunicado' | 'solicitacao' | 'assinatura' | 'caixa'

export interface ItemLinhaCliente {
  modulo: ModuloLinha
  id: number
  quando: string
  titulo: string
  /** rotulo do estado ("Confirmou", "Concluída", "Aguardando assinatura") */
  status: string
  cor: 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'primary'
  email: string
  detalhes: string[]
  link: string | null
  por: string | null
}

export interface LinhaDoTempoCliente {
  emails: string[]
  documentos: string[]
  nome: string | null
  empresa: string | null
  itens: ItemLinhaCliente[]
  totais: Record<ModuloLinha, number>
}

export interface WebhookCadastrado {
  id: number
  nome: string
  url: string
  eventos: string[]
  ativo: boolean
  ultimaEntregaEm: string | null
  ultimoStatus: number | null
  ultimoErro: string | null
  pendentes: number
  falhas: number
  criadoPorNome: string | null
  atualizadoPorNome: string | null
}

export interface EntregaWebhook {
  id: number
  evento: string
  status: 'pendente' | 'entregue' | 'erro'
  tentativas: number
  ultimoStatusHttp: number | null
  ultimoErro: string | null
  criadoEm: string
  entregueEm: string | null
  proximaTentativaEm: string
}
