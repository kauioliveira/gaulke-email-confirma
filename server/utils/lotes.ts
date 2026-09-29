import { isNull } from 'drizzle-orm'
import { batches } from '../db'

/**
 * Condicao "lote fora da lixeira".
 *
 * A exclusao de lote enviado e LOGICA (decisao D2): a linha continua no banco
 * com excluido_em preenchido, porque destinatarios e eventos sao a prova de
 * entrega. Toda consulta que mostra lote — telas, relatorio, contatos, rotas
 * publicas do destinatario, agendador — precisa desta condicao; so a lixeira
 * olha o contrario.
 */
export const foraDaLixeira = isNull(batches.excluidoEm)

/** Status em que um lote pode ser arquivado: nada rodando nem por rodar. */
export const STATUS_NAO_ARQUIVAVEIS = ['enviando', 'agendado'] as const
