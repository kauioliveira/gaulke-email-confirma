import { useSql } from '../db'

/**
 * Setores do cadastro do painel (public.department).
 *
 * SOMENTE LEITURA e com SQL puro, pelo mesmo motivo de pessoas.get.ts: a
 * tabela pertence a outro sistema e nao entra no schema deste.
 */

export type Departamento = { id: number; nome: string }

export async function listarDepartamentos(): Promise<Departamento[]> {
  return useSql()<Departamento[]>`select id, name as nome from public.department order by name`
}

/** id -> nome, para mostrar o setor de templates e modelos. */
export async function nomesDosDepartamentos(): Promise<Map<number, string>> {
  return new Map((await listarDepartamentos()).map(d => [d.id, d.nome]))
}
