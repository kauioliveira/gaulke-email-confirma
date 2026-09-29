import { useSql } from '../db'

/**
 * Historico de envios de cada destinatario (sys_mail_envios).
 *
 * O numero e calculado no proprio INSERT (maior numero do destinatario + 1).
 * Dois envios simultaneos para a MESMA pessoa — um reenvio individual clicado
 * enquanto o lote a reenvia pela fila — colidiriam no indice unico
 * (recipient_id, numero); nesse caso tentamos de novo com o numero seguinte.
 */

export type NovoEnvio = {
  recipientId: number
  origem: 'lote' | 'reenvio' | 'lembrete'
  para: string
  messageId?: string | null
  contaId?: number | null
  contaNome?: string | null
  responderPara?: string | null
  status: 'enviado' | 'erro'
  erro?: string | null
  /** resposta do servidor SMTP: e o que rastreia a mensagem no log dele */
  respostaSmtp?: string | null
  motivo?: string | null
  porUserId?: number | null
  porNome?: string | null
}

export async function registrarEnvio(e: NovoEnvio): Promise<number> {
  const sql = useSql()
  for (let tentativa = 0; ; tentativa++) {
    try {
      const [linha] = await sql<{ numero: number }[]>`
        insert into sys_mail_envios
          (recipient_id, numero, origem, para, message_id, conta_id, conta_nome, responder_para,
           status, erro, resposta_smtp, motivo, enviado_por_user_id, enviado_por_nome)
        values (
          ${e.recipientId},
          (select coalesce(max(numero), 0) + 1 from sys_mail_envios where recipient_id = ${e.recipientId}),
          ${e.origem}, ${e.para}, ${e.messageId ?? null}, ${e.contaId ?? null}, ${e.contaNome ?? null},
          ${e.responderPara ?? null}, ${e.status}, ${e.erro?.slice(0, 1000) ?? null},
          ${e.respostaSmtp?.slice(0, 1000) ?? null}, ${e.motivo ?? null},
          ${e.porUserId ?? null}, ${e.porNome ?? null}
        )
        returning numero`
      return linha!.numero
    } catch (err) {
      const codigo = (err as { code?: string })?.code
      if (codigo !== '23505' || tentativa >= 3) throw err
    }
  }
}
