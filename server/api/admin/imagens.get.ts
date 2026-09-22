import { readdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { listarImagens } from '../../utils/storage'
import { TIPOS_IMAGEM } from '../../../shared/types/tipos-arquivo'

export type ImagemDisponivel = {
  nome: string
  /** o que o bloco de imagem guarda: 'brand/x.png' ou 'img/y.png' */
  caminho: string
  origem: 'sistema' | 'enviada'
  tamanho: number
}

const EXTENSOES = TIPOS_IMAGEM.flatMap(t => t.extensoes)

/** Artes fixas que vieram no codigo (public/brand). Nao da para apagar pela tela. */
async function daMarca(): Promise<ImagemDisponivel[]> {
  const dir = resolve(process.cwd(), 'public/brand')
  try {
    const nomes = await readdir(dir)
    const saida: ImagemDisponivel[] = []
    for (const nome of nomes) {
      if (nome.startsWith('.')) continue
      if (!EXTENSOES.some(e => nome.toLowerCase().endsWith(e))) continue
      const s = await stat(resolve(dir, nome))
      if (s.isFile()) {
        saida.push({ nome, caminho: `brand/${nome}`, origem: 'sistema', tamanho: s.size })
      }
    }
    return saida.sort((a, b) => a.nome.localeCompare(b.nome))
  } catch {
    return []
  }
}

/**
 * Imagens disponiveis para o bloco de imagem do editor visual, das duas
 * origens numa lista so — a tela nao precisa saber onde cada uma mora.
 *
 * As enviadas vem primeiro porque sao as recentes: quem acabou de subir uma
 * arte quer encontra-la no topo, nao depois dos cabecalhos fixos.
 */
export default defineEventHandler(async () => {
  const enviadas: ImagemDisponivel[] = (await listarImagens()).map(a => ({
    nome: a.nome,
    caminho: `img/${a.nome}`,
    origem: 'enviada' as const,
    tamanho: a.tamanho
  }))
  return { arquivos: [...enviadas, ...(await daMarca())] }
})
