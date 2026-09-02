import { access, constants, writeFile, unlink } from 'node:fs/promises'
import { storageDir } from '../../utils/storage'
import { useDb } from '../../db'
import { sql } from 'drizzle-orm'

/**
 * Retrato do ambiente em que o app esta rodando AGORA.
 *
 * Existe porque "funciona em dev e nao em producao" quase sempre e ambiente —
 * permissao do volume, variavel faltando, banco inalcancavel — e sem isso a
 * unica forma de descobrir e entrar no container. Nao devolve segredo nenhum:
 * so se a variavel esta preenchida, nunca o valor.
 */
export default defineEventHandler(async () => {
  const dir = storageDir()

  const storage: Record<string, unknown> = { caminho: dir }
  try {
    await access(dir, constants.W_OK)
    // access() nao pega volume cheio nem somente-leitura: escreve de verdade
    const teste = `${dir}/.diagnostico-${Date.now()}`
    await writeFile(teste, 'ok')
    await unlink(teste)
    storage.gravavel = true
  } catch (e: any) {
    storage.gravavel = false
    storage.erro = `${e?.code || e?.name}: ${e?.message}`
  }

  const banco: Record<string, unknown> = {}
  const t0 = Date.now()
  try {
    await useDb().execute(sql`select 1`)
    banco.ok = true
    banco.ms = Date.now() - t0
  } catch (e: any) {
    banco.ok = false
    banco.erro = `${e?.code || e?.name}: ${e?.message}`
  }

  const cfg = useRuntimeConfig()
  const preenchida = (v: unknown) => Boolean(String(v ?? '').trim())

  return {
    node: process.version,
    plataforma: `${process.platform}/${process.arch}`,
    cwd: process.cwd(),
    usuario: typeof process.getuid === 'function' ? `uid ${process.getuid()}/gid ${process.getgid!()}` : 'n/d',
    memoriaMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    noArMin: Math.round(process.uptime() / 60),
    storage,
    banco,
    // presenca, nunca o valor
    variaveis: {
      DATABASE_URL: preenchida(cfg.databaseUrl),
      ADMIN_PASSWORD: preenchida(cfg.adminPassword),
      SESSION_SECRET: preenchida(cfg.sessionSecret),
      URL_ACESSO: cfg.public.urlAcesso || '(vazia)',
      STORAGE_DIR: cfg.storageDir || '(padrao)',
      NUXT_APP_BASE_URL: process.env.NUXT_APP_BASE_URL || '/',
      SMTP_HOST: cfg.smtp.host || '(vazio)',
      SMTP_USER: preenchida(cfg.smtp.user)
    }
  }
})
