import { resolve, basename, extname, sep } from 'node:path'
import { mkdir, readdir, stat } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { semAspas } from './env'

export function storageDir() {
  return resolve(process.cwd(), semAspas(useRuntimeConfig().storageDir || process.env.STORAGE_DIR) || './storage/files')
}

export async function garantirStorage() {
  const dir = storageDir()
  await mkdir(dir, { recursive: true })
  return dir
}

/** Nome seguro: sem acentos, sem espacos e sem chance de path traversal. */
export function nomeSeguro(original: string) {
  const ext = extname(original).toLowerCase().slice(0, 10)
  const base = basename(original, extname(original))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)
  return `${base || 'arquivo'}-${randomBytes(4).toString('hex')}${ext}`
}

/**
 * Resolve um nome de arquivo dentro do storage garantindo que ele nao
 * escape do diretorio (../../etc/passwd).
 */
export function caminhoNoStorage(nomeArquivo: string) {
  const dir = storageDir()
  const alvo = resolve(dir, basename(nomeArquivo))
  if (alvo !== dir && !alvo.startsWith(dir + sep)) {
    throw createError({ statusCode: 400, statusMessage: 'Caminho de arquivo invalido' })
  }
  return alvo
}

export async function listarArquivos() {
  const dir = await garantirStorage()
  const nomes = await readdir(dir)
  const saida = []
  for (const nome of nomes) {
    if (nome.startsWith('.')) continue
    const s = await stat(resolve(dir, nome))
    if (!s.isFile()) continue
    saida.push({ nome, tamanho: s.size, modificadoEm: s.mtime.toISOString() })
  }
  return saida.sort((a, b) => b.modificadoEm.localeCompare(a.modificadoEm))
}

/* -------------------------------------------------------------------------
 * Imagens do editor visual
 *
 * Ficam SEPARADAS dos anexos em storage/files por dois motivos: elas sao
 * PUBLICAS (o cliente de e-mail busca a imagem de fora, sem sessao) e nao
 * passam pelo registro de download. Servi-las do mesmo diretorio dos anexos
 * abriria uma porta sem token para os documentos.
 *
 * Tambem nao ficam em public/brand: aquele diretorio e assado na imagem
 * Docker e NAO tem volume — toda imagem enviada sumiria no deploy seguinte,
 * quebrando a arte dos e-mails ja entregues.
 * ---------------------------------------------------------------------- */

export function imagensDir() {
  return resolve(
    process.cwd(),
    semAspas(useRuntimeConfig().imagensDir || process.env.IMAGENS_DIR) || './storage/imagens'
  )
}

export async function garantirImagens() {
  const dir = imagensDir()
  await mkdir(dir, { recursive: true })
  return dir
}

/** Mesma protecao de path traversal de caminhoNoStorage, no diretorio de imagens. */
export function caminhoNaImagem(nomeArquivo: string) {
  const dir = imagensDir()
  const alvo = resolve(dir, basename(nomeArquivo))
  if (alvo !== dir && !alvo.startsWith(dir + sep)) {
    throw createError({ statusCode: 400, statusMessage: 'Caminho de imagem invalido' })
  }
  return alvo
}

export async function listarImagens() {
  const dir = await garantirImagens()
  const nomes = await readdir(dir)
  const saida = []
  for (const nome of nomes) {
    if (nome.startsWith('.')) continue
    const s = await stat(resolve(dir, nome))
    if (!s.isFile()) continue
    saida.push({ nome, tamanho: s.size, modificadoEm: s.mtime.toISOString() })
  }
  return saida.sort((a, b) => b.modificadoEm.localeCompare(a.modificadoEm))
}
