import { resolveMx, resolve4, resolve6 } from 'node:dns/promises'
import { useDb, accounts } from '../db'
import type { ProblemaDominio } from '../../shared/types/api'

/**
 * Confere se o DOMINIO de cada destinatario recebe e-mail, antes do envio.
 *
 * Por que: o servidor SMTP da empresa aceita a mensagem para qualquer
 * endereco ("250 OK") e so DEPOIS descobre que o dominio nao existe — a
 * devolucao chega horas depois na caixa do remetente, e a tela mostrava
 * "enviado". Foi assim que um "contabilgualke.com.br" (letras trocadas) passou
 * despercebido. Aqui o erro aparece ANTES de sair.
 *
 * Um dominio recebe e-mail se tem MX; sem MX, a RFC 5321 manda tentar o
 * endereco do proprio dominio (A/AAAA). Nenhum dos dois = ninguem recebe.
 *
 * Alem disso, sugere a correcao quando o dominio parece um conhecido com
 * letras trocadas ("gmial.com" -> "gmail.com").
 */

const TIMEOUT_MS = 4000
const CACHE_MS = 60 * 60 * 1000
const cache = new Map<string, { recebe: boolean | null; ate: number }>()

/** Dominios que quase todo cliente usa; os dos canais entram na hora. */
const CONHECIDOS = [
  'gmail.com', 'hotmail.com', 'hotmail.com.br', 'outlook.com', 'outlook.com.br', 'live.com',
  'yahoo.com', 'yahoo.com.br', 'icloud.com', 'uol.com.br', 'bol.com.br', 'terra.com.br',
  'globo.com', 'globomail.com', 'ig.com.br', 'msn.com'
]

function comTempo<T>(p: Promise<T>): Promise<T> {
  return Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS))])
}

/** true: recebe; false: nao existe/nao recebe; null: nao deu para saber (DNS fora) */
async function recebeEmail(dominio: string): Promise<boolean | null> {
  const c = cache.get(dominio)
  if (c && c.ate > Date.now()) return c.recebe

  let recebe: boolean | null
  try {
    const mx = await comTempo(resolveMx(dominio))
    recebe = mx.some(m => m.exchange && m.exchange !== '.')
  } catch (e) {
    const codigo = (e as { code?: string })?.code
    if (codigo === 'ENOTFOUND' || codigo === 'ENODATA' || codigo === 'ESERVFAIL' || codigo === 'NXDOMAIN') {
      // sem MX: vale o endereco do proprio dominio (RFC 5321, 5.1)
      const ips = await Promise.all([
        comTempo(resolve4(dominio)).catch(() => []),
        comTempo(resolve6(dominio)).catch(() => [])
      ])
      recebe = ips.flat().length > 0
    } else {
      // timeout ou DNS indisponivel: nao afirmamos nada
      recebe = null
    }
  }
  cache.set(dominio, { recebe, ate: Date.now() + CACHE_MS })
  return recebe
}

/** Distancia de edicao (letras trocadas, faltando ou sobrando). */
function distancia(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0]![j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i]![j] = Math.min(
        d[i - 1]![j]! + 1,
        d[i]![j - 1]! + 1,
        d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
        // transposicao ("gualke" x "gaulke") conta como UM erro
        i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1] ? d[i - 2]![j - 2]! + 1 : Infinity
      )
    }
  }
  return d[a.length]![b.length]!
}

async function dominiosConhecidos() {
  const canais = await useDb().select({ remetente: accounts.remetente }).from(accounts).catch(() => [])
  const proprios = canais
    .map(c => /@([A-Za-z0-9.-]+)/.exec(c.remetente)?.[1]?.toLowerCase())
    .filter((d): d is string => !!d)
  return [...new Set([...proprios, ...CONHECIDOS])]
}


/**
 * Analisa os e-mails e devolve SO os dominios com problema: os que nao
 * recebem e-mail, ou que recebem mas parecem erro de digitacao de um conhecido.
 */
export async function verificarDominios(emails: string[]): Promise<ProblemaDominio[]> {
  const porDominio = new Map<string, string[]>()
  for (const e of emails) {
    const d = e.split('@')[1]?.trim().toLowerCase()
    if (!d) continue
    porDominio.set(d, [...(porDominio.get(d) ?? []), e])
  }
  const conhecidos = await dominiosConhecidos()

  const problemas: ProblemaDominio[] = []
  // em paralelo, mas em fatias: centenas de dominios de uma vez sobrecarregam o DNS
  const lista = [...porDominio.keys()]
  for (let i = 0; i < lista.length; i += 20) {
    await Promise.all(
      lista.slice(i, i + 20).map(async dominio => {
        const recebe = await recebeEmail(dominio)
        const parecido = conhecidos.includes(dominio)
          ? null
          : (conhecidos
              .map(c => ({ c, dist: distancia(dominio, c) }))
              .filter(x => x.dist > 0 && x.dist <= 2)
              .sort((a, b) => a.dist - b.dist)[0]?.c ?? null)
        if (recebe === false || parecido) {
          problemas.push({ dominio, recebe, sugestao: parecido, emails: porDominio.get(dominio)! })
        }
      })
    )
  }
  return problemas.sort((a, b) => b.emails.length - a.emails.length)
}
