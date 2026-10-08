import ModalPergunta from '~/components/ModalPergunta.vue'

/**
 * Pergunta sim/não em modal, no lugar do confirm() do navegador:
 *
 *   const confirmar = useConfirmar()            // no setup
 *   if (!(await confirmar({ titulo: 'Excluir?', cor: 'error' }))) return
 *
 * Esc ou clique fora contam como "Não".
 */
export function useConfirmar() {
  const modal = useOverlay().create(ModalPergunta)
  return async (o: {
    titulo: string
    descricao?: string
    sim?: string
    nao?: string
    cor?: 'primary' | 'error' | 'warning'
    icone?: string
  }) => (await modal.open(o).result) === true
}
