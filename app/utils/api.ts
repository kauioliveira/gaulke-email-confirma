import { withBase } from 'ufo'

/**
 * Prefixa o caminho com o app.baseURL.
 *
 * URL_ACESSO pode conter um subcaminho (ex.: https://dominio.com.br/notifica/).
 * Quando isso acontece, o app inteiro — inclusive /api — e servido sob esse
 * prefixo, entao todo fetch precisa passar por aqui. Em desenvolvimento o
 * baseURL e "/" e a funcao devolve o caminho inalterado.
 */
export function api(caminho: string) {
  const base = useRuntimeConfig().app.baseURL || '/'
  return base === '/' ? caminho : withBase(caminho, base)
}
