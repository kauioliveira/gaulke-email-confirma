import { useSql } from '../db'
import { iniciarLote, loteEmExecucao } from './sender'

/**
 * Lembrete automatico nos comunicados: quem nao confirmou em N dias recebe o
 * MESMO e-mail de novo (mesmo link, mesmo codigo), com "Lembrete:" no assunto,
 * ate o limite do lote.
 *
 * O lembrete vai pela FILA do lote, como o "reenviar para quem nao confirmou":
 * respeita o intervalo entre envios e fica numerado no historico da pessoa
 * (sys_mail_envios, origem 'lembrete'). So em dia util das 8h as 18h.
 *
 * Ficam de fora: lote na lixeira ou arquivado (quem arquivou deu o assunto por
 * encerrado), quem confirmou, quem devolveu, quem esta na supressao e quem ja
 * tem um reenvio esperando na fila.
 */
export async function lembrarComunicados() {
  if (!emHorarioComercialSP()) return { lotes: 0, pessoas: 0 }
  const sql = useSql()

  const enfileirados = await sql<{ batch_id: number }[]>`
    update sys_mail_recipients r
       set status = 'pendente',
           tentativas = 0,
           locked_at = null,
           lembretes_enviados = r.lembretes_enviados + 1,
           ultimo_lembrete_em = now(),
           reenvio_pendente = jsonb_build_object(
             'motivo', 'Lembrete automático ' || (r.lembretes_enviados + 1) || ' de ' || b.lembrete_max,
             'porUserId', null,
             'porNome', 'Lembrete automático',
             'pedidoEm', now(),
             'statusAnterior', r.status,
             'lembrete', true)
      from sys_mail_batches b
     where b.id = r.batch_id
       and b.status = 'concluido'
       and b.excluido_em is null
       and b.arquivado_em is null
       and b.lembrete_dias is not null
       and b.lembrete_max > 0
       and r.status = 'enviado'
       and r.confirmed_at is null
       and r.bounce_at is null
       and r.reenvio_pendente is null
       and r.lembretes_enviados < b.lembrete_max
       and coalesce(r.ultimo_lembrete_em, r.sent_at) < now() - make_interval(days => b.lembrete_dias)
       and not exists (select 1 from sys_mail_supressao s where s.email = r.email)
    returning r.batch_id`

  const lotes = [...new Set(enfileirados.map(e => e.batch_id))]
  for (const id of lotes) {
    if (loteEmExecucao(id)) continue
    try {
      await iniciarLote(id)
      console.info(`[gaulke-mail] lembrete automatico: lote #${id}, ${enfileirados.filter(e => e.batch_id === id).length} pessoa(s)`)
    } catch (e) {
      console.error(`[gaulke-mail] lembrete do lote #${id}:`, e instanceof Error ? e.message : e)
    }
  }
  return { lotes: lotes.length, pessoas: enfileirados.length }
}
