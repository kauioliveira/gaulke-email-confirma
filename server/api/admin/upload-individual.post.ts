import { writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { unzipSync } from 'fflate'
import { garantirStorage, nomeSeguro, caminhoNoStorage } from '../../utils/storage'
import { TIPOS_ANEXO, tipoPelaExtensao, assinaturaConfere, rotulosDe } from '../../../shared/types/tipos-arquivo'
import { falhar } from '../../utils/erro'
import { auditar } from '../../utils/auditoria'

/**
 * Upload dos arquivos INDIVIDUAIS de um lote (um por destinatario): varios
 * arquivos de uma vez, e/ou um ou mais ZIPs, que sao abertos aqui.
 *
 * Cada arquivo passa pela MESMA conferencia do anexo unico — extensao aceita e
 * assinatura do conteudo (um .exe renomeado para .pdf e recusado). O que nao
 * passa volta listado com o motivo, e o resto segue: um arquivo ruim no meio
 * de 300 nao pode derrubar o upload inteiro.
 *
 * ZIP-BOMBA: o tamanho descompactado declarado de cada entrada e conferido
 * ANTES de descompactar (filtro do fflate), com teto por arquivo e no total.
 */

const MAX_POR_ARQUIVO = 25 * 1024 * 1024
const MAX_TOTAL = 400 * 1024 * 1024
const MAX_ARQUIVOS = 3000

type Aceito = { nome: string; original: string; tamanho: number; tipo: string }
type Recusado = { original: string; motivo: string }

export default defineEventHandler(async event => {
  let partes: Awaited<ReturnType<typeof readMultipartFormData>>
  try {
    partes = await readMultipartFormData(event)
  } catch (err) {
    throw falhar(event, 'recebimento dos arquivos', err)
  }
  const enviados = (partes ?? []).filter(p => p.name === 'arquivos' && p.filename)
  if (!enviados.length) throw createError({ statusCode: 400, statusMessage: 'Nenhum arquivo enviado' })

  // 1. expande os ZIPs; o resto entra como veio
  const candidatos: { original: string; dados: Uint8Array }[] = []
  const recusados: Recusado[] = []
  let total = 0

  for (const p of enviados) {
    const original = basename(p.filename!)
    if (/\.zip$/i.test(original)) {
      try {
        const dentro = unzipSync(new Uint8Array(p.data), {
          filter: f => {
            const nome = basename(f.name)
            // pastas, lixo do macOS e arquivos ocultos
            if (!nome || f.name.endsWith('/') || f.name.includes('__MACOSX') || nome.startsWith('.')) return false
            if (f.originalSize > MAX_POR_ARQUIVO) {
              recusados.push({ original: `${original} › ${nome}`, motivo: 'maior que 25 MB' })
              return false
            }
            total += f.originalSize
            if (total > MAX_TOTAL) {
              recusados.push({ original: `${original} › ${nome}`, motivo: 'passou do limite de 400 MB por envio' })
              return false
            }
            return true
          }
        })
        for (const [caminho, dados] of Object.entries(dentro)) candidatos.push({ original: basename(caminho), dados })
      } catch {
        recusados.push({ original, motivo: 'ZIP corrompido ou protegido por senha' })
      }
      continue
    }
    total += p.data.length
    if (p.data.length > MAX_POR_ARQUIVO) recusados.push({ original, motivo: 'maior que 25 MB' })
    else if (total > MAX_TOTAL) recusados.push({ original, motivo: 'passou do limite de 400 MB por envio' })
    else candidatos.push({ original, dados: new Uint8Array(p.data) })
  }

  if (candidatos.length > MAX_ARQUIVOS) {
    throw createError({ statusCode: 413, statusMessage: `São ${candidatos.length} arquivos; o limite é ${MAX_ARQUIVOS} por envio.` })
  }

  // 2. confere e grava cada um
  const aceitos: Aceito[] = []
  await garantirStorage()
  for (const c of candidatos) {
    const tipo = tipoPelaExtensao(c.original)
    if (!tipo) {
      recusados.push({ original: c.original, motivo: `formato não aceito (aceitos: ${rotulosDe(TIPOS_ANEXO)})` })
      continue
    }
    if (!assinaturaConfere(c.dados, tipo)) {
      recusados.push({ original: c.original, motivo: `o conteúdo não é de um ${tipo.rotulo} válido` })
      continue
    }
    const nome = nomeSeguro(c.original)
    try {
      await writeFile(caminhoNoStorage(nome), c.dados)
    } catch (err) {
      throw falhar(event, 'gravacao dos arquivos no storage', err)
    }
    aceitos.push({ nome, original: c.original, tamanho: c.dados.length, tipo: tipo.rotulo })
  }

  await auditar(event, 'arquivo.enviar_individuais', {
    entidade: 'arquivo',
    resumo: `Enviou ${aceitos.length} arquivo(s) individuais${recusados.length ? ` (${recusados.length} recusado(s))` : ''}`,
    dados: { aceitos: aceitos.length, recusados, bytes: aceitos.reduce((s, a) => s + a.tamanho, 0) }
  })

  return { aceitos, recusados }
})
