import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { useSql } from '../db'

/**
 * Migrations aplicadas automaticamente no boot da aplicacao, em qualquer
 * ambiente. Sem variavel, sem passo manual: subiu, o schema esta pronto.
 *
 * Isso so e seguro porque:
 *  - os arquivos sao idempotentes (CREATE ... IF NOT EXISTS);
 *  - o que ja rodou fica registrado em sys_mail_migrations;
 *  - qualquer DROP/TRUNCATE e RECUSADO — este banco e compartilhado com os
 *    outros sistemas da empresa;
 *  - um advisory lock do Postgres serializa instancias subindo ao mesmo tempo.
 */

const DIR_PADRAO = 'server/db/migrations'

// chave arbitraria porem fixa do advisory lock: duas instancias subindo juntas
// esperam uma pela outra em vez de aplicarem o mesmo arquivo em paralelo
const LOCK_ID = 827011335

export type ResultadoMigrations = {
  ok: boolean
  aplicadas: string[]
  pendentesAntes: number
  erro?: string
  em: string
}

let ultimo: ResultadoMigrations | null = null

/** Estado da ultima execucao, exposto no /api/admin/status. */
export function estadoMigrations() {
  return ultimo
}

function diretorio() {
  return resolve(process.cwd(), process.env.MIGRATIONS_DIR || DIR_PADRAO)
}

export async function aplicarMigrations(): Promise<ResultadoMigrations> {
  const sql = useSql()
  const aplicadas: string[] = []
  let pendentesAntes = 0

  try {
    const dir = diretorio()
    const arquivos = (await readdir(dir)).filter(f => f.endsWith('.sql')).sort()

    if (!arquivos.length) {
      throw new Error(`nenhum arquivo .sql em ${dir}`)
    }

    await sql`
      create table if not exists sys_mail_migrations (
        nome        text primary key,
        aplicada_em timestamptz not null default now()
      )`

    const jaAplicadas = new Set(
      (await sql<{ nome: string }[]>`select nome from sys_mail_migrations`).map(r => r.nome)
    )
    const pendentes = arquivos.filter(f => !jaAplicadas.has(f))
    pendentesAntes = pendentes.length

    for (const arquivo of pendentes) {
      const conteudo = await readFile(resolve(dir, arquivo), 'utf8')

      const perigosa = /\b(drop|truncate)\s+(table|schema|type|sequence|database)\b/i.exec(conteudo)
      if (perigosa) {
        throw new Error(`${arquivo} contem "${perigosa[0]}" — revise manualmente antes de aplicar`)
      }

      await sql.begin(async tx => {
        // lock de transacao: liberado sozinho no commit ou no rollback
        await tx`select pg_advisory_xact_lock(${LOCK_ID}::bigint)`

        // outra instancia pode ter aplicado enquanto esperavamos o lock
        const [ja] = await tx<{ n: number }[]>`
          select count(*)::int n from sys_mail_migrations where nome = ${arquivo}`
        if ((ja?.n ?? 0) > 0) return

        await tx.unsafe(conteudo)
        await tx`insert into sys_mail_migrations (nome) values (${arquivo})`
        aplicadas.push(arquivo)
      })
    }

    ultimo = { ok: true, aplicadas, pendentesAntes, em: new Date().toISOString() }
  } catch (e) {
    ultimo = {
      ok: false,
      aplicadas,
      pendentesAntes,
      erro: e instanceof Error ? e.message : String(e),
      em: new Date().toISOString()
    }
  }

  return ultimo
}
