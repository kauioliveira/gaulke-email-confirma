import { randomBytes } from 'node:crypto'
import type { H3Event } from 'h3'
import { desc, eq } from 'drizzle-orm'
import {
  useDb,
  inbound,
  inboundRespostas,
  ticketsPainel,
  recipients,
  batches,
  solicitacoes,
  assinDocumentos,
  type AnexoRecebido
} from '../../db'
import { operadorAtual, setorVisivel, type Operador } from '../permissoes'
import { codigoSolicitacao } from '../documentos'
import { codigoAssinatura, registrarEventoAssin } from '../assinatura'
import { registrarEventoSolic } from '../solicitacoes'
import { registrarEvento } from '../tracking'
import { resolverConta, enviarEmail } from '../mailer'
import { enfileirarRespostaEnviada } from '../painel-tickets'

/**
 * Uma mensagem da caixa, para a tela "E-mail recebido": ler a resposta do
 * cliente inteira, baixar o que ele mandou e responder pelo proprio canal,
 * na mesma conversa. Quem pediu nem sempre tem acesso a caixa do canal.
 *
 * Visibilidade: a mesma da lista da caixa — resposta de solicitacao ou
 * assinatura de outro setor fica de fora (o admin ve tudo); quem pediu
 * sempre ve a resposta do proprio pedido.
 */

export async function carregarMensagem(event: H3Event, id: number) {
  const op = operadorAtual(event)
  const db = useDb()
  const [l] = await db
    .select({ m: inbound, r: recipients, b: batches, s: solicitacoes, d: assinDocumentos })
    .from(inbound)
    .leftJoin(recipients, eq(recipients.id, inbound.recipientId))
    .leftJoin(batches, eq(batches.id, inbound.batchId))
    .leftJoin(solicitacoes, eq(solicitacoes.id, inbound.solicId))
    .leftJoin(assinDocumentos, eq(assinDocumentos.id, inbound.assinDocumentoId))
    .where(eq(inbound.id, id))
  if (!l) throw createError({ statusCode: 404, statusMessage: 'Mensagem não encontrada' })

  const setor = setorVisivel(op)
  const dono = (criador: number | null | undefined) => !!criador && criador === op.id
  if (setor !== undefined) {
    if (l.s && l.s.departamentoId !== setor && !dono(l.s.criadoPorUserId)) {
      throw createError({ statusCode: 403, statusMessage: 'Esta resposta é de uma solicitação de outro setor.' })
    }
    if (l.d && l.d.departamentoId !== setor && !dono(l.d.criadoPorUserId)) {
      throw createError({ statusCode: 403, statusMessage: 'Esta resposta é de um documento de outro setor.' })
    }
  }
  return { ...l, op }
}

export type MensagemCarregada = Awaited<ReturnType<typeof carregarMensagem>>

/** Endereco puro de "Fulano <x@y>". */
export const enderecoDe = (de: string | null | undefined) => (/<([^>]+)>/.exec(de ?? '')?.[1] ?? de ?? '').trim().toLowerCase()

const escaparHtml = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * HTML do cliente para ver num iframe SEM script: uma CSP no proprio
 * documento barra imagem remota (pixel de rastreio do remetente) e qualquer
 * carregamento externo.
 */
export function htmlSeguro(html: string) {
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:">`
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, h => `${h}${csp}`) : `${csp}${html}`
}

export function detalheMensagem(l: MensagemCarregada, respostas: (typeof inboundRespostas.$inferSelect)[], ticket: { code: string | null; status: string } | null) {
  const m = l.m
  const anexos = ((m.anexos ?? []) as AnexoRecebido[]).map((a, n) => ({ n, nome: a.nome, tipo: a.tipo, tamanho: a.tamanho, antivirus: a.antivirus }))
  const vinculo = l.s
    ? { tipo: 'solicitacao' as const, id: l.s.id, codigo: codigoSolicitacao(l.s), titulo: l.s.titulo, cliente: l.s.destinatarioNome || l.s.destinatarioEmail, empresa: l.s.empresa }
    : l.d
      ? { tipo: 'assinatura' as const, id: l.d.id, codigo: codigoAssinatura(l.d), titulo: l.d.titulo, cliente: null, empresa: null }
      : l.r && l.b
        ? { tipo: 'lote' as const, id: l.b.id, codigo: l.r.codigo, titulo: l.b.nome, cliente: l.r.nome || l.r.email, empresa: l.r.empresa, destinatarioId: l.r.id }
        : null
  return {
    id: m.id,
    contaNome: m.contaNome,
    de: m.de,
    para: m.para,
    assunto: m.assunto,
    recebidoEm: m.recebidoEm?.toISOString() ?? null,
    processadoEm: m.processadoEm.toISOString(),
    classificacao: m.classificacao,
    // sem vinculo nao guardamos corpo (mensagem pessoal ou de terceiros)
    texto: m.corpoTexto ?? m.trecho,
    completo: !!m.pasta,
    html: m.corpoHtml ? htmlSeguro(m.corpoHtml) : null,
    temEml: !!m.pasta && (m.tamanho ?? 0) > 0,
    anexos,
    vinculo,
    ticket,
    podeResponder: !!vinculo && m.classificacao === 'resposta' && !!enderecoDe(m.de) && !!m.contaId,
    respostas: respostas.map(r => ({
      id: r.id,
      para: r.para,
      assunto: r.assunto,
      texto: r.texto,
      anexos: r.anexos ?? [],
      porNome: r.enviadoPorNome,
      enviadoEm: r.enviadoEm?.toISOString() ?? null,
      erro: r.erro,
      criadoEm: r.criadoEm.toISOString()
    }))
  }
}

export async function respostasDaMensagem(id: number) {
  const db = useDb()
  const respostas = await db.select().from(inboundRespostas).where(eq(inboundRespostas.inboundId, id)).orderBy(inboundRespostas.id)
  const [t] = await db
    .select({ code: ticketsPainel.ticketCode, status: ticketsPainel.statusEnvio })
    .from(ticketsPainel)
    .where(eq(ticketsPainel.inboundId, id))
    .orderBy(desc(ticketsPainel.id))
    .limit(1)
  return { respostas, ticket: t ?? null }
}

/**
 * Responde o cliente pelo canal que recebeu a mensagem, NA MESMA CONVERSA
 * (In-Reply-To/References). O nosso Message-ID leva o codigo do pedido, para
 * a proxima resposta do cliente se ligar de novo sozinha.
 */
export async function responderMensagem(
  l: MensagemCarregada,
  texto: string,
  anexos: { nome: string; conteudo: Buffer; tipo?: string }[],
  op: Operador
) {
  const m = l.m
  const para = enderecoDe(m.de)
  if (!para || !m.contaId || m.classificacao !== 'resposta' || !(l.s || l.d || l.r)) {
    throw createError({ statusCode: 409, statusMessage: 'Esta mensagem não pode ser respondida por aqui.' })
  }
  const assunto = (/^\s*(re|res|enc|fw|fwd)\s*:/i.test(m.assunto ?? '') ? m.assunto! : `Re: ${m.assunto ?? ''}`).slice(0, 500)
  const conta = await resolverConta(m.contaId)
  const dominio = (/@([^>\s]+)>?\s*$/.exec(conta.from)?.[1] || 'contabilgaulke.com.br').toLowerCase()
  const rand = randomBytes(4).toString('hex')
  const messageId = l.s
    ? `<${codigoSolicitacao(l.s)}.resposta.${rand}@${dominio}>`
    : l.d
      ? `<${codigoAssinatura(l.d)}.resposta.${rand}@${dominio}>`
      : `<${l.r!.codigo}.${l.b?.id ?? 0}.${rand}@${dominio}>`

  // a mensagem do cliente vai citada embaixo, como num cliente de e-mail
  const quando = m.recebidoEm ? formatarDataHora(m.recebidoEm) : ''
  const original = (m.corpoTexto ?? m.trecho ?? '').slice(0, 20000)
  const textoPuro = [texto.trim(), '', `Em ${quando}, ${m.de ?? 'o cliente'} escreveu:`, ...original.split('\n').map(x => `> ${x}`)].join('\n')
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#0f172a">${escaparHtml(texto.trim()).replace(/\n/g, '<br>')}</div>
<br><div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#64748b">Em ${escaparHtml(quando)}, ${escaparHtml(m.de ?? 'o cliente')} escreveu:</div>
<blockquote style="margin:4px 0 0 0;padding-left:10px;border-left:3px solid #cbd5e1;color:#475569;font-family:Arial,Helvetica,sans-serif;font-size:13px">${escaparHtml(original).replace(/\n/g, '<br>')}</blockquote>`

  const db = useDb()
  const [linha] = await db
    .insert(inboundRespostas)
    .values({
      inboundId: m.id,
      para,
      assunto,
      texto: texto.trim(),
      anexos: anexos.length ? anexos.map(a => ({ nome: a.nome, tamanho: a.conteudo.length })) : null,
      enviadoPorUserId: op.id,
      enviadoPorNome: op.nome
    })
    .returning()

  try {
    await enviarEmail({
      conta,
      para,
      assunto,
      html,
      texto: textoPuro,
      messageId,
      inReplyTo: m.messageId,
      references: m.referencias || m.messageId,
      anexos,
      headers: l.s ? { 'X-Gaulke-Solicitacao': codigoSolicitacao(l.s) } : l.d ? { 'X-Gaulke-Assinatura': codigoAssinatura(l.d) } : { 'X-Gaulke-Codigo': l.r!.codigo }
    })
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e)
    await db.update(inboundRespostas).set({ erro }).where(eq(inboundRespostas.id, linha!.id))
    throw createError({ statusCode: 502, statusMessage: `A resposta não saiu: ${erro}` })
  }
  await db.update(inboundRespostas).set({ enviadoEm: new Date(), messageId }).where(eq(inboundRespostas.id, linha!.id))

  // historico de onde a conversa pertence
  const resumo = `${op.nome} respondeu o cliente por e-mail (${para})`
  if (l.s) await registrarEventoSolic(l.s.id, 'resposta_enviada', resumo, { porNome: op.nome, meta: { inboundId: m.id, messageId } })
  else if (l.d) await registrarEventoAssin(l.d.id, 'resposta_enviada', resumo, { porNome: op.nome })
  else if (l.r) await registrarEvento(l.r.id, 'resposta_enviada', { meta: { inboundId: m.id, porNome: op.nome, messageId } })

  // e no chamado daquela conversa, se houver
  const [dono] = await db
    .select({ solicitante: ticketsPainel.solicitanteUserId })
    .from(ticketsPainel)
    .where(eq(ticketsPainel.inboundId, m.id))
    .orderBy(desc(ticketsPainel.id))
    .limit(1)
  if (dono) {
    await enfileirarRespostaEnviada({
      inboundId: m.id,
      // quem abriu o chamado sempre pode comentar nele
      solicitanteUserId: dono.solicitante ?? op.id,
      porNome: op.nome,
      para,
      texto,
      anexos: anexos.map(a => a.nome)
    })
  }
  return { id: linha!.id, para, assunto }
}
