import { eq, inArray } from 'drizzle-orm'
import { useDb, solicitacoes, assinDocumentos, assinSignatarios, type Account, type Solicitacao, type AssinDocumento, type AssinSignatario } from '../../db'
import type { ResultadoClassificacao, PistasModulos } from './classificar'
import { suprimir } from '../supressao'
import { registrarEventoSolic, avisarEquipe, webhookSolicitacao } from '../solicitacoes'
import { enfileirarRespostaSolic } from '../painel-tickets'
import { codigoSolicitacao } from '../documentos'
import { registrarEventoAssin, avisarQuemPediu } from '../assinatura'

/**
 * Respostas e devolucoes dos e-mails de SOLICITACAO e de ASSINATURA.
 *
 * O monitor da caixa nasceu para os lotes (Fase 3). Aqui ele passa a
 * reconhecer tambem o cliente que responde ao pedido de documentos ("mando
 * semana que vem") e o endereco de signatario que nao existe — antes essas
 * mensagens caiam em "sem vinculo" e ninguem via.
 *
 * Efeitos: evento no historico da solicitacao/assinatura, supressao do
 * endereco que devolveu, e um aviso por e-mail a quem pediu (a resposta chega
 * na caixa do CANAL, que nem sempre e a da pessoa).
 */

export type VinculoModulo =
  | { tipo: 'solicitacao'; solic: Solicitacao; como: string }
  | { tipo: 'assinatura'; doc: AssinDocumento; signatario: AssinSignatario | null; como: string }

const idDoCodigo = (c: string) => Number(c.slice(4))
const enderecoDe = (de: string | null) => (de ?? '').replace(/.*</, '').replace(/>.*/, '').trim().toLowerCase()

async function solicPorIds(codigos: string[]) {
  if (!codigos.length) return null
  const [s] = await useDb().select().from(solicitacoes).where(inArray(solicitacoes.codigo, codigos)).limit(1)
  if (s) return s
  const antigos = codigos.filter(c => /^SOL-\d{6}$/.test(c)).map(idDoCodigo)
  if (!antigos.length) return null
  const [a] = await useDb().select().from(solicitacoes).where(inArray(solicitacoes.id, antigos)).limit(1)
  return a ?? null
}

async function assinPorIds(codigos: string[]) {
  if (!codigos.length) return null
  // o codigo e o da coluna; os antigos (ASS-000045) ainda caem no id
  const [d] = await useDb().select().from(assinDocumentos).where(inArray(assinDocumentos.codigo, codigos)).limit(1)
  if (d) return d
  const antigos = codigos.filter(c => /^ASS-\d{6}$/.test(c)).map(idDoCodigo)
  if (!antigos.length) return null
  const [a] = await useDb().select().from(assinDocumentos).where(inArray(assinDocumentos.id, antigos)).limit(1)
  return a ?? null
}

/** Quem, entre os signatarios, escreveu (resposta) ou falhou (devolucao). */
async function signatarioDaMensagem(doc: AssinDocumento, enderecos: (string | null)[]) {
  const sigs = await useDb().select().from(assinSignatarios).where(eq(assinSignatarios.documentoId, doc.id))
  const alvo = enderecos.filter(Boolean).map(e => e!.toLowerCase())
  return sigs.find(s => alvo.includes(s.email.toLowerCase())) ?? null
}

export async function correlacionarModulo(
  r: ResultadoClassificacao,
  p: PistasModulos,
  de: string | null
): Promise<VinculoModulo | null> {
  const db = useDb()
  const quem = [r.pistas.destinatarioFalho, enderecoDe(de)]

  // 1. o Message-ID do nosso e-mail (In-Reply-To, References, original do DSN)
  const s1 = await solicPorIds(p.solicPorId)
  if (s1) return { tipo: 'solicitacao', solic: s1, como: 'message_id' }
  const d1 = await assinPorIds(p.assinPorId)
  if (d1) return { tipo: 'assinatura', doc: d1, signatario: await signatarioDaMensagem(d1, quem), como: 'message_id' }

  // 2. o link citado
  if (p.tokensSolic.length) {
    const [s] = await db.select().from(solicitacoes).where(inArray(solicitacoes.token, p.tokensSolic)).limit(1)
    if (s) return { tipo: 'solicitacao', solic: s, como: 'token' }
  }
  if (p.tokensAssin.length) {
    const [l] = await db
      .select({ sig: assinSignatarios, doc: assinDocumentos })
      .from(assinSignatarios)
      .innerJoin(assinDocumentos, eq(assinDocumentos.id, assinSignatarios.documentoId))
      .where(inArray(assinSignatarios.token, p.tokensAssin))
      .limit(1)
    if (l) return { tipo: 'assinatura', doc: l.doc, signatario: l.sig, como: 'token' }
  }

  // 3. o codigo no assunto ou no corpo — so vale se quem escreveu e o cliente
  //    daquele pedido: um "SOL-000123" citado a esmo nao liga nada
  const s3 = await solicPorIds(p.solicNoTexto)
  if (s3 && quem.includes(s3.destinatarioEmail.toLowerCase())) return { tipo: 'solicitacao', solic: s3, como: 'codigo' }
  const d3 = await assinPorIds(p.assinNoTexto)
  if (d3) {
    const sig = await signatarioDaMensagem(d3, quem)
    if (sig) return { tipo: 'assinatura', doc: d3, signatario: sig, como: 'codigo' }
  }
  return null
}

/** O endereco do canal e o de quem pediu sao o mesmo? Entao a pessoa ja viu. */
function mesmaCaixa(conta: Account, email: string | null) {
  if (!email) return true
  const e = email.toLowerCase()
  return [conta.usuario, conta.remetente, conta.responderPara ?? ''].some(x => enderecoDe(x) === e || x.toLowerCase() === e)
}

export async function aplicarEfeitoModulo(
  v: VinculoModulo,
  r: ResultadoClassificacao,
  conta: Account,
  msg: { inboundId: number; de: string | null; assunto: string | null; recebidoEm?: Date | null }
) {
  const trecho = r.trecho?.slice(0, 1500) ?? null
  const motivo = [r.status, r.diagnostico].filter(Boolean).join(' — ') || 'devolução definitiva'

  if (v.tipo === 'solicitacao') {
    const s = v.solic
    const meta = { inboundId: msg.inboundId, de: msg.de, assunto: msg.assunto }
    switch (r.classificacao) {
      case 'resposta':
        await registrarEventoSolic(s.id, 'resposta_email', `${msg.de ?? 'O cliente'} respondeu por e-mail: "${msg.assunto ?? ''}"`, {
          meta: { ...meta, trecho }
        })
        if (!mesmaCaixa(conta, s.criadoPorEmail)) {
          await avisarEquipe(
            s,
            'O cliente respondeu o e-mail da solicitação',
            `${s.destinatarioNome || s.destinatarioEmail} respondeu por e-mail ao pedido "${s.titulo}". A resposta chegou na caixa ${conta.nome}.`,
            trecho ? [trecho.slice(0, 600)] : []
          )
        }
        await webhookSolicitacao('solicitacao.respondida', s, { de: msg.de, assunto: msg.assunto, trecho })
        if (s.criarTickets) {
          await enfileirarRespostaSolic({
            solic: s,
            codigo: codigoSolicitacao(s),
            inboundId: msg.inboundId,
            de: msg.de,
            assunto: msg.assunto,
            recebidoEm: msg.recebidoEm ?? null,
            trecho: r.trecho ?? null
          })
        }
        break
      case 'devolucao_definitiva': {
        const falho = r.pistas.destinatarioFalho ?? s.destinatarioEmail
        await suprimir(falho, { motivo, origem: 'devolucao' })
        await registrarEventoSolic(s.id, 'devolucao', `O e-mail para ${falho} voltou: ${motivo}`, { meta })
        if (falho.toLowerCase() === s.destinatarioEmail.toLowerCase()) {
          await useDb()
            .update(solicitacoes)
            .set({ envioErro: `Devolvido: ${motivo}`.slice(0, 1000) })
            .where(eq(solicitacoes.id, s.id))
          await avisarEquipe(
            s,
            'O e-mail da solicitação não foi entregue',
            `O endereço ${falho} devolveu o pedido "${s.titulo}". O cliente não recebeu o link — corrija o e-mail e reenvie pela tela da solicitação.`,
            [motivo]
          )
        }
        break
      }
      case 'devolucao_temporaria':
        await registrarEventoSolic(s.id, 'devolucao', `Atraso na entrega do e-mail: ${motivo}`, { meta })
        break
      case 'auto_resposta':
        await registrarEventoSolic(s.id, 'auto_resposta', `Resposta automática: "${msg.assunto ?? ''}"`, { meta: { ...meta, trecho: trecho?.slice(0, 300) } })
        break
      case 'recibo':
        await registrarEventoSolic(s.id, 'recibo', 'Recibo de leitura do cliente de e-mail', { meta })
        break
    }
    return
  }

  const { doc, signatario: sig } = v
  const quem = sig ? `${sig.nome} <${sig.email}>` : msg.de ?? 'alguém'
  switch (r.classificacao) {
    case 'resposta':
      await registrarEventoAssin(doc.id, 'resposta_email', `${quem} respondeu por e-mail: "${msg.assunto ?? ''}"`, { signatarioId: sig?.id ?? null })
      if (!mesmaCaixa(conta, doc.criadoPorEmail)) {
        await avisarQuemPediu(
          doc,
          `Resposta por e-mail: ${doc.titulo}`,
          `${quem} respondeu por e-mail ao documento para assinar "${doc.titulo}". A resposta chegou na caixa ${conta.nome}.`,
          trecho ? [trecho.slice(0, 600)] : []
        )
      }
      break
    case 'devolucao_definitiva': {
      const falho = r.pistas.destinatarioFalho ?? sig?.email ?? null
      if (falho) await suprimir(falho, { motivo, origem: 'devolucao' })
      await registrarEventoAssin(doc.id, 'devolucao', `O e-mail para ${falho ?? 'um signatário'} voltou: ${motivo}`, { signatarioId: sig?.id ?? null })
      if (sig) {
        await useDb()
          .update(assinSignatarios)
          .set({ envioErro: `Devolvido: ${motivo}`.slice(0, 1000) })
          .where(eq(assinSignatarios.id, sig.id))
        await avisarQuemPediu(
          doc,
          `E-mail de signatário não entregue: ${doc.titulo}`,
          `O endereço ${sig.email} (${sig.nome}) devolveu o convite para assinar "${doc.titulo}". Corrija o e-mail e reenvie o convite pela tela do documento.`,
          [motivo]
        )
      }
      break
    }
    case 'devolucao_temporaria':
      await registrarEventoAssin(doc.id, 'devolucao', `Atraso na entrega para ${sig?.email ?? 'um signatário'}: ${motivo}`, { signatarioId: sig?.id ?? null })
      break
    case 'auto_resposta':
      await registrarEventoAssin(doc.id, 'auto_resposta', `Resposta automática de ${quem}: "${msg.assunto ?? ''}"`, { signatarioId: sig?.id ?? null })
      break
    case 'recibo':
      await registrarEventoAssin(doc.id, 'recibo', `Recibo de leitura de ${quem}`, { signatarioId: sig?.id ?? null })
      break
  }
}
