import type { ParsedMail } from 'mailparser'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { useDb, inbound, envios, recipients, batches, type Account, type Batch, type Recipient } from '../../db'
import { classificar, pistasDeModulos, type ResultadoClassificacao } from './classificar'
import { correlacionarModulo, aplicarEfeitoModulo } from './modulos'
import { emitirWebhook } from '../webhooks'
import { registrarEvento } from '../tracking'
import { useBatchBus } from '../sse'
import { suprimir } from '../supressao'
import { enfileirarResposta } from '../painel-tickets'

/**
 * O que fazer com cada mensagem lida da caixa: classificar, ligar ao envio e
 * aplicar o efeito no destinatario.
 */

type Vinculo = { destinatario: Recipient; lote: Batch; como: string }

/** Codigo embutido no nosso Message-ID: <GLK-XXXX-XXXX.lote.aleatorio@dominio> */
const RE_CODIGO_NO_ID = /^<(GLK-[A-Z0-9]{4}-[A-Z0-9]{4})\.\d+\./

/**
 * Liga a mensagem ao envio, da pista mais forte para a mais fraca:
 *  1. Message-ID de algum envio (In-Reply-To/References, ou o original do DSN/MDN);
 *  2. o codigo embutido no nosso Message-ID;
 *  3. o codigo GLK no cabecalho X-Gaulke-Codigo, no assunto ou no corpo;
 *  4. o token do link /c/<token> citado na resposta.
 * Nenhum = "sem vinculo".
 */
export async function correlacionar(r: ResultadoClassificacao): Promise<Vinculo | null> {
  const db = useDb()
  const achar = async (cond: ReturnType<typeof eq>, como: string): Promise<Vinculo | null> => {
    const [l] = await db
      .select({ destinatario: recipients, lote: batches })
      .from(recipients)
      .innerJoin(batches, eq(batches.id, recipients.batchId))
      .where(cond)
      .limit(1)
    return l ? { ...l, como } : null
  }

  if (r.pistas.messageIds.length) {
    const [e] = await db
      .select({ id: envios.recipientId })
      .from(envios)
      .where(inArray(envios.messageId, r.pistas.messageIds))
      .limit(1)
    if (e) return achar(eq(recipients.id, e.id), 'message_id')
    const v = await achar(inArray(recipients.messageId, r.pistas.messageIds) as never, 'message_id')
    if (v) return v
    const codigoNoId = r.pistas.messageIds.map(m => RE_CODIGO_NO_ID.exec(m)?.[1]).find(Boolean)
    if (codigoNoId) {
      const v2 = await achar(eq(recipients.codigo, codigoNoId), 'message_id')
      if (v2) return v2
    }
  }
  for (const codigo of r.pistas.codigos) {
    const v = await achar(eq(recipients.codigo, codigo), 'codigo')
    if (v) return v
  }
  for (const token of r.pistas.tokens) {
    const v = await achar(eq(recipients.token, token), 'token')
    if (v) return v
  }
  return null
}

export type Processada = { novo: boolean; classificacao: string; vinculado: boolean }

export async function processarMensagem(
  conta: Account,
  uidvalidity: number,
  uid: number,
  m: ParsedMail
): Promise<Processada> {
  const db = useDb()
  const r = classificar(m)
  const v = await correlacionar(r)
  const de = m.from?.text?.slice(0, 500) ?? null
  // nao e de lote: pode ser resposta/devolucao de solicitacao ou assinatura
  const vm = v ? null : await correlacionarModulo(r, pistasDeModulos(m, r.pistas.messageIds), de)

  // mesma mensagem ja processada (reprocessamento apos troca de UIDVALIDITY)
  if (m.messageId) {
    const [ja] = await db
      .select({ id: inbound.id })
      .from(inbound)
      .where(and(eq(inbound.contaId, conta.id), eq(inbound.messageId, m.messageId)))
      .limit(1)
    if (ja) return { novo: false, classificacao: r.classificacao, vinculado: !!(v || vm) }
  }

  const [linha] = await db
    .insert(inbound)
    .values({
      contaId: conta.id,
      contaNome: conta.nome,
      uidvalidity,
      uid,
      messageId: m.messageId ?? null,
      de,
      assunto: m.subject?.slice(0, 500) ?? null,
      recebidoEm: m.date ?? null,
      classificacao: r.classificacao,
      recipientId: v?.destinatario.id ?? null,
      batchId: v?.lote.id ?? null,
      solicId: vm?.tipo === 'solicitacao' ? vm.solic.id : null,
      assinDocumentoId: vm?.tipo === 'assinatura' ? vm.doc.id : null,
      assinSignatarioId: vm?.tipo === 'assinatura' ? vm.signatario?.id ?? null : null,
      vinculo: v?.como ?? (vm ? `${vm.tipo}:${vm.como}` : null),
      // o corpo SO e guardado quando a mensagem e de um envio nosso: a caixa
      // pode ter e-mail pessoal ou de terceiros, que nao nos diz respeito
      trecho: v || vm ? r.trecho : null,
      detalhe: (v || vm || r.classificacao.startsWith('devolucao')
        ? { status: r.status, diagnostico: r.diagnostico, destinatarioFalho: r.pistas.destinatarioFalho }
        : null) as never
    })
    .onConflictDoNothing()
    .returning({ id: inbound.id })

  if (!linha) return { novo: false, classificacao: r.classificacao, vinculado: !!(v || vm) }
  if (v) await aplicarEfeito(v, r, linha.id, { de, assunto: m.subject ?? null, recebidoEm: m.date ?? null })
  if (vm) await aplicarEfeitoModulo(vm, r, conta, { inboundId: linha.id, de, assunto: m.subject ?? null })
  return { novo: true, classificacao: r.classificacao, vinculado: !!(v || vm) }
}

async function aplicarEfeito(
  v: Vinculo,
  r: ResultadoClassificacao,
  inboundId: number,
  msg: { de: string | null; assunto: string | null; recebidoEm: Date | null }
) {
  const db = useDb()
  const d = v.destinatario
  const bus = useBatchBus()
  const avisar = (tipo: string, mensagem: string, status?: string) =>
    bus.emitBatch({ batchId: v.lote.id, tipo, recipientId: d.id, email: d.email, codigo: d.codigo, status, mensagem })

  switch (r.classificacao) {
    case 'devolucao_definitiva': {
      const falho = r.pistas.destinatarioFalho ?? d.email
      const motivo = [r.status, r.diagnostico].filter(Boolean).join(' — ') || 'devolução definitiva'
      // o endereco que devolveu nao recebe mais envios
      await suprimir(falho, { motivo, origem: 'devolucao', recipientId: d.id })
      await registrarEvento(d.id, 'devolucao', {
        meta: { tipo: 'definitiva', status: r.status, diagnostico: r.diagnostico, endereco: falho, inboundId }
      })
      // se o e-mail JA foi corrigido e reenviado, a devolucao e do endereco
      // antigo: registra, mas nao marca a pessoa como devolvida
      if (falho === d.email) {
        await db
          .update(recipients)
          .set({ status: 'bounce', bounceAt: sql`coalesce(${recipients.bounceAt}, now())`, bounceTipo: 'definitiva', bounceMotivo: motivo })
          .where(eq(recipients.id, d.id))
        avisar('devolucao', `Devolução definitiva: ${motivo}`, 'bounce')
        await emitirWebhook(
          'comunicado.devolvido',
          { destinatarioId: d.id, codigo: d.codigo, email: falho, motivo, lote: { id: v.lote.id, nome: v.lote.nome } },
          `/admin/destinatario/${d.id}`
        )
      } else {
        avisar('devolucao', `Devolução do endereço anterior (${falho}): ${motivo}`)
      }
      break
    }
    case 'devolucao_temporaria':
      await registrarEvento(d.id, 'devolucao', { meta: { tipo: 'temporaria', status: r.status, diagnostico: r.diagnostico, inboundId } })
      await db
        .update(recipients)
        .set({ bounceTipo: sql`coalesce(${recipients.bounceTipo}, 'temporaria')`, bounceMotivo: sql`coalesce(${recipients.bounceMotivo}, ${r.diagnostico ?? r.status})` })
        .where(eq(recipients.id, d.id))
      avisar('devolucao', `Atraso na entrega (temporário): ${r.status ?? ''} ${r.diagnostico ?? ''}`.trim())
      break
    case 'recibo':
      await registrarEvento(d.id, 'recibo', { meta: { disposicao: r.diagnostico, inboundId } })
      await db.update(recipients).set({ reciboAt: sql`coalesce(${recipients.reciboAt}, now())` }).where(eq(recipients.id, d.id))
      avisar('recibo', 'Recibo de leitura do cliente de e-mail')
      break
    case 'auto_resposta':
      await registrarEvento(d.id, 'auto_resposta', { meta: { trecho: r.trecho?.slice(0, 300), inboundId } })
      avisar('auto_resposta', `Resposta automática: ${msg.assunto ?? ''}`)
      break
    case 'resposta':
      await registrarEvento(d.id, 'resposta', {
        meta: { de: msg.de, assunto: msg.assunto, trecho: r.trecho?.slice(0, 500), inboundId }
      })
      await db
        .update(recipients)
        .set({ respondeuAt: sql`coalesce(${recipients.respondeuAt}, now())`, respostaCount: sql`${recipients.respostaCount} + 1` })
        .where(eq(recipients.id, d.id))
      avisar('resposta', `Respondeu: ${msg.assunto ?? ''}`)
      await emitirWebhook(
        'comunicado.respondido',
        {
          destinatarioId: d.id,
          codigo: d.codigo,
          destinatario: { nome: d.nome, email: d.email, empresa: d.empresa, documento: d.documento },
          lote: { id: v.lote.id, nome: v.lote.nome },
          de: msg.de,
          assunto: msg.assunto,
          trecho: r.trecho?.slice(0, 1500) ?? null
        },
        `/admin/destinatario/${d.id}`
      )
      if (v.lote.criarTickets) {
        await enfileirarResposta({
          lote: v.lote,
          destinatario: d,
          inboundId,
          de: msg.de,
          assunto: msg.assunto,
          recebidoEm: msg.recebidoEm,
          trecho: r.trecho
        })
      }
      break
  }
}
