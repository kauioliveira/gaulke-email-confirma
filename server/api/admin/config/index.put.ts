import { z } from 'zod'
import { exigirPapel } from '../../../utils/permissoes'
import { gravarConfig, lerConfig } from '../../../utils/config'
import { auditar } from '../../../utils/auditoria'
import { cifrar } from '../../../utils/cripto'

/**
 * Altera uma configuracao. So admin.
 *
 * Cada chave tem o seu schema: gravar um texto onde o sistema espera um
 * booleano quebraria o admin-guard em todas as requisicoes.
 */
const schema = z.discriminatedUnion('chave', [
  z.object({ chave: z.literal('senha_local_habilitada'), valor: z.boolean() }),
  z.object({
    chave: z.literal('painel_integracao'),
    valor: z.object({
      url: z.string().trim().url().regex(/^https?:\/\//i, 'use http ou https'),
      // vazio = manter o token ja gravado
      token: z.string().trim().max(500).optional()
    })
  }),
  z.object({
    chave: z.literal('smtp_servidor_padrao'),
    valor: z.object({
      host: z.string().trim().min(1).max(200),
      port: z.number().int().min(1).max(65535),
      secure: z.boolean(),
      requireTls: z.boolean(),
      rejectUnauthorized: z.boolean()
    })
  }),
  z.object({
    chave: z.literal('retencao'),
    valor: z.object({
      ativa: z.boolean(),
      // pisos: prazo curto demais apagaria a prova antes de alguem precisar dela
      comunicadosMeses: z.number().int().min(0),
      solicitacoesMeses: z.number().int().min(0),
      assinadosAnos: z.number().int().min(0),
      lixeiraDias: z.number().int().min(0)
    })
  })
])

type Dados = z.infer<typeof schema>

function descrever(d: Dados) {
  if (d.chave === 'senha_local_habilitada') {
    return `${d.valor ? 'Ligou' : 'Desligou'} o acesso de emergência por senha local`
  }
  if (d.chave === 'painel_integracao') {
    return `Configurou a integração com o painel: ${d.valor.url}${d.valor.token ? ' (token novo)' : ''}`
  }
  if (d.chave === 'retencao') {
    const v = d.valor
    return v.ativa
      ? `Definiu a retenção: comunicados ${v.comunicadosMeses} meses, solicitações ${v.solicitacoesMeses} meses, assinados ${v.assinadosAnos} anos, lixeira ${v.lixeiraDias} dias`
      : 'Desligou a rotina de retenção (nada é apagado automaticamente)'
  }
  return `Definiu o servidor SMTP padrão dos canais: ${d.valor.host}:${d.valor.port}`
}

export default defineEventHandler(async event => {
  const op = exigirPapel(event, 'admin', 'alterar as configurações gerais')
  const d = validar(schema, await readBody(event))

  /**
   * Quem esta dentro PELA senha local nao pode desliga-la: perderia o acesso no
   * meio da operacao, e o sistema ficaria sem nenhum admin identificado para
   * religar se o painel estiver fora — que e justamente quando a senha e usada.
   */
  if (d.chave === 'senha_local_habilitada' && !d.valor && op.origem === 'senha') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Entre pelo painel para desligar a senha local: quem está dentro por ela perderia o acesso.'
    })
  }

  const antes = await lerConfig(d.chave)

  let valor: unknown = d.valor
  if (d.chave === 'painel_integracao') {
    // o token vai CIFRADO, como as senhas dos canais; vazio mantem o atual
    const atual = antes as { url: string; tokenCifrado: string } | null
    const tokenCifrado = d.valor.token ? cifrar(d.valor.token) : atual?.tokenCifrado
    if (!tokenCifrado) throw createError({ statusCode: 400, statusMessage: 'Informe o token de API do painel' })
    valor = { url: d.valor.url.replace(/\/+$/, ''), tokenCifrado }
  }
  await gravarConfig(d.chave, valor as never, op.nome)

  await auditar(event, 'config.alterar', {
    entidade: 'config',
    id: d.chave,
    resumo: descrever(d),
    // o token nunca vai para a trilha: a auditoria remove qualquer campo "token"
    dados: { chave: d.chave, de: antes, para: d.valor }
  })

  return { ok: true, chave: d.chave, valor: d.valor }
})
