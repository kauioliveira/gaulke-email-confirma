/**
 * Aplica os arquivos .sql de server/db/migrations em ordem.
 *
 * Substitui o `drizzle-kit push`, que compara o schema INTEIRO do banco e
 * gera DROP das tabelas dos outros sistemas da empresa. Aqui so roda o SQL
 * que escrevemos, e ele so cria objetos sys_mail_*.
 */
import { readdir, readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dir = resolve(raiz, 'server/db/migrations')

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL nao definida. Rode com: node --env-file=.env scripts/migrate.mjs')
  process.exit(1)
}

const sql = postgres(url, { max: 1 })

try {
  await sql`
    create table if not exists sys_mail_migrations (
      nome       text primary key,
      aplicada_em timestamptz not null default now()
    )`

  const aplicadas = new Set((await sql`select nome from sys_mail_migrations`).map(r => r.nome))
  const arquivos = (await readdir(dir)).filter(f => f.endsWith('.sql')).sort()

  let n = 0
  for (const arquivo of arquivos) {
    if (aplicadas.has(arquivo)) {
      console.log(`· ${arquivo} (ja aplicada)`)
      continue
    }
    const conteudo = await readFile(resolve(dir, arquivo), 'utf8')

    // trava de seguranca: recusa qualquer migration que mexa fora do nosso prefixo
    const perigosa = /\b(drop|truncate)\s+(table|schema|type|sequence|database)\b/i.exec(conteudo)
    if (perigosa) {
      throw new Error(`${arquivo} contem "${perigosa[0]}" — revise manualmente antes de aplicar`)
    }

    await sql.begin(async tx => {
      await tx.unsafe(conteudo)
      await tx`insert into sys_mail_migrations (nome) values (${arquivo})`
    })
    console.log(`✓ ${arquivo}`)
    n++
  }

  console.log(n ? `\n${n} migration(s) aplicada(s).` : '\nBanco ja estava atualizado.')
} finally {
  await sql.end()
}
