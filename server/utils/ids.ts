import { randomUUID, randomInt } from 'node:crypto'

/** Alfabeto sem caracteres ambiguos (0/O, 1/I/L) para o codigo ser ditado por telefone. */
const ALFABETO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

export function novoToken() {
  return randomUUID()
}

/** Ex.: GLK-7F3K-2M9Q */
export function novoCodigo(prefixo = 'GLK') {
  const bloco = (n: number) =>
    Array.from({ length: n }, () => ALFABETO[randomInt(ALFABETO.length)]).join('')
  return `${prefixo}-${bloco(4)}-${bloco(4)}`
}
