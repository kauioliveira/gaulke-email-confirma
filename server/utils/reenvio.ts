import { z } from 'zod'
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { useDb, batches, recipients, type Batch, type Recipient } from '../db'
import { resolverConta } from './mailer'
import { enviarUm, iniciarLote, loteEmExecucao } from './sender'
import { registrarEnvio } from './envios'
import { registrarEvento } from './tracking'
import { useBatchBus } from './sse'
import type { Operador } from './permissoes'
import { suprimidos } from './supressao'

/**
 * Reenvio depois do disparo — o caso "o cliente diz que nao recebeu".
 *
 * O reenvio sai IGUAL ao original: mesmo snapshot do conteudo, mesmo link e
 * mesmo codigo. Assim o que a pessoa fizer no e-mail antigo continua valendo,
 * e a historia dela fica numa linha do tempo so, com cada envio numerado em
 * sys_mail_envios (no 1 = original, 2, 3... = reenvios).
 */

/** Status de quem ja passou pelo disparo; antes disso nao ha o que reenviar. */
const REENVIAVEIS = ['enviado', 'erro', 'bounce']

const emailSchema = z.string().trim().toLowerCase().email()

function falha(statusCode: number, statusMessage: string) {
  return createError({ statusCode, statusMessage })
}

async function carregar(recipientId: number) {
  const [linha] = await useDb()
    .select({ r: recipients, lote: batches })
    .from(recipients)
    .innerJoin(batches, eq(batches.id, recipients.batchId))
    .where(eq(recipients.id, recipientId))
  if (!linha || linha.lote.excluidoEm) throw falha(404, 'Destinatario nao encontrado')
  return linha as { r: Recipient; lote: Batch }
}

type Resultado =
  | { ok: true; numero: number; para: string; canal: string; resposta: string }
  | { ok: false; numero: number; para: string; canal: string; erro: string }

/**
 * Reenvia AGORA, para uma pessoa, fora da fila do lote.
 *
 * A falha de SMTP nao vira excecao: o envio falho tambem entra no historico
 * (com o erro), e a tela precisa mostrar isso no lugar certo — no log daquela
 * pessoa — e nao so num aviso que some.
 */
export async function reenviarAgora(
  recipientId: number,
  o: { para?: string | null; motivo: string; contaId?: number | null },
  op: Operador
): Promise<Resultado & { emailAnterior: string | null; loteId: number; loteNome: string }> {
  const { r, lote } = await carregar(recipientId)

  if (!REENVIAVEIS.includes(r.status)) {
    throw falha(400, 'Esta pessoa ainda nao recebeu o envio original: ela esta na fila do lote.')
  }
  if (r.reenvioPendente) {
    throw falha(409, 'Ja existe um reenvio desta pessoa aguardando na fila do lote.')
  }

  // e-mail corrigido: vale para este e para os proximos envios
  let para = r.email
  let emailAnterior: string | null = null
  if (o.para && o.para.trim().toLowerCase() !== r.email) {
    const novo = emailSchema.safeParse(o.para)
    if (!novo.success) throw falha(400, 'E-mail corrigido invalido')
    const [outro] = await useDb()
      .select({ id: recipients.id })
      .from(recipients)
      .where(and(eq(recipients.batchId, lote.id), eq(recipients.email, novo.data), ne(recipients.id, r.id)))
    if (outro) throw falha(409, `${novo.data} ja esta neste lote como outro destinatario.`)
    emailAnterior = r.email
    para = novo.data
    await useDb().update(recipients).set({ email: para }).where(eq(recipients.id, r.id))
  }

  // endereco que ja devolveu definitivamente: mandar de novo so gera outra
  // devolucao. So com o e-mail corrigido.
  const [bloqueado] = await suprimidos([para])
  if (bloqueado) {
    throw falha(
      409,
      `${para} devolveu definitivamente${bloqueado.motivo ? ` (${bloqueado.motivo})` : ''}. Corrija o e-mail para reenviar.`
    )
  }

  let conta
  try {
    conta = await resolverConta(o.contaId ?? lote.contaId)
  } catch (e) {
    throw falha(400, e instanceof Error ? e.message : String(e))
  }

  const base = {
    recipientId: r.id,
    origem: 'reenvio' as const,
    para,
    contaId: conta.id,
    contaNome: conta.nome,
    responderPara: lote.responderPara,
    motivo: o.motivo,
    porUserId: op.id,
    porNome: op.nome
  }
  const bus = useBatchBus()

  try {
    const info = await enviarUm(lote, { ...r, email: para }, conta)

    await useDb()
      .update(recipients)
      .set({
        status: 'enviado',
        sentAt: new Date(),
        messageId: info.messageId,
        ultimoErro: null,
        tentativas: r.tentativas + 1
      })
      .where(eq(recipients.id, r.id))

    // quem estava em erro passou a ter recebido: os contadores do lote acompanham
    if (r.status === 'erro') {
      await useDb()
        .update(batches)
        .set({ enviados: sql`${batches.enviados} + 1`, falhas: sql`greatest(${batches.falhas} - 1, 0)` })
        .where(eq(batches.id, lote.id))
    }

    const numero = await registrarEnvio({ ...base, messageId: info.messageId, status: 'enviado', respostaSmtp: info.response })
    await registrarEvento(r.id, 'reenvio', {
      meta: { envio: numero, messageId: info.messageId, motivo: o.motivo, por: op.nome, para, emailAnterior, canal: conta.nome }
    })
    bus.emitBatch({
      batchId: lote.id,
      tipo: 'reenvio',
      recipientId: r.id,
      email: para,
      codigo: r.codigo,
      status: 'enviado',
      mensagem: `Reenvio nº ${numero} por ${op.nome}: ${info.response}`
    })

    return { ok: true, numero, para, canal: conta.nome, resposta: info.response, emailAnterior, loteId: lote.id, loteNome: lote.nome }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await useDb().update(recipients).set({ ultimoErro: msg.slice(0, 1000) }).where(eq(recipients.id, r.id))
    const numero = await registrarEnvio({ ...base, status: 'erro', erro: msg })
    await registrarEvento(r.id, 'erro', { meta: { erro: msg, reenvio: true, envio: numero, por: op.nome } })
    bus.emitBatch({
      batchId: lote.id,
      tipo: 'erro',
      recipientId: r.id,
      email: para,
      codigo: r.codigo,
      status: r.status,
      mensagem: `Reenvio nº ${numero} falhou: ${msg}`
    })
    return { ok: false, numero, para, canal: conta.nome, erro: msg, emailAnterior, loteId: lote.id, loteNome: lote.nome }
  }
}

/**
 * Reenvio em massa pela FILA do lote: selecionados, ou todos que ainda nao
 * confirmaram a leitura.
 *
 * Vai pela fila, e nao em rajada, para respeitar o intervalo entre envios do
 * lote — mandar centenas de uma vez e o caminho mais curto para o spam. O
 * pedido (motivo, quem pediu, status anterior) fica em reenvio_pendente ate o
 * worker enviar e registrar o envio.
 */
export async function enfileirarReenvio(
  batchId: number,
  o: { ids?: number[]; naoConfirmou?: boolean; motivo: string },
  op: Operador
) {
  const [lote] = await useDb().select().from(batches).where(eq(batches.id, batchId))
  if (!lote || lote.excluidoEm) throw falha(404, 'Lote nao encontrado')
  if (!lote.startedAt) throw falha(400, 'Este lote ainda nao foi disparado.')

  // o status ANTERIOR vai junto no pedido: na atualizacao, ${recipients.status}
  // ainda e o valor antigo da linha
  const pedido = sql`jsonb_build_object(
      'motivo', ${o.motivo}::text,
      'porUserId', ${op.id}::int,
      'porNome', ${op.nome}::text,
      'pedidoEm', now(),
      'statusAnterior', ${recipients.status})`

  let alvo
  if (o.naoConfirmou) {
    alvo = and(eq(recipients.status, 'enviado'), isNull(recipients.confirmedAt))
  } else if (o.ids?.length) {
    alvo = and(inArray(recipients.status, REENVIAVEIS), inArray(recipients.id, o.ids))
  } else {
    throw falha(400, 'Escolha quem reenviar')
  }

  const enfileirados = await useDb()
    .update(recipients)
    .set({ status: 'pendente', tentativas: 0, lockedAt: null, reenvioPendente: pedido as never })
    .where(
      and(
        eq(recipients.batchId, batchId),
        isNull(recipients.reenvioPendente),
        alvo,
        // quem esta na supressao (devolveu definitivamente) fica de fora
        sql`not exists (select 1 from sys_mail_supressao s where s.email = ${recipients.email})`
      )
    )
    .returning({ id: recipients.id })
  const n = enfileirados.length

  if (!n) return { ok: true, enfileirados: 0, lote }

  // pedido explicito de reenvio: o lote volta a rodar, respeitando o intervalo
  if (!loteEmExecucao(batchId)) {
    await useDb().update(batches).set({ finishedAt: null }).where(eq(batches.id, batchId))
    await iniciarLote(batchId)
  }
  return { ok: true, enfileirados: n, lote }
}
