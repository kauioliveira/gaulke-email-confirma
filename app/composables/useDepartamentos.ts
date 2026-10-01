/**
 * Seletor de setor de templates e modelos de checklist.
 *
 * O USelect lida mal com `null`, entao "todos os setores" vira o valor
 * 'todos' e os setores viram o id em texto; `paraId` desfaz isso ao salvar.
 * Fora o admin, as opcoes sao so o proprio setor e "todos" — o servidor
 * garante o mesmo (setorAoSalvar).
 */

const TODOS = 'todos'

export function useDepartamentos() {
  const { data } = useFetch<RespostaDepartamentos>(api('/api/admin/departamentos'), {
    key: 'departamentos',
    default: () => ({ departamentos: [], meu: null })
  })

  const opcoes = computed(() => [
    { label: 'Todos os setores', value: TODOS },
    ...data.value.departamentos.map(d => ({ label: d.nome, value: String(d.id) }))
  ])

  const paraValor = (id: number | null | undefined) => (id == null ? TODOS : String(id))
  const paraId = (valor: string) => (valor === TODOS ? null : Number(valor))

  return {
    opcoes,
    /** o que um template/modelo novo traz marcado: o setor de quem cria */
    padrao: computed(() => paraValor(data.value.meu)),
    paraValor,
    paraId
  }
}
