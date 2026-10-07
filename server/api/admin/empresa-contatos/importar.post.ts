import { z } from 'zod'
import { registrarContatosEmpresa } from '../../../utils/empresa-contatos'
import { auditar } from '../../../utils/auditoria'
import { documentoValidoDV, soDigitosDoc } from '../../../../shared/utils/documento'

/**
 * Importa e-mails por CPF/CNPJ (planilha CSV/TXT/Excel ja lida e mapeada na
 * tela, pela mesma rota /api/admin/importar das listas). Grava no cadastro
 * de contatos por empresa — o mesmo que o lote "arquivos por cliente" usa
 * para achar o e-mail de cada CNPJ.
 *
 * A tela ja separa o que e invalido; aqui a conferencia se repete, porque a
 * rota pode ser chamada direto.
 */
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

const schema = z.object({
  arquivo: z.string().max(260).nullish(),
  contatos: z
    .array(
      z.object({
        documento: z.string().max(30),
        email: z.string().max(320),
        nome: z.string().max(200).nullish(),
        empresa: z.string().max(200).nullish()
      })
    )
    .min(1)
    .max(20000)
})

export default defineEventHandler(async event => {
  const d = validar(schema, await readBody(event))
  const validos: { documento: string; email: string; nome: string | null; empresa: string | null }[] = []
  let invalidos = 0
  for (const c of d.contatos) {
    const documento = soDigitosDoc(c.documento)
    const email = c.email.trim().toLowerCase()
    if (!documentoValidoDV(documento) || !RE_EMAIL.test(email)) {
      invalidos++
      continue
    }
    validos.push({ documento, email, nome: c.nome?.trim() || null, empresa: c.empresa?.trim() || null })
  }
  if (!validos.length) throw createError({ statusCode: 400, statusMessage: 'Nenhuma linha válida (CPF/CNPJ + e-mail) para importar.' })

  await registrarContatosEmpresa(validos, 'importacao')
  const documentos = new Set(validos.map(v => v.documento)).size

  await auditar(event, 'empresa_contato.importar', {
    entidade: 'empresa_contato',
    resumo: `Importou ${validos.length} e-mail(s) de ${documentos} CPF/CNPJ${d.arquivo ? ` (${d.arquivo})` : ''}`,
    dados: { arquivo: d.arquivo ?? null, gravados: validos.length, documentos, invalidos }
  })
  return { gravados: validos.length, documentos, invalidos }
})
