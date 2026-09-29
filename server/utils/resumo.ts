import { useSql } from '../db'

/**
 * Relatorio RESUMIDO de um periodo (dias de Sao Paulo), agregado no Postgres.
 * Usado pela tela e pela exportacao XLSX — a mesma funcao, os mesmos numeros.
 *
 * Periodo = quando o e-mail saiu (sent_at). Lotes na lixeira ficam de fora.
 */

export type LinhaFunil = {
  grupo: string
  lotes: number
  enviados: number
  aberturas: number
  acessos: number
  confirmados: number
  downloads: number
  respostas: number
  devolucoes: number
}

export async function montarResumo(inicio: Date, fim: Date) {
  // texto ISO: o driver do drizzle nao serializa Date no SQL cru (veja periodo.ts)
  const de = inicio.toISOString()
  const ate = fim.toISOString()
  const sql = useSql()

  // o mesmo conjunto de contagens, agrupado de formas diferentes
  const colunas = sql`
    count(distinct r.batch_id)::int                                 as lotes,
    count(*)::int                                                   as enviados,
    count(r.first_human_open_at)::int                               as aberturas,
    count(r.first_access_at)::int                                   as acessos,
    count(r.confirmed_at)::int                                      as confirmados,
    count(r.first_download_at)::int                                 as downloads,
    count(r.respondeu_at)::int                                      as respostas,
    count(*) filter (where r.bounce_tipo = 'definitiva')::int       as devolucoes`
  const origem = sql`
    from sys_mail_recipients r
    join sys_mail_batches b on b.id = r.batch_id and b.excluido_em is null`
  const filtro = sql`where r.sent_at between ${de}::timestamptz and ${ate}::timestamptz`
  const base = sql`${origem} ${filtro}`

  const [porLote, porUsuario, porSetor, porCanal] = await Promise.all([
    sql<(LinhaFunil & { loteId: number; disparadoEm: Date | null })[]>`
      select b.nome as grupo, b.id as "loteId", min(b.started_at) as "disparadoEm", ${colunas}
      ${base}
      group by b.id, b.nome
      order by min(b.started_at) desc nulls last
      limit 200`,
    sql<LinhaFunil[]>`
      select coalesce(b.criado_por_nome, '(sem autoria)') as grupo, ${colunas}
      ${base}
      group by 1 order by enviados desc`,
    // setor de quem criou o lote, no cadastro do painel (sistema legado)
    sql<LinhaFunil[]>`
      select coalesce(d.name, '(sem setor)') as grupo, ${colunas}
      ${origem}
      left join public.users u on u.id = b.criado_por_user_id
      left join public.department d on d.id = u.department_id
      ${filtro}
      group by 1 order by enviados desc`.catch(() => [] as LinhaFunil[]),
    sql<LinhaFunil[]>`
      select coalesce(b.conta_nome, 'SMTP do .env') as grupo, ${colunas}
      ${base}
      group by 1 order by enviados desc`
  ])

  // quem recebeu 2+ envios e nunca confirmou nenhum: o retrabalho de sempre
  const nuncaConfirmam = await sql<{ email: string; nome: string | null; empresa: string | null; envios: number; ultimoEnvio: Date }[]>`
    select r.email, max(r.nome) as nome, max(r.empresa) as empresa,
           count(*)::int as envios, max(r.sent_at) as "ultimoEnvio"
      ${base}
       and b.exigir_confirmacao = 'true'
     group by r.email
    having count(*) >= 2 and count(r.confirmed_at) = 0
     order by count(*) desc, max(r.sent_at) desc
     limit 100`

  // devolucoes definitivas por dominio: dominio errado, cliente que trocou de provedor
  const devolucoesPorDominio = await sql<{ dominio: string; devolucoes: number; enderecos: number }[]>`
    select split_part(r.email, '@', 2) as dominio,
           count(*)::int as devolucoes,
           count(distinct r.email)::int as enderecos
      ${base}
       and r.bounce_tipo = 'definitiva'
     group by 1
     order by 2 desc
     limit 50`

  return { porLote, porUsuario, porSetor, porCanal, nuncaConfirmam, devolucoesPorDominio }
}
