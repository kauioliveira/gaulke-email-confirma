import type { H3Event } from 'h3'
import { sql, type SQL, type SQLWrapper } from 'drizzle-orm'
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
  /** setor do cadastro do painel; nulo na senha local */
  departamentoId: number | null
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
  return { id: u.id, nome: u.nome, email: u.email, papel: papelDe(u), origem: 'painel', departamentoId: u.departamentoId }
}

/**
 * SENHA_LOCAL_EMAIL (opcional): e-mail que recebe os avisos de "quem pediu"
 * (documentos prontos, assinou, recusou) do que for criado pela senha local.
 * Sem ele esses avisos nao saem — a senha nao identifica ninguem. Util em
 * desenvolvimento para testar sem entrar pelo painel.
 */
export const OPERADOR_SENHA_LOCAL: Operador = {
  id: null,
  nome: 'Acesso por senha local',
  email: (process.env.SENHA_LOCAL_EMAIL || '').replace(/^["']|["']$/g, '').trim().toLowerCase() || null,
  papel: 'admin',
  origem: 'senha',
  departamentoId: null
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

/**
 * Visibilidade por setor (solicitacoes, assinaturas, templates e modelos).
 *
 * Admin ve tudo; supervisor e usuario veem so o proprio setor. Isso FILTRA as
 * listas — nao e uma barreira em cada rota por id: e uma ferramenta interna,
 * usada so pela equipe, e a ideia e cada setor nao tropecar no trabalho dos
 * outros, nao esconder segredo.
 *
 * Devolve o setor a filtrar, ou `undefined` quando nao ha filtro (admin).
 * Quem nao tem setor no cadastro so ve o que tambem esta sem setor.
 */
export function setorVisivel(op: Pick<Operador, 'papel' | 'departamentoId'>): number | null | undefined {
  return op.papel === 'admin' ? undefined : op.departamentoId
}

/**
 * Condicao "do setor visivel" sobre a coluna de setor, ou `undefined` (admin).
 * `is not distinct from` para quem nao tem setor casar com as linhas sem setor.
 */
export function filtroSetor(op: Pick<Operador, 'papel' | 'departamentoId'>, coluna: SQLWrapper): SQL | undefined {
  const setor = setorVisivel(op)
  return setor === undefined ? undefined : sql`${coluna} is not distinct from ${setor}`
}

/**
 * Setor de um template/modelo ao salvar. Nulo = todos os setores. So o admin
 * escolhe um setor que nao e o seu; os demais ficam entre o proprio e "todos".
 */
export function setorAoSalvar(op: Pick<Operador, 'papel' | 'departamentoId'>, pedido: number | null | undefined) {
  if (pedido == null) return null
  return op.papel === 'admin' ? pedido : op.departamentoId
}

declare module 'h3' {
  interface H3EventContext {
    /** Preenchido pelo admin-guard em toda rota /api/admin. */
    operador?: Operador
  }
}
