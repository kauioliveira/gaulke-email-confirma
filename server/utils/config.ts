import { sql } from 'drizzle-orm'
import { useDb, config } from '../db'
import type { ConfigRetencao, ResumoRetencao } from '../../shared/types/api'

/**
 * Configuracoes que o admin muda pela tela (sys_mail_config).
 *
 * Algumas sao lidas a CADA requisicao — a senha local, por exemplo, e
 * consultada pelo admin-guard. Por isso ha um cache curto em memoria: ir ao
 * banco em toda chamada da API seria desperdicio, e 30s e pouco o bastante
 * para desligar algo pela tela ter efeito quase imediato. Quem grava pela
 * propria aplicacao limpa o cache na hora.
 */

const TTL_MS = 30_000
const cache = new Map<string, { valor: unknown; ate: number }>()

/** Servidor SMTP compartilhado pelos canais: so usuario e senha mudam entre eles. */
export type ServidorSmtp = {
  host: string
  port: number
  secure: boolean
  requireTls: boolean
  rejectUnauthorized: boolean
}

/** Chaves conhecidas e o valor usado quando a linha nao existe. */
export const PADROES = {
  /** D3: acesso de emergencia pela senha do .env */
  senha_local_habilitada: true as boolean,
  /** ponto de partida de todo canal novo; nulo = o do .env */
  smtp_servidor_padrao: null as ServidorSmtp | null,
  /** integracao com o painel (chamados); token cifrado. Nulo = o do .env */
  painel_integracao: null as { url: string; tokenCifrado: string } | null,
  /** D10: retencao LGPD — prazos por modulo; a rotina roda uma vez por dia */
  retencao: {
    ativa: true,
    comunicadosMeses: 24,
    solicitacoesMeses: 24,
    assinadosAnos: 10,
    lixeiraDias: 90
  } as ConfigRetencao,
  /** resumo da ultima execucao da retencao (automatica ou pela tela) */
  retencao_ultima: null as ResumoRetencao | null
} satisfies Record<string, unknown>

export type ChaveConfig = keyof typeof PADROES

export async function lerConfig<K extends ChaveConfig>(chave: K): Promise<(typeof PADROES)[K]> {
  const c = cache.get(chave)
  if (c && c.ate > Date.now()) return c.valor as (typeof PADROES)[K]

  let valor: unknown = PADROES[chave]
  try {
    const [linha] = await useDb()
      .select({ valor: config.valor })
      .from(config)
      .where(sql`${config.chave} = ${chave}`)
    if (linha) valor = linha.valor
  } catch (e) {
    // tabela ainda nao criada (migration pendente) ou banco fora: vale o padrao,
    // que reproduz o comportamento anterior a existencia da configuracao
    console.error(`[gaulke-mail] falha ao ler config "${chave}":`, e instanceof Error ? e.message : e)
  }

  cache.set(chave, { valor, ate: Date.now() + TTL_MS })
  return valor as (typeof PADROES)[K]
}

export async function gravarConfig<K extends ChaveConfig>(
  chave: K,
  valor: (typeof PADROES)[K],
  porNome: string | null
) {
  await useDb()
    .insert(config)
    .values({ chave, valor: valor as never, atualizadoPorNome: porNome, atualizadoEm: new Date() })
    .onConflictDoUpdate({
      target: config.chave,
      set: { valor: valor as never, atualizadoPorNome: porNome, atualizadoEm: new Date() }
    })
  cache.delete(chave)
}

/** Todas as chaves conhecidas com o valor atual, para a tela de configuracoes. */
export async function listarConfig() {
  const linhas = await useDb().select().from(config)
  const porChave = new Map(linhas.map(l => [l.chave, l]))
  return (Object.keys(PADROES) as ChaveConfig[]).map(chave => {
    const l = porChave.get(chave)
    let valor: unknown = l ? l.valor : PADROES[chave]
    // segredo nunca sai daqui, nem cifrado: a tela so precisa saber se existe
    if (chave === 'painel_integracao' && valor && typeof valor === 'object') {
      const { tokenCifrado, ...resto } = valor as { url: string; tokenCifrado?: string }
      valor = { ...resto, temToken: !!tokenCifrado }
    }
    return {
      chave,
      valor,
      atualizadoPorNome: l?.atualizadoPorNome ?? null,
      atualizadoEm: l?.atualizadoEm ?? null
    }
  })
}
