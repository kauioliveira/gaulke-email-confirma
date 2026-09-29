import { z } from 'zod'
import { and, inArray, isNotNull, isNull, notInArray } from 'drizzle-orm'
import { useDb, batches } from '../../../db'
import { operadorAtual } from '../../../utils/permissoes'
import { foraDaLixeira, STATUS_NAO_ARQUIVAVEIS } from '../../../utils/lotes'
import { auditar } from '../../../utils/auditoria'

const schema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(500),
  /** true arquiva, false tira do arquivo */
  arquivar: z.boolean()
})

/**
 * Arquiva ou desarquiva lotes (um ou varios).
 *
 * Arquivar e so organizacao da lista: links, confirmacao e download continuam
 * funcionando para o destinatario, e o relatorio continua enxergando tudo.
 * Lote rodando ou agendado nao arquiva — sumiria da lista com trabalho pela
 * frente.
 */
export default defineEventHandler(async event => {
  const op = operadorAtual(event)
  const { ids, arquivar } = validar(schema, await readBody(event))

  const alterados = await useDb()
    .update(batches)
    .set(arquivar ? { arquivadoEm: new Date(), arquivadoPorNome: op.nome } : { arquivadoEm: null, arquivadoPorNome: null })
    .where(
      and(
        inArray(batches.id, ids),
        foraDaLixeira,
        arquivar
          ? and(isNull(batches.arquivadoEm), notInArray(batches.status, [...STATUS_NAO_ARQUIVAVEIS]))
          : isNotNull(batches.arquivadoEm)
      )
    )
    .returning({ id: batches.id, nome: batches.nome })

  if (alterados.length) {
    await auditar(event, arquivar ? 'lote.arquivar' : 'lote.desarquivar', {
      entidade: 'lote',
      id: alterados.length === 1 ? alterados[0]!.id : null,
      resumo:
        alterados.length === 1
          ? `${arquivar ? 'Arquivou' : 'Desarquivou'} o lote "${alterados[0]!.nome}"`
          : `${arquivar ? 'Arquivou' : 'Desarquivou'} ${alterados.length} lotes`,
      dados: { lotes: alterados }
    })
  }

  return {
    ok: true,
    alterados: alterados.length,
    // o que nao entrou (rodando, agendado, ja no estado pedido) volta para a tela explicar
    ignorados: ids.length - alterados.length
  }
})
