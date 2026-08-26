import type { H3Event } from 'h3'

/**
 * IP real do visitante. Quando o app roda atras de Nginx/Traefik o socket
 * mostra apenas o IP do proxy, entao damos preferencia aos cabecalhos.
 */
export function clientIp(event: H3Event): string | null {
  const h = getRequestHeaders(event)
  const fwd = h['x-forwarded-for']
  if (fwd) {
    const first = fwd.split(',')[0]?.trim()
    if (first) return normalizar(first)
  }
  const real = h['x-real-ip'] || h['cf-connecting-ip']
  if (real) return normalizar(real)

  const socket = event.node.req.socket?.remoteAddress
  return socket ? normalizar(socket) : null
}

function normalizar(ip: string) {
  // ::ffff:192.168.0.10 -> 192.168.0.10
  return ip.replace(/^::ffff:/, '').slice(0, 64)
}

export function clientContext(event: H3Event) {
  const h = getRequestHeaders(event)
  return {
    ip: clientIp(event),
    userAgent: (h['user-agent'] || null)?.slice(0, 500) ?? null,
    referer: (h['referer'] || h['referrer'] || null)?.slice(0, 500) ?? null
  }
}
