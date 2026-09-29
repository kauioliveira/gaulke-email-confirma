import { eq } from 'drizzle-orm'
import { useDb, templates } from '../../../db'
import { exigirPapel } from '../../../utils/permissoes'
import { auditar } from '../../../utils/auditoria'
import { exigirPodeMexer, usosDoTemplate } from '../../../utils/templates'

/**
 * Exclui um template (item 7 do briefing).
 *
 *  - ja usado em lote disparado: so supervisor/admin. Os lotes guardam
 *    snapshot do conteudo, entao nada enviado muda — o corte existe para o
 *    modelo de um setor nao sumir por engano. Para os demais, a saida e
 *    ARQUIVAR (some da lista, nao apaga);
 *  - oficial: so supervisor/admin;
 *  - sem uso: qualquer um, com a dupla confirmacao feita na tela.
 */
export default defineEventHandler(async event => {
  const id = Number(getRouterParam(event, 'id'))
  const db = useDb()

  const [t] = await db.select().from(templates).where(eq(templates.id, id))
  if (!t) throw createError({ statusCode: 404, statusMessage: 'Template nao encontrado' })
  exigirPodeMexer(event, t, 'excluí-lo')

  const usos = await usosDoTemplate(id)
  if (usos > 0) {
    exigirPapel(event, 'supervisor', `excluir um template já usado em ${usos} envio(s). Você pode arquivá-lo`)
  }

  // as versoes caem junto (ON DELETE CASCADE); os lotes ficam com template_id nulo
  await db.delete(templates).where(eq(templates.id, id))

  await auditar(event, 'template.excluir', {
    entidade: 'template',
    id,
    resumo: `Excluiu o template "${t.nome}"` + (usos ? ` (usado em ${usos} envio(s))` : ''),
    dados: { nome: t.nome, assunto: t.assunto, formato: t.formato, tipo: t.tipo, usos, criadoPor: t.criadoPorNome }
  })

  return { ok: true }
})
