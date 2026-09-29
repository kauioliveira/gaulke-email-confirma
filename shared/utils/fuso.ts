/**
 * Fuso horario do sistema: SEMPRE Sao Paulo/Brasilia.
 *
 * Nada de depender do fuso do servidor (o container roda em UTC se ninguem
 * disser o contrario) nem do navegador de quem abre a tela. Um horario
 * registrado como prova — envio, confirmacao, assinatura — precisa aparecer
 * igual para todo mundo.
 *
 * Sem horario de verao desde 2019 (Decreto 9.772/2019), o deslocamento e
 * fixo em -03:00. Mesmo assim a formatacao usa o nome IANA do fuso, e nao o
 * numero: se o horario de verao voltar, basta o Node atualizar a base de fusos.
 */

export const FUSO = 'America/Sao_Paulo'

/** Deslocamento atual de Sao Paulo, para montar ISO a partir de data/hora local. */
export const DESLOCAMENTO_SP = '-03:00'

function comoData(v: string | Date | null | undefined): Date | null {
  if (!v) return null
  const d = typeof v === 'string' ? new Date(v) : v
  return Number.isNaN(d.getTime()) ? null : d
}

/** 02/10/2026 14:03:11 */
export function formatarDataHora(v: string | Date | null | undefined, vazio = '—') {
  const d = comoData(v)
  if (!d) return vazio
  return d.toLocaleString('pt-BR', { timeZone: FUSO, dateStyle: 'short', timeStyle: 'medium' })
}

/** 02/10/2026 */
export function formatarData(v: string | Date | null | undefined, vazio = '—') {
  const d = comoData(v)
  if (!d) return vazio
  return d.toLocaleDateString('pt-BR', { timeZone: FUSO })
}

/** 14:03:11 */
export function formatarHora(v: string | Date | null | undefined, vazio = '—') {
  const d = comoData(v)
  if (!d) return vazio
  return d.toLocaleTimeString('pt-BR', { timeZone: FUSO, hour12: false })
}

/**
 * Partes da data/hora em Sao Paulo, para montar valores de <input
 * type="datetime-local"> e nomes de arquivo sem depender do fuso da maquina.
 */
export function partesSP(v: Date = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: FUSO,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    })
      .formatToParts(v)
      .filter(x => x.type !== 'literal')
      .map(x => [x.type, x.value])
  )
  return {
    ano: p.year!,
    mes: p.month!,
    dia: p.day!,
    hora: p.hour!,
    minuto: p.minute!,
    segundo: p.second!
  }
}

/** 2026-10-02 (data de hoje em Sao Paulo), para nomes de arquivo. */
export function dataSP(v: Date = new Date()) {
  const p = partesSP(v)
  return `${p.ano}-${p.mes}-${p.dia}`
}

/**
 * Converte o valor de um <input type="datetime-local"> ("2026-10-02T08:00"),
 * entendido como horario de Sao Paulo, em ISO com fuso.
 */
export function localSPparaISO(valor: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(valor)) return null
  const d = new Date(`${valor}:00${DESLOCAMENTO_SP}`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/**
 * Dia util (segunda a sexta) das 8h as 18h em Sao Paulo. Lembretes so saem
 * nessa janela: cobranca de madrugada ou no domingo soa como spam e costuma
 * ser ignorada.
 */
export function emHorarioComercialSP(v: Date = new Date()) {
  const hora = Number(partesSP(v).hora)
  const diaSemana = new Date(`${dataSP(v)}T12:00:00${DESLOCAMENTO_SP}`).getUTCDay()
  return diaSemana !== 0 && diaSemana !== 6 && hora >= 8 && hora < 18
}
