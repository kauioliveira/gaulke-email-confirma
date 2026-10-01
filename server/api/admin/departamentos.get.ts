import { listarDepartamentos } from '../../utils/departamentos'
import { operadorAtual } from '../../utils/permissoes'

/**
 * Setores para os seletores de template e modelo. `meu` e o setor de quem esta
 * olhando; fora o admin, so ele e "todos os setores" podem ser escolhidos.
 */
export default defineEventHandler(async event => {
  const op = operadorAtual(event)
  const todos = await listarDepartamentos()
  return {
    departamentos: op.papel === 'admin' ? todos : todos.filter(d => d.id === op.departamentoId),
    meu: op.departamentoId
  }
})
