import type { H3Event } from 'h3'
import type { UsuarioPainel } from './sessao-painel'

/**
 * Papeis e permissoes.
 *
 * Todo usuario ativo do painel opera o sistema (decisao D1); o papel so limita
 * AS ACOES. A regra vale aqui, no servidor: a tela esconde botoes com base no
 * mesmo papel, mas isso e conveniencia — um POST direto passa por estas
 * funcoes do mesmo jeito.
 */

export type Papel = 'usuario' | 'supervisor' | 'admin'

/**
 * Quem esta operando nesta requisicao. Preenchido pelo admin-guard.
 *
 * `id` nulo = acesso pela senha local do .env, que nao identifica a pessoa.
 * Ele existe so como emergencia (decisao D3) e por isso opera como admin: e
 * usado justamente quando o painel esta fora e alguem precisa agir.
 */
export type Operador = {
  id: number | null
  nome: string
  email: string | null
  papel: Papel
  origem: 'painel' | 'senha'
}

const NIVEL: Record<Papel, number> = { usuario: 0, supervisor: 1, admin: 2 }

export const ROTULO_PAPEL: Record<Papel, string> = {
  usuario: 'usuário',
  supervisor: 'supervisor',
  admin: 'administrador'
}

export function papelDe(u: Pick<UsuarioPainel, 'isAdmin' | 'isSupervisor'>): Papel {
  if (u.isAdmin) return 'admin'
  if (u.isSupervisor) return 'supervisor'
  return 'usuario'
}

export function operadorDoPainel(u: UsuarioPainel): Operador {
  return { id: u.id, nome: u.nome, email: u.email, papel: papelDe(u), origem: 'painel' }
}

export const OPERADOR_SENHA_LOCAL: Operador = {
  id: null,
  nome: 'Acesso por senha local',
  email: null,
  papel: 'admin',
  origem: 'senha'
}

/** O papel alcanca o minimo? Admin alcanca supervisor; supervisor alcanca usuario. */
export function temPapel(op: Pick<Operador, 'papel'> | null | undefined, minimo: Papel) {
  return !!op && NIVEL[op.papel] >= NIVEL[minimo]
}

/** Operador da requisicao; 401 se nao houver (rota fora do admin-guard). */
export function operadorAtual(event: H3Event): Operador {
  const op = event.context.operador
  if (!op) throw createError({ statusCode: 401, statusMessage: 'Nao autenticado' })
  return op
}

/**
 * Exige um papel minimo. A mensagem diz O QUE e preciso, para a pessoa saber a
 * quem pedir, em vez de um "acesso negado" seco.
 */
export function exigirPapel(event: H3Event, minimo: Papel, acao?: string): Operador {
  const op = operadorAtual(event)
  if (!temPapel(op, minimo)) {
    const quem = minimo === 'admin' ? 'administradores' : 'supervisores e administradores'
    throw createError({
      statusCode: 403,
      statusMessage: acao ? `Somente ${quem} podem ${acao}.` : `Acao restrita a ${quem}.`
    })
  }
  return op
}

declare module 'h3' {
  interface H3EventContext {
    /** Preenchido pelo admin-guard em toda rota /api/admin. */
    operador?: Operador
  }
}
