import type { H3Event } from 'h3'
import { useDb, auditoria } from '../db'
import { clientContext } from './request'
import type { Operador } from './permissoes'

/**
 * Trilha de auditoria: quem fez o que, quando e de onde.
 *
 * Chamada DEPOIS da acao dar certo — registrar uma exclusao que o banco
 * recusou contaria uma historia que nao aconteceu. Tentativas recusadas por
 * permissao nao entram aqui; o 403 ja impede o efeito.
 *
 * Nunca lanca: a acao ja aconteceu, e devolver erro agora faria a pessoa
 * repetir algo que deu certo (disparar o lote duas vezes, por exemplo). A
 * falha vai para o log com o conteudo, para ser reconstruida se preciso.
 */

type Opcoes = {
  entidade?: string
  id?: string | number | null
  /** frase pronta para a tela: 'Excluiu o lote "Guias DAS" (312 destinatarios)' */
  resumo: string
  /** antes/depois e parametros; chaves de segredo sao removidas */
  dados?: Record<string, unknown> | null
  /** quando a acao nao passa pelo admin-guard (login), o operador vem daqui */
  operador?: Operador | null
}

/** Nomes de campo que nunca podem ir para a trilha, em nenhum nivel. */
const SEGREDO = /senha|pass(word)?|secret|segredo|token|cifrad|apikey|api_key/i

function semSegredos(v: unknown, prof = 0): unknown {
  if (prof > 6 || v === null || typeof v !== 'object') return v
  if (Array.isArray(v)) return v.map(x => semSegredos(x, prof + 1))
  const saida: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v)) {
    saida[k] = SEGREDO.test(k) ? '[omitido]' : semSegredos(x, prof + 1)
  }
  return saida
}

export async function auditar(event: H3Event, acao: string, o: Opcoes) {
  const op = o.operador === undefined ? event.context.operador : o.operador
  const ctx = clientContext(event)
  const linha = {
    userId: op?.id ?? null,
    userNome: op?.nome ?? null,
    papel: op?.papel ?? null,
    acao,
    entidade: o.entidade ?? null,
    entidadeId: o.id === undefined || o.id === null ? null : String(o.id),
    resumo: o.resumo,
    dados: (o.dados ? semSegredos(o.dados) : null) as never,
    ip: ctx.ip,
    userAgent: ctx.userAgent
  }
  try {
    await useDb().insert(auditoria).values(linha)
  } catch (e) {
    console.error(
      '[gaulke-mail] FALHA AO AUDITAR — registro perdido:',
      JSON.stringify(linha),
      e instanceof Error ? e.message : e
    )
  }
}

/**
 * Acao do proprio sistema, sem requisicao por tras (rotina de retencao,
 * lembretes automaticos). Fica na mesma trilha, com autor "Sistema".
 */
export async function auditarSistema(acao: string, o: Omit<Opcoes, 'operador'>) {
  try {
    await useDb()
      .insert(auditoria)
      .values({
        userId: null,
        userNome: 'Sistema (rotina automática)',
        papel: null,
        acao,
        entidade: o.entidade ?? null,
        entidadeId: o.id === undefined || o.id === null ? null : String(o.id),
        resumo: o.resumo,
        dados: (o.dados ? semSegredos(o.dados) : null) as never
      })
  } catch (e) {
    console.error('[gaulke-mail] FALHA AO AUDITAR (sistema):', acao, o.resumo, e instanceof Error ? e.message : e)
  }
}
