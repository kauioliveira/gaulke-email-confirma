import { sql } from 'drizzle-orm'
import { useDb, useSql, empresaContatos } from '../db'
import type { ContatoEmpresa } from '../../shared/types/api'

/**
 * Contatos por empresa (CPF/CNPJ -> e-mails). A tabela company nao tem
 * e-mail: este cadastro aprende com cada envio e devolve as sugestoes na
 * busca de empresa (empresas.get.ts).
 */


type Linha = { documento?: string | null; email: string; nome?: string | null; empresa?: string | null }

/**
 * Soma um uso para cada par documento + e-mail. Nunca lanca: o envio ja
 * aconteceu e o aprendizado e um extra.
 */
export async function registrarContatosEmpresa(linhas: Linha[], origem: 'lote' | 'solicitacao' | 'importacao') {
  const validas = new Map<string, typeof empresaContatos.$inferInsert>()
  for (const l of linhas) {
    const documento = (l.documento || '').replace(/\D/g, '')
    const email = l.email.trim().toLowerCase()
    if ((documento.length !== 11 && documento.length !== 14) || !email.includes('@')) continue
    validas.set(`${documento}|${email}`, {
      documento,
      email,
      nome: l.nome?.trim().slice(0, 200) || null,
      empresa: l.empresa?.trim().slice(0, 200) || null,
      origem
    })
  }
  const valores = [...validas.values()]
  try {
    for (let i = 0; i < valores.length; i += 500) {
      await useDb()
        .insert(empresaContatos)
        .values(valores.slice(i, i + 500))
        .onConflictDoUpdate({
          target: [empresaContatos.documento, empresaContatos.email],
          set: {
            usos: sql`${empresaContatos.usos} + 1`,
            ultimoUso: sql`now()`,
            nome: sql`coalesce(excluded.nome, ${empresaContatos.nome})`,
            empresa: sql`coalesce(excluded.empresa, ${empresaContatos.empresa})`,
            // mandou de novo de proposito: o "esquecer" deixa de valer
            removidoEm: null
          }
        })
    }
  } catch (e) {
    console.error('[gaulke-mail] contatos por empresa', e instanceof Error ? e.message : e)
  }
}

/** Os e-mails mais recentes de cada documento (ate `porDoc`), marcando os suprimidos. */
export async function contatosDasEmpresas(documentos: string[], porDoc = 5) {
  const docs = [...new Set(documentos.filter(d => d.length === 11 || d.length === 14))]
  const mapa = new Map<string, ContatoEmpresa[]>()
  if (!docs.length) return mapa
  const linhas = await useSql()<
    { id: number; documento: string; email: string; nome: string | null; usos: number; ultimo_uso: Date; suprimido: boolean }[]
  >`
    select c.id, c.documento, c.email, c.nome, c.usos, c.ultimo_uso, (s.email is not null) as suprimido
      from (
        select *, row_number() over (partition by documento order by ultimo_uso desc, usos desc) as n
          from sys_mail_empresa_contatos
         where documento = any(${docs}) and removido_em is null
      ) c
      left join sys_mail_supressao s on s.email = c.email
     where c.n <= ${porDoc}
     order by c.documento, c.n`
  for (const l of linhas) {
    const lista = mapa.get(l.documento) ?? []
    lista.push({ id: l.id, email: l.email, nome: l.nome, usos: l.usos, ultimoUso: new Date(l.ultimo_uso).toISOString(), suprimido: l.suprimido })
    mapa.set(l.documento, lista)
  }
  return mapa
}

/** Empresas que so existem no historico de envios (fora de company/client). */
export async function empresasDoHistorico(termo: string, porDoc: string | null, limite = 10) {
  return useSql()<{ documento: string; empresa: string | null; nome: string | null }[]>`
    select distinct on (documento) documento, empresa, nome
      from sys_mail_empresa_contatos
     where removido_em is null
       and (empresa ilike ${termo} or nome ilike ${termo} or email ilike ${termo}
            or (${porDoc}::text is not null and documento like ${porDoc}))
     order by documento, ultimo_uso desc
     limit ${limite}`
}

export type CadastroDoDocumento = { nome: string; fantasia: string | null; ativo: boolean; origem: 'cadastro' | 'historico' }

/**
 * Quem e o dono de cada CPF/CNPJ: `company`, depois `client`, por ultimo o
 * historico de envios. SOMENTE LEITURA nas tabelas do outro sistema (veja
 * empresas.get.ts). Documento sem cadastro nenhum fica fora do mapa.
 */
export async function cadastrosDosDocumentos(documentos: string[]) {
  const docs = [...new Set(documentos.filter(d => d.length === 11 || d.length === 14))]
  const mapa = new Map<string, CadastroDoDocumento>()
  if (!docs.length) return mapa
  const sql = useSql()

  const empresas = await sql<{ doc: string; nome: string; fantasia: string | null; ativo: boolean | null }[]>`
    select regexp_replace(cnpj, '\\D', '', 'g') as doc, corporate_name as nome,
           nullif(trim(trade_name), '') as fantasia, is_active as ativo
      from company
     where regexp_replace(coalesce(cnpj, ''), '\\D', '', 'g') = any(${docs})
     order by coalesce(is_active, true)`
  // ordenado do inativo para o ativo: o ativo sobrescreve
  for (const e of empresas) {
    mapa.set(e.doc, { nome: e.nome, fantasia: e.fantasia && e.fantasia !== e.nome ? e.fantasia : null, ativo: e.ativo ?? true, origem: 'cadastro' })
  }

  const faltam = docs.filter(d => !mapa.has(d))
  if (faltam.length) {
    const pessoas = await sql<{ doc: string; nome: string; ativo: boolean }[]>`
      select regexp_replace(cnpj_cpf, '\\D', '', 'g') as doc, name as nome,
             coalesce(is_active, true) and not coalesce(is_deceased, false) as ativo
        from client
       where regexp_replace(coalesce(cnpj_cpf, ''), '\\D', '', 'g') = any(${faltam})
       order by coalesce(is_active, true)`
    for (const p of pessoas) mapa.set(p.doc, { nome: p.nome, fantasia: null, ativo: p.ativo, origem: 'cadastro' })
  }

  const doHistorico = docs.filter(d => !mapa.has(d))
  if (doHistorico.length) {
    const linhas = await sql<{ documento: string; empresa: string | null; nome: string | null }[]>`
      select distinct on (documento) documento, empresa, nome
        from sys_mail_empresa_contatos
       where documento = any(${doHistorico}) and removido_em is null
       order by documento, ultimo_uso desc`
    for (const h of linhas) {
      const nome = h.empresa || h.nome
      if (nome) mapa.set(h.documento, { nome, fantasia: null, ativo: true, origem: 'historico' })
    }
  }
  return mapa
}
