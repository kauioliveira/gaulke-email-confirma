import { z } from 'zod'
import { verificarDominios } from '../../../utils/dominios'
import { suprimidos } from '../../../utils/supressao'

const schema = z.object({ emails: z.array(z.string().max(320)).max(20000) })

/**
 * Domínios dos destinatários que não recebem e-mail, ou que parecem erro de
 * digitação. Chamado pela revisão do novo envio e pelo reenvio, ANTES de sair.
 */
export default defineEventHandler(async event => {
  const { emails } = validar(schema, await readBody(event))
  const [problemas, bloqueados] = await Promise.all([verificarDominios(emails), suprimidos(emails)])
  // suprimidos: devolveram definitivamente antes; mandar de novo so gera outra devolucao
  return { problemas, suprimidos: bloqueados }
})
