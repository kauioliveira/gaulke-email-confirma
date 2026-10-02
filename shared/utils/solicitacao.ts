import { dataSP, formatarData, DESLOCAMENTO_SP } from './fuso'
import type { StatusSolicitacao, StatusItemSolicitacao } from '../types/api'

/**
 * Rotulos e regras das solicitacoes de documentos que valem igual na tela, no
 * servidor (ZIP, e-mails) e na pagina do cliente.
 */

export const ROTULO_STATUS_SOLIC: Record<StatusSolicitacao, string> = {
  aberta: 'Aguardando o cliente',
  em_analise: 'Para analisar',
  concluida: 'Concluída',
  cancelada: 'Cancelada'
}

export const COR_STATUS_SOLIC: Record<StatusSolicitacao, 'warning' | 'info' | 'success' | 'neutral'> = {
  aberta: 'warning',
  em_analise: 'info',
  concluida: 'success',
  cancelada: 'neutral'
}

export const ROTULO_STATUS_ITEM: Record<StatusItemSolicitacao, string> = {
  pendente: 'Pendente',
  enviado: 'Enviado',
  aprovado: 'Aprovado',
  recusado: 'Recusado',
  nao_possui: 'Não possui'
}

export const COR_STATUS_ITEM: Record<StatusItemSolicitacao, 'neutral' | 'info' | 'success' | 'error' | 'warning'> = {
  pendente: 'neutral',
  enviado: 'info',
  aprovado: 'success',
  recusado: 'error',
  nao_possui: 'warning'
}

export const ICONE_STATUS_ITEM: Record<StatusItemSolicitacao, string> = {
  pendente: 'i-lucide-circle-dashed',
  enviado: 'i-lucide-circle-arrow-up',
  aprovado: 'i-lucide-circle-check',
  recusado: 'i-lucide-circle-x',
  nao_possui: 'i-lucide-circle-slash'
}

/** Aberta e com o prazo (dia em Sao Paulo) ja passado. */
export function solicitacaoAtrasada(s: { status: StatusSolicitacao; prazo: string | null }) {
  return s.status === 'aberta' && !!s.prazo && s.prazo < dataSP()
}

/** Prazo em dd/mm/aaaa, lido como dia de Sao Paulo (sem escorregar para o dia anterior). */
export function formatarPrazo(prazo: string | null | undefined) {
  return prazo ? formatarData(`${prazo}T12:00:00${DESLOCAMENTO_SP}`) : '—'
}

/**
 * Variaveis do texto da solicitacao ({{nome}}, {{empresa}}, {{email}},
 * {{codigo}}), iguais no e-mail, no titulo e na pagina do cliente.
 *
 *   {{#empresa}}... de {{empresa}}{{/empresa}}  some inteiro sem empresa
 *   {{empresa}} solto e sem empresa             vira "sua empresa"
 *   {{nome}} sem nome                           vira o comeco do e-mail
 *
 * Assim nunca sobra a tag crua nem um "para a ." no meio da frase.
 * `escapar` e para quando o resultado vai dentro de HTML.
 */
export function preencherVariaveis(
  texto: string,
  v: { nome?: string | null; email?: string | null; empresa?: string | null; codigo?: string | null },
  escapar: (s: string) => string = s => s
) {
  const brutos: Record<string, string> = {
    nome: (v.nome || '').trim(),
    email: (v.email || '').trim(),
    empresa: (v.empresa || '').trim(),
    codigo: (v.codigo || '').trim()
  }
  const reserva: Record<string, string> = {
    nome: (v.email || '').split('@')[0] || 'cliente',
    empresa: 'sua empresa'
  }
  return texto
    .replace(/\{\{\s*#(\w+)\s*\}\}([\s\S]*?)\{\{\s*\/\1\s*\}\}/g, (m, k: string, corpo: string) => (k in brutos ? (brutos[k] ? corpo : '') : m))
    .replace(/\{\{\s*(nome|email|empresa|codigo)\s*\}\}/g, (_m, k: string) => escapar(brutos[k] || reserva[k] || ''))
}

/**
 * Titulo com variaveis: sem o dado, a tag some em vez de virar "sua empresa"
 * ("REFORMA - {{empresa}}" sem empresa = "REFORMA"), e o separador que sobra
 * no fim ou no comeco sai junto.
 */
export function preencherTitulo(titulo: string, v: Parameters<typeof preencherVariaveis>[1]) {
  const semReserva = titulo.replace(/\{\{\s*(nome|empresa)\s*\}\}/g, (m, k: string) => ((v as Record<string, string | null | undefined>)[k]?.trim() ? m : ''))
  return preencherVariaveis(semReserva, v)
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-–—·:|,]+|[\s\-–—·:|,]+$/g, '')
    .trim() || titulo
}
