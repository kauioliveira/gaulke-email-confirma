import { desc } from 'drizzle-orm'
import { useDb, templates } from '../../../db'
import { renderizarBlocos } from '../../../utils/blocos'

/**
 * O `html` de um template em modo blocos e cache: quem manda sao os blocos.
 *
 * Ele e gravado quando o template e salvo, entao envelhece sozinho toda vez que
 * a arte do e-mail muda (um cabecalho novo, por exemplo) — e um template salvo
 * meses atras continuaria devolvendo a marcacao antiga. Regerar na leitura
 * mantem o cache sempre em dia sem precisar reabrir e salvar cada template.
 */
export default defineEventHandler(async () => {
  const lista = await useDb().select().from(templates).orderBy(desc(templates.updatedAt))

  return {
    templates: lista.map(t =>
      t.formato === 'blocos' && Array.isArray(t.blocos) && t.blocos.length
        ? { ...t, html: renderizarBlocos(t.blocos as never, t.assunto) }
        : t
    )
  }
})
