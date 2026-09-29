import { buscarClientes } from '../../../utils/clientes'

/** Busca de clientes para a linha do tempo: por nome, e-mail, empresa ou CPF/CNPJ. */
export default defineEventHandler(async event => {
  const q = String(getQuery(event).q || '')
  return buscarClientes(q)
})
