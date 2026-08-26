import { readdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

/**
 * Imagens disponiveis para o bloco de imagem do editor visual.
 *
 * Sao lidas de public/brand porque precisam ser alcancaveis pela INTERNET —
 * o cliente de e-mail busca a imagem de fora. O diretorio storage/files, onde
 * ficam os PDFs, e privado de proposito e nao serve aqui.
 */
export default defineEventHandler(async () => {
  const dir = resolve(process.cwd(), 'public/brand')
  try {
    const nomes = await readdir(dir)
    const arquivos = []
    for (const nome of nomes) {
      if (nome.startsWith('.')) continue
      if (!/\.(png|jpe?g|gif|webp)$/i.test(nome)) continue
      const s = await stat(resolve(dir, nome))
      if (s.isFile()) arquivos.push({ nome, tamanho: s.size })
    }
    return { arquivos: arquivos.sort((a, b) => a.nome.localeCompare(b.nome)) }
  } catch {
    return { arquivos: [] }
  }
})
