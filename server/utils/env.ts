/**
 * Remove aspas que envolvem o valor de uma variavel de ambiente.
 *
 * O dotenv (usado por `nuxt dev` e por `node --env-file`) tira as aspas de
 * VAR="valor". O `--env-file` do Docker NAO tira: o valor chega literalmente
 * com as aspas. Como o mesmo .env costuma servir os dois casos, normalizamos
 * na leitura em vez de depender de quem escreveu o arquivo.
 */
export function semAspas(valor: string | undefined | null) {
  if (!valor) return ''
  const v = String(valor).trim()
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    return v.slice(1, -1)
  }
  return v
}
