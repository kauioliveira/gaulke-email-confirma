import { useSql } from '../../db'

/**
 * Busca pessoas do sistema da empresa para acrescentar a um envio.
 *
 * SOMENTE LEITURA, e com SQL puro de proposito: `users`, `client`, `department`
 * e `job_title` pertencem a OUTROS sistemas. Elas nao entram em
 * server/db/schema.ts justamente para nenhuma ferramenta de migration passar
 * perto delas — este banco e compartilhado.
 *
 * A empresa (`company`) ficou de fora porque a tabela NAO TEM coluna de
 * e-mail: um seletor de empresas nao teria para onde enviar.
 */

export type OrigemPessoa = 'equipe' | 'cliente'

type Pessoa = {
  chave: string
  origem: OrigemPessoa
  nome: string
  email: string
  detalhe: string | null
  documento: string | null
}

export default defineEventHandler(async event => {
  const q = getQuery(event)
  const busca = String(q.busca || '').trim()
  const origem = String(q.origem || 'todas')
  const limite = Math.min(300, Math.max(1, Number(q.limite || 100)))

  const sql = useSql()
  const termo = `%${busca}%`
  const resultado: Pessoa[] = []

  /**
   * O e-mail da equipe vem de `username`: a tabela nao tem coluna de e-mail,
   * mas o login E o endereco (75 de 76 em @contabilgaulke.com.br).
   */
  if (origem === 'todas' || origem === 'equipe') {
    const linhas = await sql<
      { id: number; nome: string; email: string; setor: string | null; cargo: string | null }[]
    >`
      select u.id,
             u.fullname            as nome,
             lower(u.username)     as email,
             d.name                as setor,
             j.name                as cargo
        from users u
        left join department d on d.id = u.department_id
        left join job_title  j on j.id = u.job_title_id
       where u.is_active
         and u.username like '%@%.%'
         and (${busca === ''} or u.fullname ilike ${termo} or u.username ilike ${termo}
              or d.name ilike ${termo})
       order by u.fullname
       limit ${limite}
    `

    for (const l of linhas) {
      resultado.push({
        chave: `equipe:${l.id}`,
        origem: 'equipe',
        nome: l.nome,
        email: l.email,
        detalhe: [l.setor, l.cargo].filter(Boolean).join(' · ') || null,
        documento: null
      })
    }
  }

  /**
   * Bloqueado, inativo ou falecido nao entra: sao situacoes em que disparar um
   * comunicado seria, no minimo, constrangedor.
   */
  if (origem === 'todas' || origem === 'cliente') {
    const linhas = await sql<
      { id: number; nome: string; email: string; codigo: string | null; doc: string | null }[]
    >`
      select c.id,
             c.name          as nome,
             lower(c.email)  as email,
             c.client_code   as codigo,
             c.cnpj_cpf      as doc
        from client c
       where c.email like '%@%.%'
         and coalesce(c.is_active, true)
         and not coalesce(c.is_deceased, false)
         and not coalesce(c.is_block, false)
         and (${busca === ''} or c.name ilike ${termo} or c.email ilike ${termo}
              or c.cnpj_cpf ilike ${termo} or c.client_code ilike ${termo})
       order by c.name
       limit ${limite}
    `

    for (const l of linhas) {
      resultado.push({
        chave: `cliente:${l.id}`,
        origem: 'cliente',
        nome: l.nome,
        email: l.email,
        detalhe: l.codigo ? `Cód. ${l.codigo}` : null,
        documento: l.doc
      })
    }
  }

  // totais sem filtro, para a tela dizer quantos existem ao todo
  const [totais] = await sql<{ equipe: number; cliente: number }[]>`
    select (select count(*)::int from users
             where is_active and username like '%@%.%') as equipe,
           (select count(*)::int from client
             where email like '%@%.%' and coalesce(is_active, true)
               and not coalesce(is_deceased, false) and not coalesce(is_block, false)) as cliente
  `

  return {
    pessoas: resultado.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    total: resultado.length,
    totais: totais ?? { equipe: 0, cliente: 0 }
  }
})
