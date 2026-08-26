import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sql } from 'drizzle-orm'
import { useDb, templates } from '../db'

/** Cria o template inicial na primeira execucao, se ainda nao houver nenhum. */
export async function garantirTemplatePadrao() {
  const db = useDb()
  const n = (await db.select({ n: sql<number>`count(*)::int` }).from(templates))[0]?.n ?? 0
  if (n > 0) return

  let html = ''
  try {
    html = await readFile(resolve(process.cwd(), 'emails/default.html'), 'utf8')
  } catch {
    html = '<p>Ola {{nome}},</p><p><a href="{{link}}">Acessar documento</a></p><p>Codigo: {{codigo}}</p>'
  }

  await db.insert(templates).values({
    nome: 'Padrao — Gaulke',
    assunto: 'Documento disponivel para sua analise — {{codigo}}',
    html
  })
  console.info('[gaulke-mail] template padrao criado')
}
