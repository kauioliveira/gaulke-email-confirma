import { randomBytes } from 'node:crypto'
import type { H3Event } from 'h3'

/**
 * Registro e repasse de falhas inesperadas.
 *
 * Em producao o Nitro troca qualquer excecao nao tratada por um generico
 * "Server Error": o operador ve uma tela vermelha sem uma palavra sobre o que
 * aconteceu, e no log fica so o stack cru, sem a rota nem o arquivo que
 * causou. Este helper faz as duas pontas:
 *
 *  - LOG: uma linha por falha, com id, rota, operador e o codigo real do erro
 *    (EACCES, ENOSPC, ECONNREFUSED...), que e o que diz onde olhar.
 *  - RESPOSTA: o mesmo id e a mensagem real voltam para a tela. A escolha aqui
 *    e deliberada: este painel e interno, e um erro que ninguem consegue ler
 *    custa mais caro do que um erro feio.
 */

export type DetalheErro = {
  id: string
  escopo: string
  nome: string
  codigo: string | null
  mensagem: string
  dica: string | null
}

/** Traduz codigos de erro de sistema no que costuma ser a causa real. */
function dicaDoCodigo(codigo: string | null, escopo: string) {
  switch (codigo) {
    case 'EACCES':
    case 'EPERM':
      return `Sem permissao de escrita. Em producao o container roda como o usuario "app": confira o dono do volume (docker exec gaulke-email-confirma ls -ln /app/storage) e, se estiver root, rode chown -R.`
    case 'ENOSPC':
      return 'Disco cheio no servidor.'
    case 'ENOENT':
      return 'Caminho inexistente. Se for o storage, o volume pode nao ter sido montado.'
    case 'EROFS':
      return 'Sistema de arquivos somente leitura — confira a montagem do volume.'
    case 'ECONNREFUSED':
    case 'ETIMEDOUT':
      return 'Conexao recusada: banco ou SMTP fora do ar, ou host/porta errados no .env.production.'
    case 'ERR_STREAM_PREMATURE_CLOSE':
    case 'ECONNRESET':
      return 'A requisicao foi cortada antes de terminar — normalmente o proxy (Nginx/NPM) barrando o tamanho do corpo. Aumente o client_max_body_size do host no proxy.'
    default:
      return escopo.includes('upload') || escopo.includes('importacao')
        ? 'Confira o log do container (docker logs gaulke-email-confirma) pelo id acima.'
        : null
  }
}

/**
 * Loga a falha e devolve o erro pronto para `throw`.
 * Erros ja tratados (createError com 4xx) passam sem alteracao — eles ja
 * carregam uma mensagem escrita para quem opera.
 */
export function falhar(event: H3Event, escopo: string, err: unknown) {
  const e = err as any
  const jaTratado = typeof e?.statusCode === 'number' && e.statusCode < 500
  if (jaTratado) return e

  const id = randomBytes(3).toString('hex')
  const codigo = e?.code ? String(e.code) : null
  const mensagem = String(e?.message || e || 'erro desconhecido')
  const detalhe: DetalheErro = {
    id,
    escopo,
    nome: String(e?.name || 'Error'),
    codigo,
    mensagem,
    dica: dicaDoCodigo(codigo, escopo)
  }

  const req = `${event.method} ${getRequestURL(event).pathname}`
  const quem = event.context.operador?.nome || 'sessao/senha'
  console.error(
    `[gaulke-mail][erro ${id}] ${escopo} | ${req} | operador: ${quem} | ` +
      `${detalhe.nome}${codigo ? ` (${codigo})` : ''}: ${mensagem}` +
      (detalhe.dica ? `\n  -> ${detalhe.dica}` : '')
  )
  if (e?.stack) console.error(e.stack)

  return createError({
    statusCode: 500,
    // a mensagem real vai junto: e ela que a tela mostra
    statusMessage: `${escopo} falhou — ${mensagem}${codigo ? ` (${codigo})` : ''} [erro ${id}]`,
    data: detalhe
  })
}
