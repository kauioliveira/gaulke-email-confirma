import { createHash } from 'node:crypto'
import { asc, eq, sql } from 'drizzle-orm'
import { useDb, recipients, batches, events, envios } from '../db'
import { DocumentoPdf } from './pdf-documento'
import { renderizar } from './render'
import { linkAcesso } from './urls'
import { ROTULO_EVENTO_PDF } from './rotulos-pdf'
import type { Operador } from './permissoes'

/**
 * Dossie de comprovacao: o que a Gaulke apresenta quando o cliente diz "eu
 * nunca recebi". Tudo sai dos registros originais — o snapshot do e-mail que
 * foi enviado, cada envio numerado, e a trilha de eventos com data, hora
 * (Brasilia) e IP — que nao sao editaveis pela tela.
 *
 * Integridade: o SHA-256 do HTML exato enviado e o SHA-256 dos dados do
 * proprio dossie vao impressos. Quem precisar confirmar que um dossie nao foi
 * alterado gera outro e compara o codigo.
 */

function hash(v: string | Uint8Array) {
  return createHash('sha256').update(v).digest('hex')
}

/** HTML do e-mail em texto legivel, para caber no PDF. */
function htmlParaTexto(html: string) {
  return html
    .replace(/<(style|script|head|title)[\s\S]*?<\/\1>/gi, '')
    .replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, (_m, alt) => (alt ? `[imagem: ${alt}]` : ''))
    .replace(/<br\s*\/?>|<\/(p|tr|h\d|li|div)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*/g, '\n\n')
    .trim()
}

function quando(v: Date | string | null | undefined) {
  return v ? formatarDataHora(v) : '—'
}

export async function dossieDestinatario(id: number, op: Operador) {
  const db = useDb()
  const [linha] = await db
    .select({ d: recipients, l: batches })
    .from(recipients)
    .innerJoin(batches, eq(batches.id, recipients.batchId))
    .where(eq(recipients.id, id))
  // lote na lixeira: so o admin enxerga, como no resto do sistema
  if (!linha || (linha.l.excluidoEm && op.papel !== 'admin')) {
    throw createError({ statusCode: 404, statusMessage: 'Destinatário não encontrado' })
  }
  const { d, l } = linha

  const [historico, trilha] = await Promise.all([
    db.select().from(envios).where(eq(envios.recipientId, id)).orderBy(asc(envios.numero)),
    db.select().from(events).where(eq(events.recipientId, id)).orderBy(asc(events.createdAt), asc(events.id))
  ])

  // o e-mail como ESTA pessoa recebeu (variaveis preenchidas)
  const vars = { nome: d.nome, email: d.email, empresa: d.empresa, codigo: d.codigo, token: d.token, dadosExtras: d.dadosExtras as never }
  const htmlRecebido = renderizar(l.htmlSnapshot, vars)
  const hashHtml = hash(l.htmlSnapshot)
  const agora = new Date()

  // o que o dossie afirma, em forma canonica: e isso que o hash do dossie cobre
  const afirmacoes = JSON.stringify({
    destinatario: { id: d.id, email: d.email, codigo: d.codigo },
    lote: { id: l.id, nome: l.nome, assunto: l.assuntoSnapshot, hashHtml },
    envios: historico.map(e => [e.numero, e.para, e.enviadoEm, e.status, e.messageId]),
    eventos: trilha.map(e => [e.id, e.tipo, e.createdAt, e.ip])
  })
  const codigoDossie = hash(afirmacoes).slice(0, 16).toUpperCase()

  const doc = await DocumentoPdf.criar(
    'Dossiê de comprovação de envio',
    `Gerado em ${formatarDataHora(agora)} (Brasília) por ${op.nome} · verificação ${codigoDossie}`
  )

  doc.titulo1('Dossiê de comprovação de envio', `Registros do envio do código ${d.codigo} para ${d.email}, extraídos dos registros originais do sistema Gaulke Comunica. Horários de Brasília (America/Sao_Paulo).`)

  doc.secao('Destinatário')
  doc.campo('Nome', d.nome)
  doc.campo('E-mail', d.email)
  doc.campo('Empresa', d.empresa)
  doc.campo('CPF/CNPJ', d.documento)
  doc.campo('Código do envio', d.codigo)
  doc.campo('Link individual', linkAcesso(d.token))

  doc.secao('Envio')
  doc.campo('Lote', `${l.nome} (#${l.id})`)
  doc.campo('Assunto', l.assuntoSnapshot)
  doc.campo('Canal de saída', l.contaNome)
  doc.campo('Respostas para', l.responderPara)
  doc.campo('Criado por', l.criadoPorNome)
  doc.campo('Disparado por', l.disparadoPorNome)
  doc.campo('Arquivo', d.arquivoNome ?? (l.modoAnexo === 'unico' ? l.arquivoNome : null) ?? 'sem anexo')
  doc.campo('Leitura exigida', l.exigirConfirmacao === 'true' ? 'sim, antes do download' : 'não')

  doc.secao('Marcos')
  doc.campo('Último envio', quando(d.sentAt))
  doc.campo('Provável leitura', quando(d.firstHumanOpenAt))
  doc.campo('Acessou a página', quando(d.firstAccessAt))
  doc.campo('Confirmou a leitura', quando(d.confirmedAt))
  doc.campo('Baixou o arquivo', d.firstDownloadAt ? `${quando(d.firstDownloadAt)} (${d.downloadCount}x)` : '—')
  if (d.respondeuAt) doc.campo('Respondeu', `${quando(d.respondeuAt)} (${d.respostaCount}x)`)
  if (d.reciboAt) doc.campo('Recibo de leitura', quando(d.reciboAt))
  if (d.bounceAt) doc.campo('Devolução', `${quando(d.bounceAt)} — ${d.bounceMotivo ?? ''}`)

  doc.secao(`Envios (${historico.length})`)
  if (historico.length) {
    doc.tabela(
      ['Nº', 'Data/hora', 'Para', 'Canal', 'Situação', 'Message-ID / servidor'],
      historico.map(e => [
        e.numero,
        quando(e.enviadoEm),
        e.para,
        e.contaNome,
        `${e.status === 'enviado' ? 'aceito' : 'falhou'}${e.origem !== 'lote' ? ` (${e.origem === 'lembrete' ? 'lembrete automático' : 'reenvio'}${e.enviadoPorNome ? ` por ${e.enviadoPorNome}` : ''}${e.motivo ? `: ${e.motivo}` : ''})` : ''}`,
        [e.messageId, e.respostaSmtp ?? e.erro].filter(Boolean).join(' · ')
      ]),
      [0.05, 0.15, 0.2, 0.13, 0.2, 0.27]
    )
  } else {
    doc.paragrafo('Nenhum envio registrado.', { mutado: true })
  }

  doc.secao(`Linha do tempo (${trilha.length} evento(s))`)
  doc.tabela(
    ['Data/hora', 'Evento', 'IP', 'Detalhe'],
    trilha.map(e => {
      const m = (e.meta ?? {}) as Record<string, any>
      const detalhe = [
        m.classe ? (m.classe === 'provavel-pessoa' ? 'provável pessoa' : `automático: ${m.motivo ?? ''}`) : null,
        m.envio ? `envio nº ${m.envio}` : null,
        m.aceite ?? null,
        m.erro ?? null,
        m.diagnostico ?? null,
        m.arquivo ? `arquivo: ${m.arquivo}` : null,
        e.userAgent ? `navegador: ${e.userAgent.slice(0, 90)}` : null
      ].filter(Boolean).join(' · ')
      return [quando(e.createdAt), ROTULO_EVENTO_PDF[e.tipo] ?? e.tipo, e.ip, detalhe]
    }),
    [0.16, 0.17, 0.13, 0.54]
  )

  doc.secao('Conteúdo do e-mail enviado')
  doc.campo('Assunto', l.assuntoSnapshot)
  doc.campo('SHA-256 do HTML', hashHtml)
  doc.paragrafo('Texto do e-mail como o destinatário o recebeu (o HTML exato está guardado no sistema e corresponde ao SHA-256 acima):', { mutado: true, tamanho: 8.5 })
  doc.paragrafo(htmlParaTexto(htmlRecebido), { tamanho: 8.5 })

  doc.secao('Integridade')
  doc.paragrafo(
    `Código de verificação deste dossiê: ${codigoDossie} (SHA-256 dos dados acima). Os eventos são registrados no momento em que acontecem e não podem ser editados pela tela; um dossiê gerado de novo a partir dos mesmos registros traz o mesmo código.`,
    { tamanho: 8.5, mutado: true }
  )

  return { pdf: await doc.finalizar(), codigo: codigoDossie, nomeArquivo: `dossie-${d.codigo}.pdf`, destinatario: d, lote: l }
}

export async function dossieLote(id: number, op: Operador) {
  const db = useDb()
  const [l] = await db.select().from(batches).where(eq(batches.id, id))
  if (!l || (l.excluidoEm && op.papel !== 'admin')) throw createError({ statusCode: 404, statusMessage: 'Lote não encontrado' })

  const lista = await db
    .select({
      nome: recipients.nome,
      email: recipients.email,
      codigo: recipients.codigo,
      status: recipients.status,
      sentAt: recipients.sentAt,
      confirmedAt: recipients.confirmedAt,
      firstDownloadAt: recipients.firstDownloadAt,
      bounceTipo: recipients.bounceTipo,
      envios: sql<number>`(select count(*)::int from sys_mail_envios e where e.recipient_id = sys_mail_recipients.id and e.status = 'enviado')`,
      // IP de quem confirmou: a prova vem com a origem
      ipConfirmacao: sql<string | null>`(select e.ip from sys_mail_events e where e.recipient_id = sys_mail_recipients.id and e.tipo = 'confirmacao' order by e.id limit 1)`
    })
    .from(recipients)
    .where(eq(recipients.batchId, id))
    .orderBy(asc(recipients.email))

  const agora = new Date()
  const hashHtml = hash(l.htmlSnapshot)
  const codigoDossie = hash(JSON.stringify({ lote: l.id, hashHtml, lista: lista.map(r => [r.codigo, r.sentAt, r.confirmedAt, r.ipConfirmacao]) }))
    .slice(0, 16)
    .toUpperCase()

  const doc = await DocumentoPdf.criar(
    `Dossiê do lote #${l.id}`,
    `Gerado em ${formatarDataHora(agora)} (Brasília) por ${op.nome} · verificação ${codigoDossie}`
  )
  const conf = lista.filter(r => r.confirmedAt).length
  const env = lista.filter(r => r.sentAt).length

  doc.titulo1(`Dossiê do lote: ${l.nome}`, 'Registros de envio, confirmação e download de todos os destinatários, extraídos dos registros originais. Horários de Brasília.')
  doc.secao('Lote')
  doc.campo('Assunto', l.assuntoSnapshot)
  doc.campo('Canal de saída', l.contaNome)
  doc.campo('Respostas para', l.responderPara)
  doc.campo('Criado por', `${l.criadoPorNome ?? '—'} em ${quando(l.createdAt)}`)
  doc.campo('Disparado por', `${l.disparadoPorNome ?? '—'} em ${quando(l.startedAt)}`)
  doc.campo('Concluído em', quando(l.finishedAt))
  doc.campo('Arquivo', l.arquivoNome ?? 'sem anexo')
  doc.campo('SHA-256 do HTML', hashHtml)
  doc.campo('Resumo', `${lista.length} destinatário(s) · ${env} enviado(s) · ${conf} confirmaram (${env ? Math.round((conf / env) * 100) : 0}%) · ${lista.filter(r => r.firstDownloadAt).length} baixaram · ${lista.filter(r => r.bounceTipo === 'definitiva').length} devolução(ões)`)

  doc.secao('Destinatários')
  doc.tabela(
    ['Destinatário', 'Código', 'Enviado', 'Confirmou (IP)', 'Baixou', 'Obs.'],
    lista.map(r => [
      `${r.nome ? `${r.nome}\n` : ''}${r.email}`,
      r.codigo,
      quando(r.sentAt),
      r.confirmedAt ? `${quando(r.confirmedAt)}${r.ipConfirmacao ? `\n${r.ipConfirmacao}` : ''}` : '—',
      quando(r.firstDownloadAt),
      [r.envios > 1 ? `${r.envios} envios` : null, r.bounceTipo === 'definitiva' ? 'devolvido' : null, r.status === 'erro' ? 'falhou' : null].filter(Boolean).join(', ')
    ]),
    [0.27, 0.13, 0.15, 0.19, 0.15, 0.11],
    7.5
  )

  doc.secao('Integridade')
  doc.paragrafo(`Código de verificação: ${codigoDossie}. Para a prova individual completa (linha do tempo com IP e navegador), gere o dossiê do destinatário.`, { tamanho: 8.5, mutado: true })

  return { pdf: await doc.finalizar(), codigo: codigoDossie, nomeArquivo: `dossie-lote-${l.id}.pdf`, lote: l, total: lista.length }
}
