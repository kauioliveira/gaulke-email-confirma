import { randomInt } from 'node:crypto'

/**
 * Codigos publicos: PREFIXO-<ano 2 digitos>-<6 sorteados>, ex. SOL-26-X7K2P9.
 *
 * Sorteados em vez de sequenciais: SOL-000012 contava a quem recebia quantos
 * pedidos a Gaulke ja fez. O alfabeto deixa de fora o que se confunde ao ler
 * ou ditar (0/O, 1/I/L): 31^6 ≈ 887 milhoes de combinacoes por ano.
 */
export const ALFABETO_CODIGO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

export async function sortearCodigo(prefixo: 'SOL' | 'ASS', existe: (codigo: string) => Promise<boolean>) {
  const ano = dataSP().slice(2, 4)
  for (let i = 0; i < 20; i++) {
    const codigo = `${prefixo}-${ano}-${Array.from({ length: 6 }, () => ALFABETO_CODIGO[randomInt(ALFABETO_CODIGO.length)]).join('')}`
    if (!(await existe(codigo))) return codigo
  }
  throw new Error(`não foi possível sortear um código ${prefixo} livre`)
}

/** Reconhece os dois formatos: o atual (SOL-26-X7K2P9) e o antigo (SOL-000123). */
export const RE_CODIGO_PUBLICO = (prefixo: 'SOL' | 'ASS') => new RegExp(`\\b${prefixo}-(?:\\d{2}-[A-Z0-9]{6}|\\d{6})\\b`, 'g')
