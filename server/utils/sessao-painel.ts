import { createHash } from 'node:crypto'
import type { H3Event } from 'h3'
import { useSql } from '../db'

/**
 * Reconhece a sessao do painel Gaulke (gaulke-data-tools-ts).
 *
 * COMO FUNCIONA
 * O painel grava o cookie `gaulke_auth_session` com Domain=contabilgaulke.com.br,
 * entao o navegador ja o envia para este subdominio sozinho. O valor e um token
 * opaco cujo SHA-256 fica em public.user_session — a MESMA base que este app usa.
 * Entao basta calcular o hash e procurar a linha viva.
 *
 * POR QUE PELO BANCO E NAO POR SEGREDO COMPARTILHADO
 * Nao precisamos do authJwtSecret do painel, e o logout tem efeito IMEDIATO:
 * quando o painel apaga a linha da sessao, o acesso aqui morre junto. Um token
 * assinado continuaria valendo ate expirar.
 *
 * ACOPLAMENTO, ASSUMIDO
 * Se o painel trocar o nome do cookie ou o algoritmo do hash, deixamos de
 * reconhecer a sessao. O sistema NAO quebra — cai na senha do .env — mas perde
 * a autoria em silencio. Por isso /api/admin/status informa quando o cookie
 * chegou e nao foi reconhecido.
 */

const COOKIE_PAINEL = process.env.PAINEL_COOKIE_SESSAO || 'gaulke_auth_session'

export type UsuarioPainel = {
  id: number
  nome: string
  email: string | null
  isAdmin: boolean
  isSupervisor: boolean
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

/** Cookie presente na requisicao? Serve para distinguir "sem sessao" de "sessao invalida". */
export function temCookieDoPainel(event: H3Event) {
  return Boolean(getCookie(event, COOKIE_PAINEL)?.trim())
}

/**
 * Usuario do painel dono da sessao, ou null.
 *
 * Nunca lanca: quem chama decide se cai na senha. Uma falha de banco aqui nao
 * pode derrubar o login — no pior caso volta ao comportamento antigo.
 */
export async function usuarioDaSessaoPainel(event: H3Event): Promise<UsuarioPainel | null> {
  const token = getCookie(event, COOKIE_PAINEL)?.trim()
  if (!token) return null

  try {
    const sql = useSql()
    // `character(64)` no banco: o hex do sha256 tem exatamente 64 caracteres,
    // entao nao ha padding para acertar.
    const linhas = await sql<
      { user_id: number; fullname: string; username: string; is_admin: boolean; is_supervisor: boolean }[]
    >`
      select s.user_id, u.fullname, u.username, u.is_admin, u.is_supervisor
        from public.user_session s
        join public.users u on u.id = s.user_id
       where s.token_hash = ${hashToken(token)}
         and s.expires_at > now()
         and u.is_active
       limit 1
    `

    const l = linhas[0]
    if (!l) return null

    return {
      id: l.user_id,
      nome: l.fullname,
      email: l.username?.includes('@') ? l.username.toLowerCase() : null,
      isAdmin: Boolean(l.is_admin),
      isSupervisor: Boolean(l.is_supervisor),
    }
  } catch (e) {
    console.error('[gaulke-mail] falha ao ler a sessao do painel:', e instanceof Error ? e.message : e)
    return null
  }
}

/**
 * Quem pode operar: admin ou supervisor. Um usuario comum do painel tem sessao
 * valida mas NAO dispara comunicado — o corte e o mesmo que usariamos se o
 * modulo vivesse dentro do painel.
 */
export function podeOperar(u: UsuarioPainel) {
  return u.isAdmin || u.isSupervisor
}

/** Como o painel chama o cookie aqui — o status mostra para facilitar o diagnostico. */
export const nomeCookiePainel = COOKIE_PAINEL

export type SaudePainel = {
  /** public.user_session legivel deste app */
  tabelaOk: boolean
  /** o que aconteceu com o cookie nesta requisicao */
  cookie: 'reconhecido' | 'nao-reconhecido' | 'ausente'
  nomeCookie: string
  usuario: string | null
  aviso: string | null
}

/**
 * Diagnostico do acoplamento com o painel.
 *
 * Existe porque a falha aqui e SILENCIOSA: se o painel trocar o nome do cookie
 * ou o hash, todo mundo volta a digitar a senha e os lotes perdem a autoria
 * sem ninguem perceber o motivo.
 */
export async function saudePainel(event: H3Event): Promise<SaudePainel> {
  let tabelaOk = true
  try {
    await useSql()`select 1 from public.user_session limit 1`
  } catch {
    tabelaOk = false
  }

  const temCookie = temCookieDoPainel(event)
  const usuario = temCookie ? await usuarioDaSessaoPainel(event) : null

  const cookie = !temCookie ? 'ausente' : usuario ? 'reconhecido' : 'nao-reconhecido'

  let aviso: string | null = null
  if (!tabelaOk) {
    aviso = 'public.user_session inacessivel: a entrada pelo painel esta fora, so a senha funciona.'
  } else if (cookie === 'nao-reconhecido') {
    // Pode ser so uma sessao expirada, entao nao afirmamos que quebrou.
    aviso = `O cookie ${COOKIE_PAINEL} chegou mas nao corresponde a nenhuma sessao viva. `
      + 'Normal se a sessao expirou; persistindo para todos, o painel provavelmente mudou o cookie ou o hash.'
  }

  return { tabelaOk, cookie, nomeCookie: COOKIE_PAINEL, usuario: usuario?.nome ?? null, aviso }
}

declare module 'h3' {
  interface H3EventContext {
    /** Preenchido pelo admin-guard quando a entrada veio da sessao do painel. */
    operador?: UsuarioPainel
  }
}
