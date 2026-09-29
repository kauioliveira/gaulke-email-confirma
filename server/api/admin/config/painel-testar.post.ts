import { z } from 'zod'
import { exigirPapel } from '../../../utils/permissoes'
import { configPainel, testarPainel } from '../../../utils/painel-tickets'

const schema = z.object({
  url: z.string().trim().url().regex(/^https?:\/\//i).optional(),
  token: z.string().trim().max(500).optional()
})

/**
 * Testa a integracao com o painel: com a URL/token informados (antes de
 * salvar) ou com a configuracao em vigor. Nao cria chamado nenhum — consulta
 * um chamado inexistente e confere que a resposta e "nao existe" (404), e nao
 * "token recusado" (401/403).
 */
export default defineEventHandler(async event => {
  exigirPapel(event, 'admin', 'testar a integração com o painel')
  const d = validar(schema, (await readBody(event).catch(() => ({}))) ?? {})
  const atual = await configPainel()
  const url = d.url || atual?.url
  const token = d.token || atual?.token
  if (!url || !token) return { ok: false, mensagem: 'Informe a URL do painel e o token de API.' }
  return await testarPainel({ url: url.replace(/\/+$/, ''), token, origem: 'config' })
})
