import { useSql } from '../db'
import { iniciarLote } from './sender'
import { useBatchBus } from './sse'
import { processarFilaTickets, verificarSemConfirmacao } from './painel-tickets'
import { processarQuarentena, enviarLembretes, avisarEntregasConcluidas } from './solicitacoes'
import { lembrarSignatarios } from './assinatura'
import { lembrarComunicados } from './lembretes'
import { processarWebhooks } from './webhooks'
import { retencaoDiaria } from './retencao'

/**
 * Dispara lotes marcados para uma data e hora.
 *
 * Varre a cada 30s em vez de agendar um timer por lote: um timer em memoria
 * morre junto com o processo, e o agendamento precisa sobreviver a reinicio —
 * a verdade fica no banco, como acontece com a fila de envio.
 */

const INTERVALO_MS = 30_000

/**
 * Ate quanto tempo de atraso ainda vale disparar sozinho.
 *
 * Se a aplicacao ficou fora do ar no horario marcado, um comunicado agendado
 * para as 8h nao deve sair sozinho as 15h, sem ninguem acompanhando. Passado
 * este limite o lote fica PAUSADO com o motivo na tela, esperando alguem
 * confirmar.
 */
const TOLERANCIA_MIN = Number(process.env.AGENDAMENTO_TOLERANCIA_MIN) || 120

let timer: ReturnType<typeof setInterval> | null = null

export function toleranciaMinutos() {
  return TOLERANCIA_MIN
}

/**
 * Reivindica os lotes vencidos com um UPDATE atomico: so quem ganhar a linha
 * segue adiante. Sem isso, duas instancias subindo juntas dispariam o mesmo
 * lote (os e-mails nao duplicariam, porque o envio usa FOR UPDATE SKIP LOCKED,
 * mas dois workers competindo pela mesma fila e desperdicio e confunde o log).
 */
async function dispararVencidos() {
  const sql = useSql()

  const vencidos = await sql<{ id: number; nome: string }[]>`
    update sys_mail_batches
       set status = 'enviando', observacao = null
     where status = 'agendado'
       and excluido_em is null
       and agendado_para <= now()
       and agendado_para > now() - make_interval(mins => ${TOLERANCIA_MIN})
    returning id, nome
  `

  for (const lote of vencidos) {
    console.info(`[gaulke-mail] agendamento disparando lote #${lote.id} (${lote.nome})`)
    try {
      await iniciarLote(lote.id)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await sql`
        update sys_mail_batches
           set status = 'erro', observacao = ${`Falha ao iniciar pelo agendamento: ${msg}`}
         where id = ${lote.id}`
      console.error(`[gaulke-mail] agendamento falhou no lote #${lote.id}: ${msg}`)
    }
  }
}

/** Passou da tolerancia: nao dispara sozinho, pausa e explica. */
async function pausarAtrasados() {
  const sql = useSql()
  const motivo =
    `O horario agendado passou ha mais de ${TOLERANCIA_MIN} minutos ` +
    `enquanto o sistema estava fora do ar. O disparo NAO foi feito ` +
    `automaticamente para nao sair em hora inadequada — inicie manualmente ` +
    `quando quiser.`

  const atrasados = await sql<{ id: number; nome: string }[]>`
    update sys_mail_batches
       set status = 'pausado', observacao = ${motivo}
     where status = 'agendado'
       and excluido_em is null
       and agendado_para <= now() - make_interval(mins => ${TOLERANCIA_MIN})
    returning id, nome
  `

  for (const lote of atrasados) {
    console.warn(`[gaulke-mail] agendamento vencido no lote #${lote.id} (${lote.nome}) — pausado`)
    useBatchBus().emitBatch({
      batchId: lote.id,
      tipo: 'pausado',
      mensagem: motivo
    })
  }
}

/** "sem confirmacao em N dias" e dia a dia: nao precisa rodar a cada 30s */
const SEM_CONFIRMACAO_MS = 10 * 60_000
let ultimaSemConfirmacao = 0
let ultimosLembretes = 0
let ultimaRetencao = 0

export async function verificarAgendados() {
  try {
    // atrasados primeiro: assim um lote muito vencido nunca chega a ser
    // reivindicado por dispararVencidos numa volta seguinte
    await pausarAtrasados()
    await dispararVencidos()
  } catch (e) {
    console.error('[gaulke-mail] agendador:', e instanceof Error ? e.message : e)
  }

  // chamados no painel: a fila e tentada a cada volta (a espera entre
  // tentativas fica na propria fila)
  try {
    if (Date.now() - ultimaSemConfirmacao > SEM_CONFIRMACAO_MS) {
      ultimaSemConfirmacao = Date.now()
      await verificarSemConfirmacao()
    }
    await processarFilaTickets()
  } catch (e) {
    console.error('[gaulke-mail] chamados no painel:', e instanceof Error ? e.message : e)
  }

  // solicitacoes de documentos: arquivos presos na quarentena (clamd fora),
  // aviso a quem pediu e lembretes ao cliente
  try {
    await processarQuarentena()
    await avisarEntregasConcluidas()
    if (Date.now() - ultimosLembretes > SEM_CONFIRMACAO_MS) {
      ultimosLembretes = Date.now()
      await enviarLembretes()
      await lembrarSignatarios()
      await lembrarComunicados()
    }
  } catch (e) {
    console.error('[gaulke-mail] solicitacoes:', e instanceof Error ? e.message : e)
  }

  // webhooks: a fila e entregue a cada volta (as esperas ficam na propria fila)
  await processarWebhooks()

  // retencao LGPD: uma vez por dia; a propria rotina sabe se ja rodou hoje
  try {
    if (Date.now() - ultimaRetencao > SEM_CONFIRMACAO_MS) {
      ultimaRetencao = Date.now()
      await retencaoDiaria()
    }
  } catch (e) {
    console.error('[gaulke-mail] retencao:', e instanceof Error ? e.message : e)
  }
}

export function iniciarAgendador() {
  if (timer) return
  // uma volta imediata no boot: cobre o que venceu enquanto o app estava fora
  void verificarAgendados()
  timer = setInterval(() => void verificarAgendados(), INTERVALO_MS)
  timer.unref?.()
  console.info(`[gaulke-mail] agendador ativo (tolerancia de ${TOLERANCIA_MIN} min)`)
}
