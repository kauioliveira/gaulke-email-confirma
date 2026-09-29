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
