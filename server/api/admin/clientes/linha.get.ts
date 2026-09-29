import { linhaDoTempo } from '../../../utils/clientes'

/** Tudo de um cliente, por e-mail e/ou CPF/CNPJ. */
export default defineEventHandler(async event => {
  const q = getQuery(event)
  const email = String(q.email || '').trim()
  const documento = String(q.documento || '').replace(/\D/g, '')
  if (!email && !documento) throw createError({ statusCode: 400, statusMessage: 'Informe o e-mail ou o CPF/CNPJ' })
  return linhaDoTempo({ email: email || null, documento: documento || null })
})
