import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

/**
 * ATENCAO: use apenas `drizzle-kit studio` com esta config.
 *
 * NAO rode `drizzle-kit push` neste banco: ele compara o schema inteiro e
 * gera DROP das tabelas dos outros sistemas da empresa (o tablesFilter nao
 * impediu isso na pratica). Para alterar o schema, escreva um arquivo em
 * server/db/migrations e rode `npm run db:migrate`.
 */
export default defineConfig({
  schema: './server/db/schema.ts',
  out: './server/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!
  },
  // Nao mexe em tabelas de outros sistemas: so as com prefixo sys_mail_
  tablesFilter: ['sys_mail_*'],
  verbose: true,
  strict: true
})
