/**
 * Rede de seguranca do log: qualquer erro que escape de um handler aparece
 * aqui com a rota que o gerou. Sem isso, o unico registro em producao e um
 * stack solto no docker logs, sem dizer qual requisicao o produziu.
 */
export default defineNitroPlugin(nitro => {
  nitro.hooks.hook('error', (erro: any, ctx: any) => {
    const evento = ctx?.event
    const rota = evento ? `${evento.method} ${evento.path}` : 'sem rota'
    const status = Number(erro?.statusCode) || 500

    // 4xx e resposta esperada (arquivo invalido, sessao expirada): uma linha,
    // sem stack, so para dar rastro do que o operador viu na tela
    if (status < 500) {
      console.warn(`[gaulke-mail][${status}] ${rota} -> ${erro?.statusMessage || erro?.message}`)
      return
    }

    const codigo = erro?.code ? ` (${erro.code})` : ''
    console.error(
      `[gaulke-mail][nao tratado] ${rota} -> ${erro?.name || 'Error'}${codigo}: ${erro?.message}`
    )
    if (erro?.stack) console.error(erro.stack)
  })
})
