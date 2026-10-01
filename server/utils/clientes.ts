import { useSql } from '../db'
import { renderizarAssunto } from './render'
import type {
  ClienteEncontrado,
  ItemLinhaCliente,
  LinhaDoTempoCliente,
  ModuloLinha,
  StatusAssinatura,
  StatusSignatario,
  StatusSolicitacao
} from '../../shared/types/api'

/**
 * Linha do tempo do cliente: tudo que a Gaulke enviou, pediu e assinou com
 * uma pessoa ou empresa, numa tela so.
 *
 * O "cliente" e um conjunto de e-mails e CPF/CNPJ. Comecando por um e-mail,
 * entram tambem os documentos que ja apareceram com ele; comecando por um
 * CNPJ, entram todos os e-mails que ja apareceram com ele (o socio, o
 * financeiro, o contador interno). Um passo so, sem seguir a corrente — senao
 * um e-mail generico ligado a dois CNPJs juntaria clientes diferentes.
 */

const soDigitos = (v: string) => v.replace(/\D/g, '')

/** Todas as aparicoes de pessoas no sistema, de todos os modulos. */
const PESSOAS = `
  select lower(r.email) as email, r.nome, r.empresa, r.documento, coalesce(r.sent_at, r.created_at) as quando, 'comunicado' as modulo
    from sys_mail_recipients r join sys_mail_batches b on b.id = r.batch_id and b.excluido_em is null
  union all
  select lower(destinatario_email), destinatario_nome, empresa, documento, created_at, 'solicitacao' from sys_mail_solic
  union all
  select lower(s.email), s.nome, d.cliente_nome, coalesce(s.cpf, d.cliente_documento), d.created_at, 'assinatura'
    from sys_mail_assin_signatarios s join sys_mail_assin_documentos d on d.id = s.documento_id
  union all
  select lower(email), nome, empresa, documento, adicionado_em, 'lista' from sys_mail_lista_membros`

export async function buscarClientes(termo: string): Promise<ClienteEncontrado[]> {
  const q = termo.trim()
  if (q.length < 2) return []
  const digitos = soDigitos(q)
  // "123.456" e busca por documento; "maria" e por nome/e-mail
  const porDocumento = digitos.length >= 5 && !/[a-z@]/i.test(q)
  const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`
  const sql = useSql()
  const linhas = await sql.unsafe<
    { email: string; nome: string | null; empresa: string | null; documento: string | null; comunicados: number; solicitacoes: number; assinaturas: number; ultimo_em: Date | null }[]
  >(
    `with pessoas as (${PESSOAS})
     select email,
            (array_agg(nome order by quando desc) filter (where coalesce(nome, '') <> ''))[1] as nome,
            (array_agg(empresa order by quando desc) filter (where coalesce(empresa, '') <> ''))[1] as empresa,
            (array_agg(documento order by quando desc) filter (where coalesce(documento, '') <> ''))[1] as documento,
            count(*) filter (where modulo = 'comunicado')::int as comunicados,
            count(*) filter (where modulo = 'solicitacao')::int as solicitacoes,
            count(*) filter (where modulo = 'assinatura')::int as assinaturas,
            max(quando) filter (where modulo <> 'lista') as ultimo_em
       from pessoas
      where email in (
        select email from pessoas
         where ${porDocumento ? `documento like $1` : `email ilike $1 or nome ilike $1 or empresa ilike $1`})
      group by email
      order by max(quando) filter (where modulo <> 'lista') desc nulls last, email
      limit 40`,
    [porDocumento ? `${digitos}%` : like]
  )
  return linhas.map(l => ({
    email: l.email,
    nome: l.nome,
    empresa: l.empresa,
    documento: l.documento,
    comunicados: l.comunicados,
    solicitacoes: l.solicitacoes,
    assinaturas: l.assinaturas,
    ultimoEm: l.ultimo_em ? new Date(l.ultimo_em).toISOString() : null
  }))
}

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null)

function statusComunicado(r: {
  status: string
  bounce_tipo: string | null
  confirmed_at: Date | null
  first_download_at: Date | null
  first_access_at: Date | null
  first_human_open_at: Date | null
}): Pick<ItemLinhaCliente, 'status' | 'cor'> {
  if (r.status === 'bounce' || r.bounce_tipo === 'definitiva') return { status: 'Devolvido', cor: 'error' }
  if (r.status === 'erro') return { status: 'Falhou', cor: 'error' }
  if (r.status === 'pendente' || r.status === 'enviando') return { status: 'Na fila', cor: 'neutral' }
  if (r.confirmed_at) return { status: 'Confirmou', cor: 'success' }
  if (r.first_download_at) return { status: 'Baixou', cor: 'success' }
  if (r.first_access_at) return { status: 'Acessou', cor: 'info' }
  if (r.first_human_open_at) return { status: 'Provavelmente leu', cor: 'info' }
  return { status: 'Enviado', cor: 'warning' }
}

const ROTULO_CAIXA: Record<string, string> = {
  resposta: 'Respondeu',
  auto_resposta: 'Resposta automática',
  devolucao_definitiva: 'Devolução',
  devolucao_temporaria: 'Atraso na entrega',
  recibo: 'Recibo de leitura',
  aviso_servidor: 'Aviso do servidor'
}

/**
 * `setor` (de setorVisivel): solicitacoes e assinaturas de outro setor ficam
 * de fora; `undefined` = todas (admin).
 */
export async function linhaDoTempo(o: { email?: string | null; documento?: string | null; setor?: number | null }): Promise<LinhaDoTempoCliente> {
  const sql = useSql()
  const todosSetores = o.setor === undefined
  const setor = o.setor ?? null
  const emails = new Set<string>()
  const documentos = new Set<string>()
  if (o.email) emails.add(o.email.trim().toLowerCase())
  const doc = o.documento ? soDigitos(o.documento) : ''
  if (doc) documentos.add(doc)

  // um passo: os documentos do e-mail, depois os e-mails desses documentos
  type Aparicao = { email: string; documento: string | null; nome: string | null; empresa: string | null }
  const aparicoes = async (campo: 'email' | 'documento', valores: string[]) =>
    valores.length
      ? sql.unsafe<Aparicao[]>(
          `with pessoas as (${PESSOAS})
           select email, documento, nome, empresa from pessoas where ${campo} = any($1::text[]) order by quando desc`,
          [valores]
        )
      : []
  const doEmail = await aparicoes('email', [...emails])
  for (const l of doEmail) if (l.documento) documentos.add(l.documento)
  const doDocumento = await aparicoes('documento', [...documentos])
  for (const l of doDocumento) emails.add(l.email)
  const ligados = [...doEmail, ...doDocumento]
  const E = [...emails]
  const D = [...documentos]
  const nome = ligados.find(l => l.nome)?.nome ?? null
  const empresa = ligados.find(l => l.empresa)?.empresa ?? null

  const itens: ItemLinhaCliente[] = []

  const comunicados = await sql<
    {
      id: number; email: string; status: string; bounce_tipo: string | null; sent_at: Date | null; created_at: Date
      first_human_open_at: Date | null; first_access_at: Date | null; confirmed_at: Date | null; first_download_at: Date | null
      resposta_count: number; lembretes_enviados: number; lote_nome: string; assunto: string; por: string | null; envios: number
      nome: string | null; empresa: string | null; codigo: string; token: string; dados_extras: Record<string, unknown> | null
    }[]
  >`
    select r.id, r.email, r.status, r.bounce_tipo, r.sent_at, r.created_at, r.first_human_open_at, r.first_access_at,
           r.confirmed_at, r.first_download_at, r.resposta_count, r.lembretes_enviados,
           r.nome, r.empresa, r.codigo, r.token, r.dados_extras,
           b.nome as lote_nome, b.assunto_snapshot as assunto, coalesce(b.disparado_por_nome, b.criado_por_nome) as por,
           (select count(*)::int from sys_mail_envios e where e.recipient_id = r.id) as envios
      from sys_mail_recipients r
      join sys_mail_batches b on b.id = r.batch_id and b.excluido_em is null
     where lower(r.email) = any(${E}::text[]) or r.documento = any(${D}::text[])
     order by coalesce(r.sent_at, r.created_at) desc
     limit 300`
  for (const r of comunicados) {
    const detalhes = [
      r.sent_at ? `Enviado em ${formatarDataHora(r.sent_at)}` : 'Ainda não enviado',
      r.confirmed_at && `Confirmou em ${formatarDataHora(r.confirmed_at)}`,
      r.first_download_at && `Baixou em ${formatarDataHora(r.first_download_at)}`,
      r.envios > 1 && `${r.envios} envios (reenvios e lembretes)`,
      r.resposta_count > 0 && `Respondeu ${r.resposta_count} vez(es)`
    ].filter(Boolean) as string[]
    itens.push({
      modulo: 'comunicado',
      id: r.id,
      quando: iso(r.sent_at ?? r.created_at)!,
      titulo: r.lote_nome,
      ...statusComunicado(r),
      email: r.email,
      // o assunto como a pessoa recebeu, com {{nome}} e afins preenchidos
      detalhes: [renderizarAssunto(r.assunto, { nome: r.nome, email: r.email, empresa: r.empresa, codigo: r.codigo, token: r.token, dadosExtras: r.dados_extras }), ...detalhes],
      link: `/admin/destinatario/${r.id}`,
      por: r.por
    })
  }

  const solics = await sql<
    { id: number; titulo: string; status: StatusSolicitacao; destinatario_email: string; created_at: Date; enviado_em: Date | null; concluida_em: Date | null; prazo: string | null; criado_por_nome: string | null; total: number; resolvidos: number; arquivos: number }[]
  >`
    select s.id, s.titulo, s.status, s.destinatario_email, s.created_at, s.enviado_em, s.concluida_em, s.prazo::text, s.criado_por_nome,
           (select count(*)::int from sys_mail_solic_itens i where i.solic_id = s.id) as total,
           (select count(*)::int from sys_mail_solic_itens i where i.solic_id = s.id and i.status in ('aprovado', 'nao_possui')) as resolvidos,
           (select count(*)::int from sys_mail_solic_arquivos a where a.solic_id = s.id and a.removido_em is null) as arquivos
      from sys_mail_solic s
     where (lower(s.destinatario_email) = any(${E}::text[]) or s.documento = any(${D}::text[]))
       and (${todosSetores}::boolean or s.departamento_id is not distinct from ${setor}::int)
     order by s.created_at desc
     limit 200`
  for (const s of solics) {
    itens.push({
      modulo: 'solicitacao',
      id: s.id,
      quando: iso(s.enviado_em ?? s.created_at)!,
      titulo: s.titulo,
      status: ROTULO_STATUS_SOLIC[s.status] ?? s.status,
      cor: COR_STATUS_SOLIC[s.status] ?? 'neutral',
      email: s.destinatario_email,
      detalhes: [
        `${s.resolvidos} de ${s.total} documento(s) resolvido(s) · ${s.arquivos} arquivo(s)`,
        s.prazo ? `Prazo ${formatarPrazo(s.prazo)}` : '',
        s.concluida_em ? `Concluída em ${formatarDataHora(s.concluida_em)}` : ''
      ].filter(Boolean),
      link: `/admin/solicitacoes/${s.id}`,
      por: s.criado_por_nome
    })
  }

  const assins = await sql<
    { documento_id: number; signatario_id: number | null; titulo: string; doc_status: StatusAssinatura; sig_status: StatusSignatario | null; email: string | null; assinado_em: Date | null; created_at: Date; enviado_em: Date | null; criado_por_nome: string | null; papel: string | null }[]
  >`
    select d.id as documento_id, s.id as signatario_id, d.titulo, d.status as doc_status, s.status as sig_status,
           s.email, s.assinado_em, d.created_at, d.enviado_em, d.criado_por_nome, s.papel
      from sys_mail_assin_documentos d
      join sys_mail_assin_signatarios s on s.documento_id = d.id
     where (lower(s.email) = any(${E}::text[]) or s.cpf = any(${D}::text[]))
       and (${todosSetores}::boolean or d.departamento_id is not distinct from ${setor}::int)
    union all
    -- documento DA empresa, assinado por outras pessoas (socio, procurador)
    select d.id, null, d.titulo, d.status, null, null, null, d.created_at, d.enviado_em, d.criado_por_nome, null
      from sys_mail_assin_documentos d
     where d.cliente_documento = any(${D}::text[])
       and (${todosSetores}::boolean or d.departamento_id is not distinct from ${setor}::int)
       and not exists (select 1 from sys_mail_assin_signatarios s
                        where s.documento_id = d.id and (lower(s.email) = any(${E}::text[]) or s.cpf = any(${D}::text[])))
     order by created_at desc
     limit 200`
  for (const a of assins) {
    const pessoal = a.sig_status !== null
    itens.push({
      modulo: 'assinatura',
      id: a.documento_id,
      quando: iso(a.assinado_em ?? a.enviado_em ?? a.created_at)!,
      titulo: a.titulo,
      status: pessoal ? ROTULO_SIGNATARIO[a.sig_status!] : ROTULO_STATUS_ASSIN[a.doc_status],
      cor: pessoal ? COR_SIGNATARIO[a.sig_status!] : COR_STATUS_ASSIN[a.doc_status],
      email: a.email ?? '',
      detalhes: [
        pessoal ? `Signatário${a.papel ? ` (${a.papel})` : ''}` : 'Documento da empresa',
        `Documento: ${ROTULO_STATUS_ASSIN[a.doc_status]}`,
        a.assinado_em ? `Assinou em ${formatarDataHora(a.assinado_em)}` : ''
      ].filter(Boolean),
      link: `/admin/assinaturas/${a.documento_id}`,
      por: a.criado_por_nome
    })
  }

  // o que a pessoa escreveu de volta (respostas, devolucoes), pela caixa
  const caixa = E.length
    ? await sql<
        { id: number; de: string | null; assunto: string | null; classificacao: string; recebido_em: Date | null; processado_em: Date; recipient_id: number | null; solic_id: number | null; assin_documento_id: number | null; trecho: string | null }[]
      >`
        select id, de, assunto, classificacao, recebido_em, processado_em, recipient_id, solic_id, assin_documento_id, trecho
          from sys_mail_inbound
         where classificacao in ('resposta', 'auto_resposta')
           and exists (select 1 from unnest(${E}::text[]) e where lower(de) like '%' || e || '%')
         order by coalesce(recebido_em, processado_em) desc
         limit 100`
    : []
  for (const m of caixa) {
    itens.push({
      modulo: 'caixa',
      id: m.id,
      quando: iso(m.recebido_em ?? m.processado_em)!,
      titulo: m.assunto || '(sem assunto)',
      status: ROTULO_CAIXA[m.classificacao] ?? m.classificacao,
      cor: m.classificacao === 'resposta' ? 'primary' : 'neutral',
      email: (m.de ?? '').replace(/.*</, '').replace(/>.*/, ''),
      detalhes: m.trecho ? [m.trecho.slice(0, 280)] : [],
      link: m.recipient_id
        ? `/admin/destinatario/${m.recipient_id}`
        : m.solic_id
          ? `/admin/solicitacoes/${m.solic_id}`
          : m.assin_documento_id
            ? `/admin/assinaturas/${m.assin_documento_id}`
            : '/admin/caixa',
      por: null
    })
  }

  itens.sort((a, b) => b.quando.localeCompare(a.quando))
  const totais = { comunicado: 0, solicitacao: 0, assinatura: 0, caixa: 0 } as Record<ModuloLinha, number>
  for (const i of itens) totais[i.modulo]++
  return { emails: E, documentos: D, nome, empresa, itens, totais }
}
