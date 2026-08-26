import { encerrarSessao } from '../../utils/auth'

export default defineEventHandler(event => {
  encerrarSessao(event)
  return { ok: true }
})
