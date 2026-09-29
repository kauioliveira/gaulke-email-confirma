/**
 * Sessao e papel de quem esta usando a tela.
 *
 * A sessao e carregada pelo middleware `admin` a cada navegacao e guardada
 * aqui, para o layout e as paginas lerem sem repetir a requisicao.
 *
 * O papel so ESCONDE o que a pessoa nao pode fazer — conveniencia. Quem decide
 * de verdade e o servidor (server/utils/permissoes.ts): um botao escondido que
 * alguem chame na mao continua recebendo 403.
 */

const NIVEL: Record<PapelOperador, number> = { usuario: 0, supervisor: 1, admin: 2 }

export const ROTULO_PAPEL: Record<PapelOperador, string> = {
  usuario: 'Usuário',
  supervisor: 'Supervisor',
  admin: 'Administrador'
}

export function useSessao() {
  return useState<RespostaSessao | null>('sessao', () => null)
}

export function usePapel() {
  const sessao = useSessao()
  const papel = computed<PapelOperador>(() => sessao.value?.usuario?.papel ?? 'usuario')
  const pode = (minimo: PapelOperador) => NIVEL[papel.value] >= NIVEL[minimo]
  return {
    sessao,
    papel,
    pode,
    eAdmin: computed(() => pode('admin')),
    eSupervisor: computed(() => pode('supervisor'))
  }
}

declare module '#app' {
  interface PageMeta {
    /** papel minimo para abrir a pagina; sem ele, qualquer usuario ativo */
    papel?: PapelOperador
  }
}
