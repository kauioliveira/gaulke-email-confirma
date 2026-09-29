import { eq } from 'drizzle-orm'
import { useDb, accounts } from '../../../db'
import { contaSchema, contaParaTeste, valoresParaBanco, rebaixarOutrasPadrao, serializar } from '../../../utils/contas'
import { verificarConta } from '../../../utils/mailer'
import { cifrar, decifrar } from '../../../utils/cripto'
import { verificarDominio } from '../../../utils/dns-email'
import { testarImap } from '../../../utils/caixa/monitor'
import { exigirPapel } from '../../../utils/permissoes'
import { auditar } from '../../../utils/auditoria'

/**
 * Edita uma conta. Senha vazia mantem a atual.
 *
 * Assim como na criacao, so grava se a conexao responder — inclusive quando se
 * mudou apenas o rotulo. E de proposito: o efeito colateral e que uma conta com
 * o servidor fora do ar nao pode ser editada, e para esse caso existe o
 * desativar, que nao testa.
 */
export default defineEventHandler(async event => {
  const op = exigirPapel(event, 'admin', 'editar canais de saída')
  const id = Number(getRouterParam(event, 'id'))
  const d = validar(contaSchema, await readBody(event))

  const db = useDb()
  const [atual] = await db.select().from(accounts).where(eq(accounts.id, id))
  if (!atual) throw createError({ statusCode: 404, statusMessage: 'Conta nao encontrada' })

  const senha = d.senha || decifrar(atual.senhaCifrada)

  const teste = await verificarConta(contaParaTeste(d, senha))
  if (!teste.ok) {
    throw createError({
      statusCode: 400,
      statusMessage: `A conexao falhou, entao nada foi alterado: ${teste.mensagem}`
    })
  }

  if (d.monitorarCaixa) {
    const imap = await testarImap({
      host: d.host, imapHost: d.imapHost || null, imapPort: d.imapPort, imapSecure: d.imapSecure,
      usuario: d.usuario, senhaCifrada: d.senha ? cifrar(d.senha) : atual.senhaCifrada, rejectUnauthorized: String(d.rejectUnauthorized)
    })
    if (!imap.ok) {
      throw createError({ statusCode: 400, statusMessage: `A leitura da caixa (IMAP) falhou, então nada foi alterado: ${imap.mensagem}` })
    }
  }

  const [conta] = await db
    .update(accounts)
    .set({
      ...valoresParaBanco(d, d.senha ? cifrar(d.senha) : atual.senhaCifrada),
      ultimoTesteEm: new Date(),
      ultimoTesteOk: 'true',
      ultimoTesteMsg: teste.mensagem,
      atualizadoPorNome: op.nome,
      updatedAt: new Date()
    })
    .where(eq(accounts.id, id))
    .returning()

  if (!conta) throw createError({ statusCode: 500, statusMessage: 'Nao foi possivel salvar a conta' })
  if (d.padrao) await rebaixarOutrasPadrao(conta.id)

  // so os campos que mudaram, com o antes e o depois; a senha nunca entra,
  // so o fato de ter sido trocada
  const antes = serializar(atual) as Record<string, unknown>
  const depois = serializar(conta) as Record<string, unknown>
  const ignorar = new Set(['updatedAt', 'ultimoTesteEm', 'ultimoTesteOk', 'ultimoTesteMsg'])
  const mudou = Object.fromEntries(
    Object.keys(depois)
      .filter(k => !ignorar.has(k) && JSON.stringify(antes[k]) !== JSON.stringify(depois[k]))
      .map(k => [k, { de: antes[k], para: depois[k] }])
  )
  await auditar(event, 'conta.editar', {
    entidade: 'conta',
    id: conta.id,
    resumo:
      `Editou o canal de saída "${conta.nome}"` +
      (Object.keys(mudou).length ? ` (${Object.keys(mudou).join(', ')})` : '') +
      (d.senha ? ' e trocou a credencial' : ''),
    dados: mudou
  })

  return { conta: serializar(conta), teste: { ...teste, dns: await verificarDominio(conta.remetente) } }
})
