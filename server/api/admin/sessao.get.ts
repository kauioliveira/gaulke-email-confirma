import { sessaoValida } from '../../utils/auth'

export default defineEventHandler(event => ({ autenticado: sessaoValida(event) }))
