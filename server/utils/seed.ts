import { sql } from 'drizzle-orm'
import { useDb, templates } from '../db'
import { blocosPadrao, renderizarBlocos } from './blocos'

/**
 * Cria o template inicial na primeira execucao, se ainda nao houver nenhum.
 *
 * Nasce em BLOCOS, e nao em HTML: quem instala o sistema nao precisa saber
 * marcacao para comecar. O HTML e gerado a partir dos blocos, exatamente como
 * acontece quando alguem salva pelo editor visual.
 */
export async function garantirTemplatePadrao() {
  const db = useDb()
  const n = (await db.select({ n: sql<number>`count(*)::int` }).from(templates))[0]?.n ?? 0
  if (n > 0) return

  const assunto = 'Documento disponível para sua análise — {{codigo}}'
  const blocos = blocosPadrao()

  await db.insert(templates).values({
    nome: 'Padrão — Gaulke',
    assunto,
    formato: 'blocos',
    blocos: blocos as never,
    html: renderizarBlocos(blocos, assunto)
  })
  console.info('[gaulke-mail] template padrao criado (editor visual)')
}
