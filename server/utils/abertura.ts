/**
 * Classificacao de aberturas de e-mail.
 *
 * O pixel dispara tanto quando uma pessoa abre a mensagem quanto quando uma
 * maquina baixa as imagens sozinha. Contar os dois juntos produz um numero
 * que parece bom e nao significa nada. Aqui separamos os dois casos com o
 * que ja temos gravado: user-agent, IP e o tempo desde o envio.
 */

export type ClasseAbertura = 'maquina' | 'provavel-pessoa'

export type Classificacao = {
  classe: ClasseAbertura
  motivo: string
}

/**
 * Proxies e scanners conhecidos. Todos baixam a imagem sem que ninguem
 * tenha lido a mensagem.
 */
const AGENTES_MAQUINA: { re: RegExp; nome: string }[] = [
  { re: /GoogleImageProxy/i, nome: 'proxy de imagens do Gmail' },
  { re: /YahooMailProxy/i, nome: 'proxy do Yahoo Mail' },
  { re: /Proofpoint|Mimecast|Barracuda|FireEye|Symantec|Forcepoint|TrendMicro/i, nome: 'antivirus corporativo' },
  { re: /BarracudaCentral|MessageLabs|SpamExperts/i, nome: 'filtro de spam' },
  { re: /curl|wget|python-requests|axios|node-fetch|Go-http-client|libwww|okhttp/i, nome: 'cliente automatizado' },
  { re: /bot|crawler|spider|scanner|preview|monitor/i, nome: 'robo' },
  { re: /Microsoft Office|MSOffice|SkypeUriPreview|BingPreview/i, nome: 'pre-visualizacao da Microsoft' }
]

/**
 * A Apple busca todas as imagens pelo Mail Privacy Protection assim que a
 * mensagem chega, mesmo que ninguem abra. As requisicoes saem do bloco
 * 17.0.0.0/8, que pertence inteiro a Apple.
 */
function ehApple(ip: string | null) {
  if (!ip) return false
  const primeiro = Number(ip.split('.')[0])
  return primeiro === 17
}

/**
 * Abertura quase instantanea nao e leitura: e o servidor de destino
 * baixando as imagens no momento da entrega.
 */
const SEGUNDOS_PRE_CARREGAMENTO = 30

export function classificarAbertura(opts: {
  userAgent: string | null
  ip: string | null
  sentAt: Date | string | null
  agora?: Date
}): Classificacao {
  const ua = opts.userAgent || ''

  for (const { re, nome } of AGENTES_MAQUINA) {
    if (re.test(ua)) return { classe: 'maquina', motivo: nome }
  }

  if (ehApple(opts.ip)) {
    return { classe: 'maquina', motivo: 'Apple Mail Privacy Protection' }
  }

  if (opts.sentAt) {
    const enviado = typeof opts.sentAt === 'string' ? new Date(opts.sentAt) : opts.sentAt
    const agora = opts.agora ?? new Date()
    const segundos = (agora.getTime() - enviado.getTime()) / 1000
    if (segundos >= 0 && segundos < SEGUNDOS_PRE_CARREGAMENTO) {
      return {
        classe: 'maquina',
        motivo: `pre-carregamento (${Math.round(segundos)}s apos o envio)`
      }
    }
  }

  if (!ua) return { classe: 'maquina', motivo: 'sem user-agent' }

  return { classe: 'provavel-pessoa', motivo: 'nao corresponde a nenhum proxy conhecido' }
}

export const ROTULO_CLASSE: Record<ClasseAbertura, string> = {
  maquina: 'Carregamento automático',
  'provavel-pessoa': 'Provável leitura'
}
