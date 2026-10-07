import { z } from 'zod'
import { cadastrosDosDocumentos, contatosDasEmpresas } from '../../../utils/empresa-contatos'
import type { DocumentoResolvido } from '../../../../shared/types/api'

/**
 * Lote "arquivos por cliente": para cada CPF/CNPJ achado nos arquivos, quem e
 * a empresa e para quais e-mails ela ja recebeu (sys_mail_empresa_contatos).
 * A tela chama de novo depois de importar uma planilha de contatos.
 */
const schema = z.object({ documentos: z.array(z.string().max(20)).max(5000) })

export default defineEventHandler(async (event): Promise<DocumentoResolvido[]> => {
  const { documentos } = validar(schema, await readBody(event))
  const docs = [...new Set(documentos.map(d => d.replace(/\D/g, '')).filter(d => d.length === 11 || d.length === 14))]
  if (!docs.length) return []
  const [cadastros, contatos] = await Promise.all([cadastrosDosDocumentos(docs), contatosDasEmpresas(docs, 20)])
  return docs.map(documento => {
    const c = cadastros.get(documento)
    return {
      documento,
      nome: c?.nome ?? null,
      fantasia: c?.fantasia ?? null,
      ativo: c?.ativo ?? true,
      origem: c?.origem ?? null,
      emails: contatos.get(documento) ?? []
    }
  })
})
