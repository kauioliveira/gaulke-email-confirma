import type { ParsedMail, Attachment } from 'mailparser'

/**
 * Classifica uma mensagem lida da caixa do canal.
 *
 * Funcao PURA (sem banco, sem rede): recebe a mensagem ja interpretada pelo
 * mailparser e devolve o que ela e e as pistas para liga-la ao envio. E
 * testavel com mensagens de exemplo, e e aqui que moram as regras.
 *
 * Ordem das regras, da mais confiavel para a menos:
 *  1. relatorio de entrega (DSN, RFC 3464): multipart/report com
 *     report-type=delivery-status. "Status: 5.x.x" e devolucao DEFINITIVA
 *     (endereco/dominio nao existe); "4.x.x" e TEMPORARIA (caixa cheia,
 *     servidor fora);
 *  2. recibo de leitura (MDN, RFC 8098): report-type=disposition-notification;
 *  3. devolucao fora do padrao: servidores antigos mandam texto puro de
 *     MAILER-DAEMON/postmaster — reconhecida pelo remetente + assunto. E o
 *     caso do servidor da empresa (S4/qmail), que escreve em portugues:
 *     "Falha na entrega do e-mail (failure notice)", "Este e um erro
 *     permanente", e o cabecalho original colado no corpo depois de
 *     "--- Abaixo desta linha segue o cabecalho da mensagem.";
 *     "Aviso de entrega adiada (delayed delivery notice)" e TEMPORARIA;
 *     qualquer outra coisa vinda de MAILER-DAEMON/postmaster e aviso do
 *     servidor (quarentena, relatorio), e nao resposta de cliente;
 *  4. resposta automatica (ferias, ausencia): Auto-Submitted, X-Autoreply,
 *     Precedence auto_reply/bulk/junk, ou assunto tipico;
 *  5. o resto: resposta de uma pessoa.
 */

export type ClassificacaoMensagem =
  | 'devolucao_definitiva'
  | 'devolucao_temporaria'
  | 'recibo'
  | 'auto_resposta'
  /** aviso do proprio servidor de e-mail (quarentena, relatorio) — nao e resposta de ninguem */
  | 'aviso_servidor'
  | 'resposta'

export type Pistas = {
  /** Message-IDs que podem ser o nosso envio (In-Reply-To, References, original do DSN/MDN) */
  messageIds: string[]
  /** codigos GLK-XXXX-XXXX encontrados (cabecalho X-Gaulke-Codigo ou corpo) */
  codigos: string[]
  /** tokens de /c/<uuid> citados no corpo */
  tokens: string[]
  /** destinatario que falhou, segundo o DSN */
  destinatarioFalho: string | null
}

export type ResultadoClassificacao = {
  classificacao: ClassificacaoMensagem
  /** status SMTP do DSN (5.1.1) e diagnostico legivel */
  status: string | null
  diagnostico: string | null
  pistas: Pistas
  /** trecho do que a pessoa escreveu (so faz sentido em resposta) */
  trecho: string | null
}

const RE_CODIGO = /\bGLK-[A-Z0-9]{4}-[A-Z0-9]{4}\b/g
const RE_TOKEN = /\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi
const RE_MESSAGE_ID = /<[^<>\s]+@[^<>\s]+>/g
const RE_STATUS = /\b([245])\.(\d{1,3})\.(\d{1,3})\b/

function header(m: ParsedMail, nome: string): string {
  const v = m.headers.get(nome.toLowerCase())
  if (v === undefined || v === null) return ''
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.join(' ')
  if (typeof v === 'object' && 'value' in (v as object)) {
    const o = v as { value: unknown; params?: Record<string, string> }
    return `${o.value}${o.params ? ` ${Object.entries(o.params).map(([k, p]) => `${k}=${p}`).join(' ')}` : ''}`
  }
  if (typeof v === 'object' && 'text' in (v as object)) return String((v as { text: unknown }).text)
  return String(v)
}

function reportType(m: ParsedMail): string | null {
  const ct = m.headers.get('content-type') as { value?: string; params?: Record<string, string> } | undefined
  if (ct?.value?.toLowerCase() === 'multipart/report') return (ct.params?.['report-type'] ?? '').toLowerCase()
  return null
}

function textoDoAnexo(a: Attachment) {
  return Buffer.isBuffer(a.content) ? a.content.toString('utf8') : String(a.content ?? '')
}

/** "Campo: valor" de um bloco de cabecalhos (DSN, MDN, mensagem original). */
function campo(texto: string, nome: string): string | null {
  const m = new RegExp(`^${nome}:\\s*(.+(?:\\r?\\n[ \\t].+)*)`, 'im').exec(texto)
  return m ? m[1]!.replace(/\r?\n[ \t]+/g, ' ').trim() : null
}

function unicos<T>(xs: T[]) {
  return [...new Set(xs.filter(Boolean))]
}

/** Corta a citacao da mensagem original: fica so o que a pessoa escreveu. */
export function semCitacao(texto: string) {
  const linhas = texto.replace(/\r\n/g, '\n').split('\n')
  const saida: string[] = []
  for (const l of linhas) {
    // "Em seg., 29 de set. ... escreveu:" / "On ... wrote:" / cabecalho do Outlook
    if (/^\s*(em .+ escreveu:|on .+ wrote:|-{2,}\s*(mensagem original|original message)|de:\s.+@|from:\s.+@|_{5,})/i.test(l)) break
    if (/^\s*>/.test(l)) continue
    saida.push(l)
  }
  return saida.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function classificar(m: ParsedMail): ResultadoClassificacao {
  const tipoRelatorio = reportType(m)
  const anexos = m.attachments ?? []
  const assunto = m.subject ?? ''
  const de = (m.from?.value?.[0]?.address ?? '').toLowerCase()
  const corpo = `${m.text ?? ''}\n${typeof m.html === 'string' ? m.html : ''}`

  // o "original" que veio junto num DSN/MDN (mensagem inteira ou so cabecalhos)
  const partesOriginais = anexos
    .filter(a => /^(message\/rfc822|text\/rfc822-headers|message\/rfc822-headers)$/i.test(a.contentType))
    .map(textoDoAnexo)
  const original = partesOriginais.join('\n')

  const pistas: Pistas = {
    messageIds: unicos([
      ...(m.inReplyTo ? m.inReplyTo.match(RE_MESSAGE_ID) ?? [] : []),
      ...(Array.isArray(m.references) ? m.references : m.references ? [m.references] : []),
      ...(campo(original, 'Message-ID')?.match(RE_MESSAGE_ID) ?? [])
    ]),
    codigos: unicos([
      ...(campo(original, 'X-Gaulke-Codigo')?.match(RE_CODIGO) ?? []),
      // o assunto da resposta costuma manter o codigo ("Re: ... — GLK-...")
      ...(assunto.match(RE_CODIGO) ?? []),
      ...(corpo.match(RE_CODIGO) ?? []),
      ...(original.match(RE_CODIGO) ?? [])
    ]),
    tokens: unicos([...`${corpo}\n${original}`.matchAll(RE_TOKEN)].map(x => x[1]!.toLowerCase())),
    destinatarioFalho: null
  }

  // 1. DSN padrao
  const dsn = anexos.find(a => /^message\/(global-)?delivery-status$/i.test(a.contentType))
  if (tipoRelatorio === 'delivery-status' || dsn) {
    const texto = dsn ? textoDoAnexo(dsn) : corpo
    const status = campo(texto, 'Status')?.match(RE_STATUS)?.[0] ?? null
    const acao = (campo(texto, 'Action') ?? '').toLowerCase()
    const destinatario = (campo(texto, 'Final-Recipient') ?? campo(texto, 'Original-Recipient') ?? '')
      .replace(/^rfc822;\s*/i, '')
      .trim()
      .toLowerCase()
    pistas.destinatarioFalho = destinatario || null
    // "delayed"/"relayed"/"delivered" nao e devolucao: so aviso de atraso
    const temporaria = status?.startsWith('4') || acao === 'delayed'
    // entregue/relayed: relatorio de sucesso, que alguns servidores mandam
    if (acao === 'delivered' || acao === 'relayed' || acao === 'expanded') {
      return { classificacao: 'auto_resposta', status, diagnostico: campo(texto, 'Diagnostic-Code'), pistas, trecho: null }
    }
    return {
      classificacao: temporaria ? 'devolucao_temporaria' : 'devolucao_definitiva',
      status,
      diagnostico: campo(texto, 'Diagnostic-Code') ?? acao ?? null,
      pistas,
      trecho: null
    }
  }

  // 2. MDN (recibo de leitura)
  const mdn = anexos.find(a => /^message\/(global-)?disposition-notification$/i.test(a.contentType))
  if (tipoRelatorio === 'disposition-notification' || mdn) {
    const texto = mdn ? textoDoAnexo(mdn) : corpo
    pistas.messageIds = unicos([...pistas.messageIds, ...(campo(texto, 'Original-Message-ID')?.match(RE_MESSAGE_ID) ?? [])])
    return { classificacao: 'recibo', status: null, diagnostico: campo(texto, 'Disposition'), pistas, trecho: null }
  }

  // 3. devolucao fora do padrao (texto puro do servidor de e-mail)
  const deServidor = /^(mailer-daemon|postmaster|mail-daemon|mailerdaemon)@/i.test(de) || /mailer-daemon/i.test(de)
  const assuntoDeDevolucao =
    /(undeliver|delivery status notification|delivery failure|returned mail|failure notice|mail delivery (failed|system)|não (foi possível )?entregue|nao entregue|falha na entrega|mensagem não entregue)/i
  const assuntoDeAtraso = /(delayed delivery|delivery delayed|entrega adiada|atraso na entrega|warning: message .* delayed)/i
  if (deServidor && (assuntoDeDevolucao.test(assunto) || assuntoDeAtraso.test(assunto))) {
    const texto = m.text ?? ''
    // o cabecalho original colado no corpo (qmail/S4 e afins) tambem liga ao envio
    const inicioOriginal = texto.search(/-{2,}\s*(?:abaixo desta linha|below this line)/i)
    const originalNoCorpo = inicioOriginal >= 0 ? texto.slice(inicioOriginal) : ''
    pistas.messageIds = unicos([...pistas.messageIds, ...(campo(originalNoCorpo, 'Message-ID')?.match(RE_MESSAGE_ID) ?? [])])
    pistas.codigos = unicos([...pistas.codigos, ...(campo(originalNoCorpo, 'X-Gaulke-Codigo')?.match(RE_CODIGO) ?? [])])

    // "<fulano@x.com.br>:" seguido do motivo, ate o cabecalho original
    const bloco = /^<([^<>\s]+@[^<>\s]+)>:\s*\n([\s\S]*?)(?:\n\s*-{2,}|\n\s*\n\s*\n|(?![\s\S]))/m.exec(texto)
    const destinatario =
      bloco?.[1] ?? texto.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g)?.find(e => !/mailer-daemon|postmaster/i.test(e)) ?? null
    pistas.destinatarioFalho = destinatario?.toLowerCase() ?? null
    const motivoBruto = (bloco?.[2] ?? texto).replace(/\s+/g, ' ').trim()
    // o que o servidor do destinatario disse vale mais que o nosso texto padrao
    const remoto = /(?:remote host said|resposta do servidor remoto)[^:]*:\s*(.+)/i.exec(motivoBruto)?.[1]
    const diagnostico = (remoto ?? motivoBruto).replace(/\s*giving up on .*$/i, '').slice(0, 300) || null

    const status = texto.match(RE_STATUS)?.[0] ?? null
    const codigoSmtp = texto.match(/\b([45])\d\d[ -]/)?.[1] ?? null
    const temporaria =
      assuntoDeAtraso.test(assunto) ||
      /erro tempor[aá]rio|temporary (error|failure)|will (keep|continue) trying|continuar[aá] tentando/i.test(texto) ||
      (!/erro permanente|permanent (error|failure)/i.test(texto) && (status ? status.startsWith('4') : codigoSmtp === '4'))
    return {
      classificacao: temporaria ? 'devolucao_temporaria' : 'devolucao_definitiva',
      status,
      diagnostico,
      pistas,
      trecho: null
    }
  }
  // qualquer outra coisa do proprio servidor (quarentena, relatorio): nao e cliente
  if (deServidor || /^postmaster@/i.test(de)) {
    return { classificacao: 'aviso_servidor', status: null, diagnostico: null, pistas, trecho: null }
  }

  // 4. resposta automatica
  const autoSubmitted = header(m, 'auto-submitted').toLowerCase()
  const precedence = header(m, 'precedence').toLowerCase()
  const automatica =
    (autoSubmitted && autoSubmitted !== 'no') ||
    !!header(m, 'x-autoreply') ||
    !!header(m, 'x-autorespond') ||
    !!header(m, 'x-auto-response-suppress') && /^(auto|automatic)/i.test(assunto) ||
    /^(auto_reply|bulk|junk)$/.test(precedence) ||
    /^(auto(matic)?[\s:-]*(reply|resposta)|resposta autom[aá]tica|out of (the )?office|fora do escrit[oó]rio|ausente|aus[eê]ncia|f[eé]rias)/i.test(assunto)
  if (automatica) {
    return { classificacao: 'auto_resposta', status: null, diagnostico: null, pistas, trecho: semCitacao(m.text ?? '').slice(0, 500) || null }
  }

  // 5. resposta de uma pessoa
  return {
    classificacao: 'resposta',
    status: null,
    diagnostico: null,
    pistas,
    trecho: semCitacao(m.text ?? '').slice(0, 3000) || null
  }
}

// atual (SOL-26-X7K2P9) ou antigo (SOL-000123), como nas assinaturas
const RE_SOLIC = /\bSOL-(?:\d{2}-[A-Z0-9]{6}|\d{6})\b/g
// ASS-26-X7K2P9 (atual) ou ASS-000045 (documentos de antes da migration 0015)
const RE_ASSIN = /\bASS-(?:\d{2}-[A-Z0-9]{6}|\d{6})\b/g
const RE_UUID = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'
const RE_TOKEN_SOLIC = new RegExp(`/r/${RE_UUID}`, 'gi')
const RE_TOKEN_ASSIN = new RegExp(`/a/${RE_UUID}`, 'gi')

export type PistasModulos = {
  /** codigos SOL-000123 / ASS-000045 achados nos Message-IDs (pista forte) */
  solicPorId: string[]
  assinPorId: string[]
  /** codigos no assunto, no corpo ou no original de uma devolucao (pista fraca) */
  solicNoTexto: string[]
  assinNoTexto: string[]
  tokensSolic: string[]
  tokensAssin: string[]
}

/**
 * Pistas de que a mensagem responde (ou devolve) um e-mail de SOLICITACAO ou
 * de ASSINATURA. Os nossos Message-IDs levam o codigo (<SOL-000123.pedido.x@>,
 * <ASS-000045.convite.y@>) e os e-mails levam X-Gaulke-Solicitacao /
 * X-Gaulke-Assinatura; o link /r/<token> ou /a/<token> citado tambem serve.
 */
export function pistasDeModulos(m: ParsedMail, messageIds: string[]): PistasModulos {
  const original = (m.attachments ?? [])
    .filter(a => /^(message\/rfc822|text\/rfc822-headers|message\/rfc822-headers)$/i.test(a.contentType))
    .map(textoDoAnexo)
    .join('\n')
  const ids = messageIds.join(' ')
  const texto = [
    m.subject ?? '',
    m.text ?? '',
    typeof m.html === 'string' ? m.html : '',
    original,
    campo(original, 'X-Gaulke-Solicitacao') ?? '',
    campo(original, 'X-Gaulke-Assinatura') ?? ''
  ].join('\n')
  return {
    solicPorId: unicos(ids.match(RE_SOLIC) ?? []),
    assinPorId: unicos(ids.match(RE_ASSIN) ?? []),
    solicNoTexto: unicos(texto.match(RE_SOLIC) ?? []),
    assinNoTexto: unicos(texto.match(RE_ASSIN) ?? []),
    tokensSolic: unicos([...texto.matchAll(RE_TOKEN_SOLIC)].map(x => x[1]!.toLowerCase())),
    tokensAssin: unicos([...texto.matchAll(RE_TOKEN_ASSIN)].map(x => x[1]!.toLowerCase()))
  }
}
