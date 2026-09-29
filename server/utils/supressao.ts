import { inArray } from 'drizzle-orm'
import { useDb, supressao } from '../db'

/**
 * Lista de supressao: enderecos que devolveram DEFINITIVAMENTE (endereco ou
 * dominio inexistente). Mandar de novo para eles so gera outra devolucao e
 * piora a reputacao do servidor de e-mail — o que faz os envios BONS cairem
 * no spam. O endereco sai da lista quando alguem o corrige no destinatario,
 * ou quando um supervisor o remove pela tela.
 */

export async function suprimir(
  email: string,
  o: { motivo: string | null; origem: 'devolucao' | 'manual'; recipientId?: number | null; porNome?: string | null }
) {
  await useDb()
    .insert(supressao)
    .values({
      email: email.trim().toLowerCase(),
      motivo: o.motivo?.slice(0, 1000) ?? null,
      origem: o.origem,
      recipientId: o.recipientId ?? null,
      criadoPorNome: o.porNome ?? null
    })
    .onConflictDoNothing()
}

/** Quais destes e-mails estao suprimidos (com o motivo). */
export async function suprimidos(emails: string[]) {
  const lista = [...new Set(emails.map(e => e.trim().toLowerCase()).filter(Boolean))]
  if (!lista.length) return []
  const linhas: { email: string; motivo: string | null; criadoEm: Date }[] = []
  // em fatias: listas de milhares de e-mails estourariam o limite de parametros
  for (let i = 0; i < lista.length; i += 1000) {
    linhas.push(
      ...(await useDb()
        .select({ email: supressao.email, motivo: supressao.motivo, criadoEm: supressao.criadoEm })
        .from(supressao)
        .where(inArray(supressao.email, lista.slice(i, i + 1000))))
    )
  }
  return linhas
}
