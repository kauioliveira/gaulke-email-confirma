import { resolveTxt } from 'node:dns/promises'
import type { VerificacaoDns } from '../../shared/types/api'

/**
 * Confere os registros de DNS que decidem se um e-mail cai no spam: SPF, DKIM
 * e DMARC do dominio do remetente.
 *
 * E so AVISO, nunca bloqueio: o canal pode funcionar sem eles (e em servidor
 * interno, muitas vezes funciona), mas Gmail e Outlook desconfiam cada vez
 * mais de quem nao os tem. O admin precisa saber disso ao cadastrar o canal, e
 * nao quando os clientes comecarem a dizer que "nao chegou".
 *
 * DKIM nao e publico como os outros dois: o registro fica em
 * <seletor>._domainkey.<dominio>, e o seletor so aparece no cabecalho de uma
 * mensagem assinada. Procuramos os seletores mais comuns; nao achar nao prova
 * que ele falta.
 */

const SELETORES_DKIM = ['default', 'mail', 'dkim', 'selector1', 'selector2', 'google', 'k1', 's1', 's2', 'smtp', 'x']
const TIMEOUT_MS = 4000


/** "Nome <x@dominio.com.br>" ou "x@dominio.com.br" -> "dominio.com.br" */
export function dominioDoRemetente(remetente: string) {
  const m = /@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/.exec(remetente)
  return m ? m[1]!.toLowerCase() : null
}

async function txt(nome: string): Promise<string[]> {
  try {
    const r = await Promise.race([
      resolveTxt(nome),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS))
    ])
    // um registro TXT pode vir quebrado em varios pedacos de ate 255 bytes
    return r.map(partes => partes.join(''))
  } catch {
    return []
  }
}

export async function verificarDominio(remetente: string): Promise<VerificacaoDns | null> {
  const dominio = dominioDoRemetente(remetente)
  if (!dominio) return null

  const [raiz, dmarc, ...dkims] = await Promise.all([
    txt(dominio),
    txt(`_dmarc.${dominio}`),
    ...SELETORES_DKIM.map(s => txt(`${s}._domainkey.${dominio}`))
  ])

  const spf = raiz.find(v => /^v=spf1\b/i.test(v)) ?? null
  const dmarcValor = dmarc.find(v => /^v=DMARC1\b/i.test(v)) ?? null
  const iDkim = dkims.findIndex(l => l.some(v => /v=DKIM1|p=/i.test(v)))

  const avisos: string[] = []
  if (!spf) avisos.push(`${dominio} não tem SPF: servidores de destino não sabem quem pode enviar por ele.`)
  if (!dmarcValor) avisos.push(`${dominio} não tem DMARC: Gmail e Outlook tendem a mandar para o spam.`)
  if (iDkim < 0) {
    avisos.push('DKIM não encontrado nos seletores comuns. Se o servidor assina com outro seletor, ignore este aviso.')
  }

  return {
    dominio,
    spf: { ok: !!spf, valor: spf },
    dmarc: { ok: !!dmarcValor, valor: dmarcValor },
    dkim: { ok: iDkim >= 0, seletor: iDkim >= 0 ? SELETORES_DKIM[iDkim]! : null },
    avisos
  }
}
