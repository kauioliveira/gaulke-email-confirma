import type { StatusAssinatura, StatusSignatario } from '../types/api'

/** Rotulos das assinaturas, iguais na tela interna e na pagina de quem assina. */
export const ROTULO_STATUS_ASSIN: Record<StatusAssinatura, string> = {
  rascunho: 'Rascunho',
  aguardando: 'Aguardando assinaturas',
  concluido: 'Assinado por todos',
  recusado: 'Recusado',
  cancelado: 'Cancelado'
}

export const COR_STATUS_ASSIN: Record<StatusAssinatura, 'neutral' | 'warning' | 'success' | 'error'> = {
  rascunho: 'neutral',
  aguardando: 'warning',
  concluido: 'success',
  recusado: 'error',
  cancelado: 'neutral'
}

export const ROTULO_SIGNATARIO: Record<StatusSignatario, string> = {
  pendente: 'Na fila',
  aguardando: 'Aguardando',
  assinado: 'Assinou',
  recusado: 'Recusou'
}

export const COR_SIGNATARIO: Record<StatusSignatario, 'neutral' | 'warning' | 'success' | 'error'> = {
  pendente: 'neutral',
  aguardando: 'warning',
  assinado: 'success',
  recusado: 'error'
}
