import type { H3Event } from 'h3'
import { basename } from 'node:path'
import { contar, marcar } from './limite'
import { lerPfx, ErroCertificado } from './certificados'
import type { Operador } from './permissoes'

/**
 * Le o multipart do cadastro/teste de certificado (arquivo + senha) e abre o
 * .pfx. A senha so existe dentro desta funcao: nao vai para log, auditoria
 * nem banco.
 *
 * Testar senha e um oraculo ("esta senha abre?"): 10 senhas ERRADAS por 10
 * minutos por pessoa, para ninguem descobrir a senha na forca bruta. So o erro
 * conta: quem acerta e cadastra nao gasta tentativa.
 */
const JANELA = 10 * 60_000
export async function abrirPfxDoRequest(event: H3Event, op: Operador) {
  const chave = `cert-senha:${op.id ?? 'senha-local'}`
  if (contar(chave, JANELA) >= 10) {
    throw createError({ statusCode: 429, statusMessage: 'Muitas tentativas de senha. Aguarde alguns minutos.' })
  }
  const partes = (await readMultipartFormData(event)) ?? []
  const arq = partes.find(p => p.name === 'arquivo' && p.filename)
  const senha = partes.find(p => p.name === 'senha')?.data.toString('utf8') ?? ''
  const nome = partes.find(p => p.name === 'nome')?.data.toString('utf8').trim() ?? ''
  if (!arq) throw createError({ statusCode: 400, statusMessage: 'Envie o arquivo .pfx ou .p12' })
  if (!/\.(pfx|p12)$/i.test(arq.filename!)) throw createError({ statusCode: 415, statusMessage: 'O certificado A1 é um arquivo .pfx ou .p12' })
  if (arq.data.length > 64 * 1024) throw createError({ statusCode: 413, statusMessage: 'Arquivo grande demais para um certificado A1' })
  try {
    return { dados: lerPfx(arq.data, senha), nomeArquivo: basename(arq.filename!), nome }
  } catch (e) {
    if (e instanceof ErroCertificado) {
      if (/senha/i.test(e.message)) marcar(chave, JANELA)
      throw createError({ statusCode: 422, statusMessage: e.message })
    }
    throw e
  }
}
