/**
 * Prefixa o caminho com o app.baseURL.
 *
 * URL_ACESSO pode conter um subcaminho (ex.: https://dominio.com.br/notifica/).
 * Quando isso acontece, o app inteiro — inclusive /api — e servido sob esse
 * prefixo, entao todo fetch precisa passar por aqui. Em desenvolvimento o
 * baseURL e "/" e a funcao devolve o caminho inalterado.
 *
 * Antes isto usava `withBase` do pacote `ufo`, que NAO e dependencia declarada
 * do projeto: funcionava so porque o npm "achata" o node_modules. Com um
 * gerenciador estrito (pnpm) o import quebrava. A regra e simples o bastante
 * para viver aqui.
 */
export function api(caminho: string) {
  const base = useRuntimeConfig().app.baseURL || '/'
  if (base === '/') return caminho
  const prefixo = base.replace(/\/+$/, '')
  // ja prefixado: nao duplica
  if (caminho === prefixo || caminho.startsWith(`${prefixo}/`)) return caminho
  return `${prefixo}${caminho.startsWith('/') ? '' : '/'}${caminho}`
}
