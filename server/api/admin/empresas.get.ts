import { useSql } from '../../db'

/**
 * Busca de clientes da Gaulke para "Referente a" (assinatura e afins): as
 * empresas de `company` e as pessoas de `client`, por nome, fantasia ou
 * CPF/CNPJ.
 *
 * SOMENTE LEITURA e com SQL puro: as tabelas sao de outro sistema e nao
 * entram no schema deste (veja pessoas.get.ts).
 */
export type EmpresaEncontrada = {
  nome: string
  fantasia: string | null
  documento: string | null
  tipo: 'empresa' | 'pessoa'
  ativo: boolean
}

export default defineEventHandler(async (event): Promise<EmpresaEncontrada[]> => {
  const busca = String(getQuery(event).busca || '').trim()
  if (busca.length < 2) return []
  const termo = `%${busca}%`
  const digitos = busca.replace(/\D/g, '')
  const porDoc = digitos.length >= 3 ? `%${digitos}%` : null
  const sql = useSql()

  const empresas = await sql<{ nome: string; fantasia: string | null; doc: string | null; ativo: boolean | null }[]>`
    select corporate_name as nome, nullif(trim(trade_name), '') as fantasia, cnpj as doc, is_active as ativo
      from company
     where corporate_name ilike ${termo} or trade_name ilike ${termo} or alias_company ilike ${termo}
        or (${porDoc}::text is not null and regexp_replace(coalesce(cnpj, ''), '\\D', '', 'g') like ${porDoc})
     order by coalesce(is_active, true) desc, corporate_name
     limit 15`

  const pessoas = await sql<{ nome: string; doc: string | null; ativo: boolean | null }[]>`
    select name as nome, cnpj_cpf as doc, coalesce(is_active, true) and not coalesce(is_deceased, false) as ativo
      from client
     where name ilike ${termo}
        or (${porDoc}::text is not null and regexp_replace(coalesce(cnpj_cpf, ''), '\\D', '', 'g') like ${porDoc})
     order by coalesce(is_active, true) desc, name
     limit 10`

  const so = (v: string | null) => {
    const d = (v || '').replace(/\D/g, '')
    return d.length === 11 || d.length === 14 ? d : null
  }
  const vistos = new Set<string>()
  const saida: EmpresaEncontrada[] = []
  for (const e of empresas) {
    const doc = so(e.doc)
    if (doc && vistos.has(doc)) continue
    if (doc) vistos.add(doc)
    saida.push({ nome: e.nome, fantasia: e.fantasia && e.fantasia !== e.nome ? e.fantasia : null, documento: doc, tipo: 'empresa', ativo: e.ativo ?? true })
  }
  for (const p of pessoas) {
    const doc = so(p.doc)
    if (doc && vistos.has(doc)) continue
    if (doc) vistos.add(doc)
    saida.push({ nome: p.nome, fantasia: null, documento: doc, tipo: doc?.length === 14 ? 'empresa' : 'pessoa', ativo: p.ativo ?? true })
  }
  return saida
})
