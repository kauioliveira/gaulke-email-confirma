import { useSql } from '../../../db'

/**
 * Cadastro de contatos por empresa (CPF/CNPJ -> e-mail), para a tela de
 * consulta e correcao. Busca por documento, e-mail, nome ou empresa.
 */
export default defineEventHandler(async event => {
  const q = getQuery(event)
  const busca = String(q.busca || '').trim()
  const pagina = Math.max(1, Number(q.pagina) || 1)
  const porPagina = 50
  const termo = busca ? `%${busca}%` : null
  const digitos = busca.replace(/\D/g, '')
  const porDoc = digitos.length >= 3 ? `%${digitos}%` : null
  const sql = useSql()

  // colunas qualificadas: a listagem junta a supressao, que tambem tem `email`
  const filtro = sql`c.removido_em is null and (
    ${termo}::text is null
    or c.email ilike ${termo} or c.nome ilike ${termo} or c.empresa ilike ${termo}
    or (${porDoc}::text is not null and c.documento like ${porDoc}))`

  const [linhas, [total]] = await Promise.all([
    sql<{ id: number; documento: string; email: string; nome: string | null; empresa: string | null; origem: string; usos: number; ultimo_uso: Date; suprimido: boolean }[]>`
      select c.id, c.documento, c.email, c.nome, c.empresa, c.origem, c.usos, c.ultimo_uso,
             (s.email is not null) as suprimido
        from sys_mail_empresa_contatos c
        left join sys_mail_supressao s on s.email = c.email
       where ${filtro}
       order by c.documento, c.ultimo_uso desc
       limit ${porPagina} offset ${(pagina - 1) * porPagina}`,
    sql<{ n: number }[]>`select count(*)::int as n from sys_mail_empresa_contatos c where ${filtro}`
  ])

  return {
    total: total?.n ?? 0,
    pagina,
    porPagina,
    contatos: linhas.map(l => ({
      id: l.id,
      documento: l.documento,
      email: l.email,
      nome: l.nome,
      empresa: l.empresa,
      origem: l.origem,
      usos: l.usos,
      ultimoUso: new Date(l.ultimo_uso).toISOString(),
      suprimido: l.suprimido
    }))
  }
})
