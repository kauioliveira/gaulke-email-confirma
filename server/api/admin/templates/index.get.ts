import { desc, getTableColumns, isNull, sql } from 'drizzle-orm'
import { useDb, templates } from '../../../db'
import { renderizarBlocos } from '../../../utils/blocos'

/**
 * Lista de templates, sem os arquivados (a menos que ?arquivados=1).
 *
 * O `html` de um template em modo blocos e cache: quem manda sao os blocos.
 * Ele e gravado quando o template e salvo, entao envelhece sozinho toda vez que
 * a arte do e-mail muda (um cabecalho novo, por exemplo) — e um template salvo
 * meses atras continuaria devolvendo a marcacao antiga. Regerar na leitura
 * mantem o cache sempre em dia sem precisar reabrir e salvar cada template.
 */
export default defineEventHandler(async event => {
  const q = getQuery(event)
  const comArquivados = ['1', 'true', 'sim'].includes(String(q.arquivados || '').toLowerCase())

  const lista = await useDb()
    .select({
      ...getTableColumns(templates),
      // envios disparados com ele; qualificado a mao porque, dentro de sql``,
      // o drizzle escreveria so "id" — que na subconsulta seria o do lote
      usos: sql<number>`(select count(*)::int from sys_mail_batches b
                          where b.template_id = sys_mail_templates.id and b.status <> 'rascunho')`
    })
    .from(templates)
    .where(comArquivados ? undefined : isNull(templates.arquivadoEm))
    .orderBy(desc(templates.updatedAt))

  return {
    templates: lista.map(t =>
      t.formato === 'blocos' && Array.isArray(t.blocos) && t.blocos.length
        ? { ...t, html: renderizarBlocos(t.blocos as never, t.assunto) }
        : t
    ),
    // categorias ja usadas, para o filtro e para sugerir no cadastro
    categorias: [...new Set(lista.map(t => t.categoria).filter((c): c is string => !!c))].sort()
  }
})
