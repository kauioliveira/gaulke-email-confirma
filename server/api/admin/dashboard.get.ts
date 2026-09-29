import { useSql } from '../../db'
import { operadorAtual } from '../../utils/permissoes'
import { lerPeriodo } from '../../utils/periodo'

/**
 * Painel inicial: numeros do periodo, serie diaria, alertas e "minhas
 * pendencias". Tudo numa consulta por bloco, direto no Postgres — os numeros
 * saem agregados, nunca linha a linha para o navegador.
 *
 * O periodo vale para quando o e-mail SAIU (sent_at): a taxa de confirmacao e
 * "de quem recebeu no periodo, quantos confirmaram" (ate hoje), e nao
 * confirmacoes do periodo sobre envios de outros meses.
 */
export default defineEventHandler(async event => {
  const op = operadorAtual(event)
  const p = lerPeriodo(getQuery(event))
  const sql = useSql()

  const [kpis] = await sql<{
    lotes: number
    enviados: number
    confirmados: number
    aberturas_pessoa: number
    respostas: number
    devolucoes: number
    reenviados: number
    mediana_horas: number | null
  }[]>`
    select
      count(distinct r.batch_id)::int                                         as lotes,
      count(*)::int                                                           as enviados,
      count(r.confirmed_at)::int                                              as confirmados,
      count(r.first_human_open_at)::int                                       as aberturas_pessoa,
      count(r.respondeu_at)::int                                              as respostas,
      count(*) filter (where r.bounce_tipo = 'definitiva')::int               as devolucoes,
      count(*) filter (where exists (select 1 from sys_mail_envios e
                         where e.recipient_id = r.id and e.origem = 'reenvio'))::int as reenviados,
      percentile_cont(0.5) within group (
        order by extract(epoch from (r.confirmed_at - r.sent_at)) / 3600
      ) filter (where r.confirmed_at is not null and r.confirmed_at >= r.sent_at) as mediana_horas
    from sys_mail_recipients r
    join sys_mail_batches b on b.id = r.batch_id and b.excluido_em is null
    where r.sent_at between ${p.inicioIso}::timestamptz and ${p.fimIso}::timestamptz`

  // um ponto por dia do periodo, inclusive os dias sem envio (zero, e nao buraco)
  const serie = await sql<{ dia: string; enviados: number; confirmados: number }[]>`
    with dias as (
      select generate_series(${p.de}::date, ${p.ate}::date, interval '1 day')::date as dia
    ), env as (
      select (r.sent_at at time zone 'America/Sao_Paulo')::date as dia,
             count(*)::int as enviados,
             count(r.confirmed_at)::int as confirmados
        from sys_mail_recipients r
        join sys_mail_batches b on b.id = r.batch_id and b.excluido_em is null
       where r.sent_at between ${p.inicioIso}::timestamptz and ${p.fimIso}::timestamptz
       group by 1
    )
    select to_char(d.dia, 'YYYY-MM-DD') as dia, coalesce(e.enviados, 0) as enviados, coalesce(e.confirmados, 0) as confirmados
      from dias d left join env e on e.dia = d.dia
     order by d.dia`

  // alertas: o que precisa de alguem agora
  const [alertas] = await sql<{
    canais_falhando: string[] | null
    caixas_falhando: string[] | null
    chamados_erro: number
    pausados_sistema: number
    agendados_24h: number
  }[]>`
    select
      (select array_agg(nome) from sys_mail_accounts where ativa = 'true' and ultimo_teste_ok = 'false') as canais_falhando,
      (select array_agg(nome) from sys_mail_accounts where monitorar_caixa and imap_ultimo_erro is not null) as caixas_falhando,
      (select count(*)::int from sys_mail_tickets where status_envio = 'erro') as chamados_erro,
      (select count(*)::int from sys_mail_batches where status = 'pausado' and observacao is not null and excluido_em is null) as pausados_sistema,
      (select count(*)::int from sys_mail_batches where status = 'agendado' and excluido_em is null
          and agendado_para between now() and now() + interval '24 hours') as agendados_24h`

  // minhas pendencias: o que depende de QUEM esta olhando (lotes que criou)
  const minhas = op.id
    ? await sql<{ id: number; nome: string; status: string; motivo: string; n: number }[]>`
        select b.id, b.nome, b.status, x.motivo, x.n
          from sys_mail_batches b
          cross join lateral (
            select 'falhas' as motivo, b.falhas as n where b.falhas > 0
            union all
            select 'rascunho', b.total where b.status = 'rascunho'
            union all
            select 'devolucoes', count(*)::int from sys_mail_recipients r
             where r.batch_id = b.id and r.bounce_tipo = 'definitiva' having count(*) > 0
            union all
            select 'sem_confirmacao', count(*)::int from sys_mail_recipients r
             where r.batch_id = b.id and r.status = 'enviado' and r.confirmed_at is null
               and b.exigir_confirmacao = 'true' and b.finished_at < now() - interval '3 days'
            having count(*) > 0
          ) x
         where b.criado_por_user_id = ${op.id} and b.excluido_em is null and b.arquivado_em is null
         order by b.created_at desc
         limit 30`
    : []

  // solicitacoes de documentos que dependem de quem esta olhando
  const minhasSolic = op.id
    ? await sql<{ id: number; nome: string; motivo: string; n: number }[]>`
        select s.id,
               coalesce(s.codigo, 'SOL-' || lpad(s.id::text, 6, '0')) || ' · ' || coalesce(s.empresa, s.destinatario_nome, s.destinatario_email) as nome,
               x.motivo, x.n
          from sys_mail_solic s
          cross join lateral (
            select 'solic_analisar' as motivo, count(*)::int as n from sys_mail_solic_itens i
             where i.solic_id = s.id and (i.status = 'enviado' or (i.status = 'nao_possui' and i.analisado_em is null))
            having count(*) > 0
            union all
            select 'solic_avisar', count(*)::int from sys_mail_solic_itens i
             where i.solic_id = s.id and i.status = 'recusado' and i.recusa_avisada_em is null
            having count(*) > 0
            union all
            select 'solic_atrasada', 1 where s.status = 'aberta' and s.prazo < (now() at time zone 'America/Sao_Paulo')::date
            union all
            select 'solic_erro', 1 where s.envio_erro is not null
          ) x
         where s.criado_por_user_id = ${op.id} and s.status in ('aberta', 'em_analise')
         order by s.created_at desc
         limit 30`
    : []

  // certificado da Gaulke vencendo (30 dias) ou vencido
  const certsVencendo = await sql<{ nome: string; dias: number }[]>`
    select nome, floor(extract(epoch from (valido_ate - now())) / 86400)::int as dias
      from sys_mail_certificados
     where revogado_em is null and valido_ate < now() + interval '30 days'
     order by valido_ate`

  // assinaturas enviadas por quem esta olhando que pedem acao
  const minhasAssin = op.id
    ? await sql<{ id: number; nome: string; motivo: string; n: number }[]>`
        select d.id, coalesce(d.codigo, 'ASS-' || lpad(d.id::text, 6, '0')) || ' · ' || d.titulo as nome, x.motivo, x.n
          from sys_mail_assin_documentos d
          cross join lateral (
            select 'assin_recusado' as motivo, 1 as n where d.status = 'recusado' and d.created_at > now() - interval '30 days'
            union all
            select 'assin_final_erro', 1 where d.status = 'aguardando' and d.finalizacao_erro is not null
            union all
            select 'assin_email_erro', count(*)::int from sys_mail_assin_signatarios s
             where s.documento_id = d.id and s.status = 'aguardando' and s.envio_erro is not null having count(*) > 0
          ) x
         where d.criado_por_user_id = ${op.id}
         order by d.created_at desc
         limit 20`
    : []

  const k = kpis!
  return {
    periodo: { de: p.de, ate: p.ate },
    kpis: {
      lotes: k.lotes,
      enviados: k.enviados,
      confirmados: k.confirmados,
      taxaConfirmacao: k.enviados ? k.confirmados / k.enviados : null,
      aberturasPessoa: k.aberturas_pessoa,
      respostas: k.respostas,
      devolucoes: k.devolucoes,
      reenviados: k.reenviados,
      medianaHorasConfirmacao: k.mediana_horas === null ? null : Number(k.mediana_horas)
    },
    serie,
    alertas: {
      canaisFalhando: alertas?.canais_falhando ?? [],
      caixasFalhando: alertas?.caixas_falhando ?? [],
      chamadosErro: alertas?.chamados_erro ?? 0,
      pausadosSistema: alertas?.pausados_sistema ?? 0,
      agendados24h: alertas?.agendados_24h ?? 0,
      certificadosVencendo: certsVencendo
    },
    minhasPendencias: [
      ...minhasAssin.map(m => ({ ...m, status: 'assinatura', to: `/admin/assinaturas/${m.id}` })),
      ...minhasSolic.map(m => ({ ...m, status: 'solicitacao', to: `/admin/solicitacoes/${m.id}` })),
      ...minhas.map(m => ({ ...m, to: `/admin/lotes/${m.id}` }))
    ]
  }
})
