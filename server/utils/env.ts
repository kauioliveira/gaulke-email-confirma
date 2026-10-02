/**
 * Remove aspas que envolvem o valor de uma variavel de ambiente.
 *
 * O dotenv (usado por `nuxt dev` e por `node --env-file`) tira as aspas de
 * VAR="valor". O `--env-file` do Docker NAO tira: o valor chega literalmente
 * com as aspas. Como o mesmo .env costuma servir os dois casos, normalizamos
 * na leitura em vez de depender de quem escreveu o arquivo.
 */
/**
 * Acesso de emergencia pela senha local (decisao D3), ligado POR AMBIENTE:
 * ACESSO_EMERGENCIA=true no .env de desenvolvimento, false no .env.production.
 * Ausente ou qualquer outro valor = desligado (o lado seguro).
 */
export function acessoEmergenciaLiberado() {
  return /^(1|true|sim|on)$/i.test(semAspas(process.env.ACESSO_EMERGENCIA))
}

export function semAspas(valor: string | undefined | null) {
  if (!valor) return ''
  const v = String(valor).trim()
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    return v.slice(1, -1)
  }
  return v
}
