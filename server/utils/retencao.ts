import { readdir, stat, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { useSql } from '../db'
import { lerConfig, gravarConfig } from './config'
import { storageDir, caminhoNoStorage } from './storage'
import { documentosDir, apagarDocumento, apagarPastaDocumento } from './documentos'
import { auditarSistema } from './auditoria'
import type { ConfigRetencao, ResumoRetencao } from '../../shared/types/api'

/**
 * Retencao LGPD (decisao D10).
 *
 * O rodape dos e-mails promete que "os registros sao mantidos por 24 meses";
 * esta rotina cumpre a promessa. Uma vez por dia:
 *
 *  - comunicados (lotes) mais velhos que o prazo: APAGADOS por inteiro —
 *    destinatarios, eventos, envios, mensagens da caixa ligadas a eles e o
 *    anexo (se nenhum outro lote usa o mesmo arquivo);
 *  - lote na lixeira ha mais de N dias: apagado de vez;
 *  - solicitacoes de documentos: registros e a pasta com os arquivos do cliente;
 *  - documentos assinados por todos: so depois de 10 anos (prova de contrato).
 *    Os recusados, cancelados ou abandonados seguem o prazo dos comunicados;
 *  - mensagens da caixa SEM vinculo (nao sao de envio nosso): mesmo prazo;
 *  - auditoria: fica (e a prestacao de contas da equipe), mas o IP e o
 *    navegador de quem agiu sao anonimizados depois do prazo;
 *  - arquivos soltos: anexos que nenhum lote usa, PDFs temporarios de
 *    assinatura e sobras da quarentena;
 *  - fila de webhooks: entregas encerradas ha mais de 90 dias (o payload
 *    carrega nome e e-mail).
 *
 * Apagar e irreversivel, por isso existe a PREVIA (simulacao), que conta o que
 * sairia sem tocar em nada, e cada execucao real vai para a auditoria.
 */

/** Por execucao, no maximo isto de cada modulo: o resto sai no dia seguinte. */
const LOTE = 500
const DIA_MS = 86_400_000
const TRAVA_RETENCAO = 827011401

// prazo 0 = nunca expurga. '-infinity' e aceito pelo Postgres (nada e menor
// que ele) e, como texto, tambem perde na comparacao de anexosSoltos
const NUNCA = '-infinity'

// prazo tao longo que o corte cai antes do ano 1 (o Postgres nao aceita) = nunca
function corte(d: Date) {
  return Number.isNaN(d.getTime()) || d.getUTCFullYear() < 1 ? NUNCA : d.toISOString()
}

function menosMeses(meses: number, agora = new Date()) {
  if (meses <= 0) return NUNCA
  const d = new Date(agora)
  d.setMonth(d.getMonth() - meses)
  return corte(d)
}

export function cortesRetencao(c: ConfigRetencao, agora = new Date()) {
  return {
    comunicados: menosMeses(c.comunicadosMeses, agora),
    solicitacoes: menosMeses(c.solicitacoesMeses, agora),
    assinados: menosMeses(c.assinadosAnos * 12, agora),
    lixeira: c.lixeiraDias <= 0 ? NUNCA : corte(new Date(agora.getTime() - c.lixeiraDias * DIA_MS))
  }
}

type Alvos = {
  lotes: { id: number; nome: string; quando: string; lixeira: boolean }[]
  solicitacoes: { id: number; nome: string; quando: string; pasta: string | null }[]
  assinaturas: { id: number; nome: string; quando: string; pasta: string | null }[]
}

async function buscarAlvos(c: ConfigRetencao): Promise<Alvos> {
  const sql = useSql()
  const k = cortesRetencao(c)

  // "ultima atividade": o lote que teve reenvio recente conta a partir dele
  const lotes = await sql<{ id: number; nome: string; quando: Date; lixeira: boolean }[]>`
    select id, nome,
           case when excluido_em is not null and excluido_em < ${k.lixeira}::timestamptz
                then excluido_em
                else greatest(created_at, coalesce(started_at, created_at), coalesce(finished_at, created_at)) end as quando,
           (excluido_em is not null and excluido_em < ${k.lixeira}::timestamptz) as lixeira
      from sys_mail_batches
     where status not in ('enviando', 'agendado')
       and (
         (excluido_em is not null and excluido_em < ${k.lixeira}::timestamptz)
         or greatest(created_at, coalesce(started_at, created_at), coalesce(finished_at, created_at)) < ${k.comunicados}::timestamptz
       )
     order by id
     limit ${LOTE}`

  const solicitacoes = await sql<{ id: number; nome: string; quando: Date; pasta: string | null }[]>`
    select id, titulo as nome, pasta,
           greatest(created_at, coalesce(enviado_em, created_at), coalesce(ultima_entrega_em, created_at),
                    coalesce(ultimo_acesso_em, created_at), coalesce(concluida_em, created_at),
                    coalesce(cancelada_em, created_at)) as quando
      from sys_mail_solic
     where greatest(created_at, coalesce(enviado_em, created_at), coalesce(ultima_entrega_em, created_at),
                    coalesce(ultimo_acesso_em, created_at), coalesce(concluida_em, created_at),
                    coalesce(cancelada_em, created_at)) < ${k.solicitacoes}::timestamptz
     order by id
     limit ${LOTE}`

  const assinaturas = await sql<{ id: number; nome: string; quando: Date; pasta: string | null }[]>`
    select id, titulo as nome, pasta,
           case when status = 'concluido' then concluido_em
                else greatest(created_at, coalesce(enviado_em, created_at), coalesce(cancelado_em, created_at)) end as quando
      from sys_mail_assin_documentos
     where (status = 'concluido' and concluido_em < ${k.assinados}::timestamptz)
        or (status <> 'concluido'
            and greatest(created_at, coalesce(enviado_em, created_at), coalesce(cancelado_em, created_at)) < ${k.comunicados}::timestamptz)
     order by id
     limit ${LOTE}`

  const iso = <T extends { quando: Date }>(xs: T[]) => xs.map(x => ({ ...x, quando: new Date(x.quando).toISOString() }))
  return { lotes: iso(lotes), solicitacoes: iso(solicitacoes), assinaturas: iso(assinaturas) }
}

/** Anexos de lotes que nao estao em uso e sao mais velhos que o prazo. */
async function anexosSoltos(corte: string) {
  const sql = useSql()
  const usados = new Set(
    (
      await sql<{ p: string }[]>`
        select arquivo_path as p from sys_mail_batches where arquivo_path is not null
        union
        select arquivo_path from sys_mail_recipients where arquivo_path is not null`
    ).map(r => r.p)
  )
  const saida: string[] = []
  let nomes: string[] = []
  try {
    nomes = await readdir(storageDir())
  } catch {
    return saida
  }
  for (const nome of nomes) {
    if (nome.startsWith('.') || usados.has(nome)) continue
    try {
      const s = await stat(resolve(storageDir(), nome))
      if (s.isFile() && s.mtime.toISOString() < corte) saida.push(nome)
    } catch {
      /* sumiu entre o readdir e o stat */
    }
  }
  return saida
}

/** PDFs de assinatura enviados e nunca usados, e sobras da quarentena. */
async function temporariosSoltos() {
  const sql = useSql()
  const umDia = Date.now() - DIA_MS
  const saida: string[] = []
  const naQuarentena = new Set(
    (await sql<{ c: string }[]>`select caminho as c from sys_mail_solic_arquivos where caminho like 'quarentena/%'`).map(r => r.c)
  )
  for (const pasta of ['assinaturas-tmp', 'quarentena']) {
    let nomes: string[] = []
    try {
      nomes = await readdir(resolve(documentosDir(), pasta))
    } catch {
      continue
    }
    for (const nome of nomes) {
      const rel = `${pasta}/${nome}`
      if (naQuarentena.has(rel)) continue
      try {
        const s = await stat(resolve(documentosDir(), rel))
        if (s.isFile() && s.mtimeMs < umDia) saida.push(rel)
      } catch {
        /* ja foi */
      }
    }
  }
  return saida
}

function resumoVazio(simulacao: boolean, automatica: boolean, porNome: string | null): ResumoRetencao {
  return {
    em: new Date().toISOString(),
    simulacao,
    automatica,
    porNome,
    lotes: 0,
    lixeira: 0,
    destinatarios: 0,
    solicitacoes: 0,
    assinaturas: 0,
    arquivos: 0,
    caixa: 0,
    auditoriaAnonimizada: 0,
    webhookEntregas: 0,
    exemplos: [],
    erros: []
  }
}

/**
 * Roda a retencao. `simular` so conta. Nunca lanca: o erro de um item vai para
 * o resumo e o resto continua (um arquivo travado nao pode segurar o expurgo
 * de todo o resto).
 */
export async function executarRetencao(o: {
  simular: boolean
  automatica: boolean
  porNome: string | null
  config?: ConfigRetencao
}): Promise<ResumoRetencao> {
  const c = o.config ?? (await lerConfig('retencao'))
  const k = cortesRetencao(c)
  const r = resumoVazio(o.simular, o.automatica, o.porNome)
  const sql = useSql()

  const alvos = await buscarAlvos(c)
  const idsLotes = alvos.lotes.map(l => l.id)
  const idsSolic = alvos.solicitacoes.map(s => s.id)
  const idsAssin = alvos.assinaturas.map(a => a.id)

  r.lotes = alvos.lotes.filter(l => !l.lixeira).length
  r.lixeira = alvos.lotes.filter(l => l.lixeira).length
  r.solicitacoes = idsSolic.length
  r.assinaturas = idsAssin.length
  r.exemplos = [
    ...alvos.lotes.map(l => ({ tipo: (l.lixeira ? 'lixeira' : 'lote') as 'lote' | 'lixeira', id: l.id, nome: l.nome, quando: l.quando })),
    ...alvos.solicitacoes.map(s => ({ tipo: 'solicitacao' as const, id: s.id, nome: s.nome, quando: s.quando })),
    ...alvos.assinaturas.map(a => ({ tipo: 'assinatura' as const, id: a.id, nome: a.nome, quando: a.quando }))
  ].slice(0, 30)

  if (idsLotes.length) {
    const [d] = await sql<{ n: number }[]>`select count(*)::int as n from sys_mail_recipients where batch_id = any(${idsLotes}::int[])`
    r.destinatarios = d?.n ?? 0
  }

  // mensagens da caixa: as dos itens que saem + as sem vinculo vencidas
  const [cx] = await sql<{ n: number }[]>`
    select count(*)::int as n from sys_mail_inbound
     where batch_id = any(${idsLotes}::int[])
        or recipient_id in (select id from sys_mail_recipients where batch_id = any(${idsLotes}::int[]))
        or solic_id = any(${idsSolic}::int[])
        or assin_documento_id = any(${idsAssin}::int[])
        or (recipient_id is null and batch_id is null and solic_id is null and assin_documento_id is null
            and processado_em < ${k.comunicados}::timestamptz)`
  r.caixa = cx?.n ?? 0

  const [au] = await sql<{ n: number }[]>`
    select count(*)::int as n from sys_mail_auditoria
     where quando < ${k.comunicados}::timestamptz and (ip is not null or user_agent is not null)`
  r.auditoriaAnonimizada = au?.n ?? 0

  const [wh] = await sql<{ n: number }[]>`
    select count(*)::int as n from sys_mail_webhook_entregas
     where status in ('entregue', 'erro') and criado_em < now() - interval '90 days'`
  r.webhookEntregas = wh?.n ?? 0

  // anexos dos lotes que saem: so os que nenhum outro lote usa
  const anexosDosLotes = idsLotes.length
    ? (
        await sql<{ p: string }[]>`
          select distinct p from (
            select arquivo_path as p from sys_mail_batches where id = any(${idsLotes}::int[]) and arquivo_path is not null
            union
            select arquivo_path from sys_mail_recipients where batch_id = any(${idsLotes}::int[]) and arquivo_path is not null
          ) x
          where not exists (select 1 from sys_mail_batches b where b.arquivo_path = x.p and not (b.id = any(${idsLotes}::int[])))
            and not exists (select 1 from sys_mail_recipients d where d.arquivo_path = x.p and not (d.batch_id = any(${idsLotes}::int[])))`
      ).map(x => x.p)
    : []
  const soltos = [...(await anexosSoltos(k.comunicados)), ...anexosDosLotes.filter(Boolean)]
  const anexos = [...new Set(soltos)]
  const temporarios = await temporariosSoltos()
  r.arquivos = anexos.length + temporarios.length

  if (o.simular) return r

  // ---- daqui em diante apaga de verdade ----
  const erro = (onde: string, e: unknown) => {
    const msg = `${onde}: ${e instanceof Error ? e.message : String(e)}`
    r.erros.push(msg)
    console.error('[gaulke-mail] retencao', msg)
  }

  try {
    await sql.begin(async tx => {
      await tx`
        delete from sys_mail_inbound
         where batch_id = any(${idsLotes}::int[])
            or recipient_id in (select id from sys_mail_recipients where batch_id = any(${idsLotes}::int[]))
            or solic_id = any(${idsSolic}::int[])
            or assin_documento_id = any(${idsAssin}::int[])
            or (recipient_id is null and batch_id is null and solic_id is null and assin_documento_id is null
                and processado_em < ${k.comunicados}::timestamptz)`
      // destinatarios, eventos, envios e chamados caem junto (ON DELETE CASCADE)
      if (idsLotes.length) await tx`delete from sys_mail_batches where id = any(${idsLotes}::int[])`
      if (idsSolic.length) await tx`delete from sys_mail_solic where id = any(${idsSolic}::int[])`
      if (idsAssin.length) await tx`delete from sys_mail_assin_documentos where id = any(${idsAssin}::int[])`
      await tx`
        update sys_mail_auditoria set ip = null, user_agent = null
         where quando < ${k.comunicados}::timestamptz and (ip is not null or user_agent is not null)`
      await tx`
        delete from sys_mail_webhook_entregas
         where status in ('entregue', 'erro') and criado_em < now() - interval '90 days'`
    })
  } catch (e) {
    // nada foi apagado do banco: nao mexe nos arquivos
    erro('banco', e)
    return r
  }

  for (const s of alvos.solicitacoes) {
    if (!s.pasta) continue
    try {
      await apagarPastaDocumento(s.pasta)
    } catch (e) {
      erro(`pasta da solicitação #${s.id}`, e)
    }
  }
  for (const a of alvos.assinaturas) {
    if (!a.pasta) continue
    try {
      await apagarPastaDocumento(a.pasta)
    } catch (e) {
      erro(`pasta da assinatura #${a.id}`, e)
    }
  }
  for (const nome of anexos) {
    try {
      await unlink(caminhoNoStorage(nome))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') erro(`anexo ${nome}`, e)
    }
  }
  for (const rel of temporarios) {
    try {
      await apagarDocumento(rel)
    } catch (e) {
      erro(`temporário ${rel}`, e)
    }
  }
  return r
}

function descreverResumo(r: ResumoRetencao) {
  const partes = [
    r.lotes && `${r.lotes} lote(s) (${r.destinatarios} destinatário(s))`,
    r.lixeira && `${r.lixeira} da lixeira`,
    r.solicitacoes && `${r.solicitacoes} solicitação(ões)`,
    r.assinaturas && `${r.assinaturas} assinatura(s)`,
    r.arquivos && `${r.arquivos} arquivo(s)`,
    r.caixa && `${r.caixa} mensagem(ns) da caixa`,
    r.auditoriaAnonimizada && `IP anonimizado em ${r.auditoriaAnonimizada} registro(s) da auditoria`
  ].filter(Boolean)
  return partes.length ? partes.join(', ') : 'nada venceu'
}

/**
 * Execucao real + registro: resumo na configuracao (a tela mostra) e linha na
 * auditoria quando algo saiu. A trava impede duas instancias no mesmo dia.
 */
export async function rodarRetencao(o: { automatica: boolean; porNome: string | null }) {
  // lock de SESSAO: precisa ser tomado e solto na MESMA conexao — pelo pool,
  // o unlock podia cair em outra conexao e a trava ficava presa para sempre
  const reservada = await useSql().reserve()
  try {
    const [trava] = await reservada<{ ok: boolean }[]>`select pg_try_advisory_lock(${TRAVA_RETENCAO}) as ok`
    if (!trava?.ok) return null
    try {
      const r = await executarRetencao({ simular: false, ...o })
      await gravarConfig('retencao_ultima', r, o.porNome ?? 'Sistema')
      const algo = r.lotes + r.lixeira + r.solicitacoes + r.assinaturas + r.arquivos + r.caixa + r.auditoriaAnonimizada
      if (o.automatica && (algo || r.erros.length)) {
        await auditarSistema('retencao.executar', {
          entidade: 'retencao',
          resumo: `Retenção LGPD: ${descreverResumo(r)}${r.erros.length ? ` · ${r.erros.length} erro(s)` : ''}`,
          dados: { ...r, exemplos: r.exemplos.slice(0, 10) }
        })
      }
      return r
    } finally {
      await reservada`select pg_advisory_unlock(${TRAVA_RETENCAO})`
    }
  } finally {
    reservada.release()
  }
}

export { descreverResumo }

/**
 * Chamado pelo agendador: roda uma vez por dia, a partir das 2h (Sao Paulo).
 * O dia da ultima execucao fica no banco, e nao so em memoria — reiniciar a
 * aplicacao nao faz a rotina rodar duas vezes.
 */
export async function retencaoDiaria() {
  const c = await lerConfig('retencao')
  if (!c.ativa) return
  if (Number(partesSP().hora) < 2) return
  const ultima = await lerConfig('retencao_ultima')
  const hoje = dataSP()
  if (ultima && !ultima.simulacao && ultima.automatica && dataSP(new Date(ultima.em)) === hoje) return
  const r = await rodarRetencao({ automatica: true, porNome: null })
  if (r) console.info(`[gaulke-mail] retencao diaria: ${descreverResumo(r)}`)
}
