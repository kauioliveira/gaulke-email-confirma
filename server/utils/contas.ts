import { z } from 'zod'
import { sql, eq, ne, and, asc } from 'drizzle-orm'
import { useDb, accounts, type Account } from '../db'
import { cifrar, chaveConfigurada } from './cripto'
import { contaDoEnv, smtpConfig, type ContaSmtp } from './mailer'

/** Campos que a tela envia. A senha e opcional na edicao: vazia = manter a atual. */
export const contaSchema = z.object({
  nome: z.string().min(1).max(120),
  host: z.string().min(1).max(200),
  port: z.number().int().min(1).max(65535).default(587),
  secure: z.boolean().default(false),
  requireTls: z.boolean().default(true),
  rejectUnauthorized: z.boolean().default(true),
  usuario: z.string().min(1).max(200),
  senha: z.string().max(500).optional(),
  remetente: z.string().min(1).max(300),
  responderPara: z.string().max(300).optional(),
  padrao: z.boolean().default(false)
})

export type DadosConta = z.output<typeof contaSchema>

/**
 * O que a API devolve sobre uma conta.
 *
 * A senha NUNCA sai daqui, nem cifrada: quem lista contas nao precisa dela, e
 * um texto cifrado no JSON so daria a quem observa a rede o material para
 * tentar quebrar offline.
 */
export function serializar(a: Account) {
  return {
    id: a.id,
    nome: a.nome,
    host: a.host,
    port: a.port,
    secure: a.secure === 'true',
    requireTls: a.requireTls === 'true',
    rejectUnauthorized: a.rejectUnauthorized === 'true',
    usuario: a.usuario,
    remetente: a.remetente,
    responderPara: a.responderPara,
    ativa: a.ativa === 'true',
    padrao: a.padrao === 'true',
    ultimoTesteEm: a.ultimoTesteEm,
    ultimoTesteOk: a.ultimoTesteOk === null ? null : a.ultimoTesteOk === 'true',
    ultimoTesteMsg: a.ultimoTesteMsg,
    criadoPorNome: a.criadoPorNome,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt
  }
}

/** Monta a conta em memoria para testar ANTES de existir no banco. */
export function contaParaTeste(d: DadosConta, senha: string): ContaSmtp {
  return {
    id: null,
    nome: d.nome,
    enabled: true,
    host: d.host,
    port: d.port,
    secure: d.secure,
    requireTLS: d.requireTls,
    rejectUnauthorized: d.rejectUnauthorized,
    user: d.usuario,
    pass: senha,
    from: d.remetente,
    replyTo: d.responderPara || '',
    versao: 'teste'
  }
}

export function valoresParaBanco(d: DadosConta, senhaCifrada: string, criadoPorNome?: string | null) {
  return {
    nome: d.nome,
    host: d.host,
    port: d.port,
    secure: String(d.secure),
    requireTls: String(d.requireTls),
    rejectUnauthorized: String(d.rejectUnauthorized),
    usuario: d.usuario,
    senhaCifrada,
    remetente: d.remetente,
    responderPara: d.responderPara || null,
    padrao: String(d.padrao),
    ...(criadoPorNome ? { criadoPorNome } : {})
  }
}

/**
 * Garante que so exista uma conta padrao.
 *
 * O indice unico parcial do banco recusaria a segunda, entao rebaixar as outras
 * ANTES e o que evita um erro de constraint no meio de um salvamento legitimo.
 */
export async function rebaixarOutrasPadrao(idQueFicaPadrao: number) {
  await useDb()
    .update(accounts)
    .set({ padrao: 'false' })
    .where(and(eq(accounts.padrao, 'true'), ne(accounts.id, idQueFicaPadrao)))
}

export async function listarContas() {
  return (await useDb().select().from(accounts).orderBy(asc(accounts.nome))).map(serializar)
}

/**
 * Traz a conta do .env para o banco na primeira execucao.
 *
 * Existe para que ninguem precise recadastrar o que ja funcionava: o sistema
 * comeca com a conta do notifica ja cadastrada e editavel pela tela. Nao testa
 * a conexao — o boot nao pode depender do SMTP estar no ar — e por isso ela
 * nasce sem resultado de teste.
 */
export async function importarContaDoEnv() {
  if (!chaveConfigurada()) return null

  const db = useDb()
  const n = (await db.select({ n: sql<number>`count(*)::int` }).from(accounts))[0]?.n ?? 0
  if (n > 0) return null

  const c = smtpConfig()
  if (!c.host || !c.user) return null

  const [criada] = await db
    .insert(accounts)
    .values({
      nome: 'Notifica (importada do .env)',
      host: c.host,
      port: c.port,
      secure: String(c.secure),
      requireTls: String(c.requireTLS),
      rejectUnauthorized: String(c.rejectUnauthorized),
      usuario: c.user,
      senhaCifrada: cifrar(c.pass),
      remetente: c.from,
      responderPara: c.replyTo || null,
      ativa: 'true',
      padrao: 'true',
      criadoPorNome: 'importada do .env'
    })
    .returning()

  return criada ?? null
}

/** Usada pelo /api/admin/status para a barra dizer qual conta esta em uso. */
export function nomeDaContaDoEnv() {
  return contaDoEnv().nome
}
