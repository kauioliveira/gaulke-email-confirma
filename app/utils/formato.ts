export function dataHora(v: string | Date | null | undefined) {
  if (!v) return '—'
  const d = typeof v === 'string' ? new Date(v) : v
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' })
}

export function hora(v: string | Date | null | undefined) {
  if (!v) return '—'
  const d = typeof v === 'string' ? new Date(v) : v
  return d.toLocaleTimeString('pt-BR', { hour12: false })
}

export function tamanho(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export function duracao(ms: number) {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const r = s % 60
  if (m < 60) return r ? `${m}min ${r}s` : `${m}min`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}min`
}

export const CORES_STATUS: Record<string, string> = {
  pendente: 'neutral',
  enviando: 'info',
  enviado: 'success',
  erro: 'error',
  bounce: 'warning',
  rascunho: 'neutral',
  agendado: 'info',
  pausado: 'warning',
  concluido: 'success'
}

export const ROTULOS_EVENTO: Record<string, string> = {
  enfileirado: 'Enfileirado',
  enviado: 'E-mail enviado',
  erro: 'Falha no envio',
  abertura: 'Indício de abertura',
  acesso: 'Acessou a página',
  confirmacao: 'Confirmou a leitura',
  download: 'Baixou o arquivo',
  reenvio: 'Reenviado'
}

export const ICONES_EVENTO: Record<string, string> = {
  enfileirado: 'i-lucide-list-plus',
  enviado: 'i-lucide-send',
  erro: 'i-lucide-triangle-alert',
  abertura: 'i-lucide-eye',
  acesso: 'i-lucide-mouse-pointer-click',
  confirmacao: 'i-lucide-badge-check',
  download: 'i-lucide-download',
  reenvio: 'i-lucide-rotate-cw'
}
