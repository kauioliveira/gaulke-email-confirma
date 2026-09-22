/**
 * Tipos de arquivo aceitos pelo sistema — fonte unica.
 *
 * O mesmo mapa responde tres perguntas que antes estavam espalhadas e
 * divergiam entre si:
 *   1. o upload pode aceitar este arquivo?      (server/api/admin/upload.post.ts)
 *   2. com que content-type ele volta no download? (server/api/c/[token]/arquivo.get.ts)
 *   3. que `accept` o input da tela oferece?     (app/pages/admin/lotes/novo.vue)
 *
 * A EXTENSAO NAO E PROVA DE NADA: qualquer um renomeia um .exe para .pdf. Por
 * isso cada entrada carrega tambem a ASSINATURA (magic bytes) do formato, que
 * e conferida no conteudo. Onde o formato nao tem assinatura — .csv e .txt sao
 * texto puro — a checagem cai para extensao e tamanho, de proposito.
 *
 * Executaveis e scripts ficam FORA da lista deliberadamente: o arquivo e
 * entregue a clientes por link, e nao ha antivirus no caminho.
 */

export type Assinatura = {
  /** bytes esperados */
  bytes: number[]
  /** posicao onde eles comecam */
  offset?: number
}

export type TipoArquivo = {
  extensoes: string[]
  mime: string
  /** Nome exato do formato, usado na mensagem de erro do upload. */
  rotulo: string
  /**
   * Nome da familia, para a tela. '.doc' e '.docx' sao ambos "Word": listar os
   * quinze rotulos exatos numa frase de ajuda vira ruido.
   */
  familia: string
  /** Uma das assinaturas basta. Ausente = formato sem magic bytes (texto puro). */
  assinaturas?: Assinatura[]
  /** Icone Lucide usado na tela ao listar o arquivo. */
  icone: string
}

const b = (texto: string) => [...texto].map(c => c.charCodeAt(0))

/** ZIP — container de docx/xlsx/pptx e de todo OpenDocument. */
const ZIP: Assinatura[] = [
  { bytes: [0x50, 0x4b, 0x03, 0x04] },
  // arquivos gerados por algumas ferramentas usam estas variantes
  { bytes: [0x50, 0x4b, 0x05, 0x06] },
  { bytes: [0x50, 0x4b, 0x07, 0x08] }
]

/** OLE2 — formato dos Office antigos (.doc/.xls/.ppt). */
const OLE: Assinatura[] = [{ bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] }]

export const TIPOS_ANEXO: TipoArquivo[] = [
  {
    extensoes: ['.pdf'],
    mime: 'application/pdf',
    rotulo: 'PDF',
    familia: 'PDF',
    assinaturas: [{ bytes: b('%PDF') }],
    icone: 'i-lucide-file-text'
  },
  {
    extensoes: ['.docx'],
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    rotulo: 'Word',
    familia: 'Word',
    assinaturas: ZIP,
    icone: 'i-lucide-file-type'
  },
  {
    extensoes: ['.doc'],
    mime: 'application/msword',
    rotulo: 'Word (antigo)',
    familia: 'Word',
    assinaturas: OLE,
    icone: 'i-lucide-file-type'
  },
  {
    extensoes: ['.xlsx'],
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    rotulo: 'Excel',
    familia: 'Excel',
    assinaturas: ZIP,
    icone: 'i-lucide-file-spreadsheet'
  },
  {
    extensoes: ['.xls'],
    mime: 'application/vnd.ms-excel',
    rotulo: 'Excel (antigo)',
    familia: 'Excel',
    assinaturas: OLE,
    icone: 'i-lucide-file-spreadsheet'
  },
  {
    extensoes: ['.pptx'],
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    rotulo: 'PowerPoint',
    familia: 'PowerPoint',
    assinaturas: ZIP,
    icone: 'i-lucide-presentation'
  },
  {
    extensoes: ['.ppt'],
    mime: 'application/vnd.ms-powerpoint',
    rotulo: 'PowerPoint (antigo)',
    familia: 'PowerPoint',
    assinaturas: OLE,
    icone: 'i-lucide-presentation'
  },
  {
    extensoes: ['.odt'],
    mime: 'application/vnd.oasis.opendocument.text',
    rotulo: 'OpenDocument texto',
    familia: 'OpenDocument',
    assinaturas: ZIP,
    icone: 'i-lucide-file-type'
  },
  {
    extensoes: ['.ods'],
    mime: 'application/vnd.oasis.opendocument.spreadsheet',
    rotulo: 'OpenDocument planilha',
    familia: 'OpenDocument',
    assinaturas: ZIP,
    icone: 'i-lucide-file-spreadsheet'
  },
  {
    extensoes: ['.odp'],
    mime: 'application/vnd.oasis.opendocument.presentation',
    rotulo: 'OpenDocument apresentacao',
    familia: 'OpenDocument',
    assinaturas: ZIP,
    icone: 'i-lucide-presentation'
  },
  // Sem assinatura: sao texto puro. A checagem aqui e a extensao e o tamanho.
  { extensoes: ['.csv'], mime: 'text/csv; charset=utf-8', rotulo: 'CSV', familia: 'CSV', icone: 'i-lucide-table' },
  { extensoes: ['.txt'], mime: 'text/plain; charset=utf-8', rotulo: 'Texto', familia: 'Texto', icone: 'i-lucide-file-text' },
  {
    extensoes: ['.png'],
    mime: 'image/png',
    rotulo: 'PNG',
    familia: 'imagem',
    assinaturas: [{ bytes: [0x89, 0x50, 0x4e, 0x47] }],
    icone: 'i-lucide-file-image'
  },
  {
    extensoes: ['.jpg', '.jpeg'],
    mime: 'image/jpeg',
    rotulo: 'JPEG',
    familia: 'imagem',
    assinaturas: [{ bytes: [0xff, 0xd8, 0xff] }],
    icone: 'i-lucide-file-image'
  },
  {
    extensoes: ['.zip'],
    mime: 'application/zip',
    rotulo: 'ZIP',
    familia: 'ZIP',
    assinaturas: ZIP,
    icone: 'i-lucide-file-archive'
  }
]

/** Imagens do editor visual. Mais restrito que os anexos, e de proposito. */
export const TIPOS_IMAGEM: TipoArquivo[] = [
  {
    extensoes: ['.png'],
    mime: 'image/png',
    rotulo: 'PNG',
    familia: 'imagem',
    assinaturas: [{ bytes: [0x89, 0x50, 0x4e, 0x47] }],
    icone: 'i-lucide-file-image'
  },
  {
    extensoes: ['.jpg', '.jpeg'],
    mime: 'image/jpeg',
    rotulo: 'JPEG',
    familia: 'imagem',
    assinaturas: [{ bytes: [0xff, 0xd8, 0xff] }],
    icone: 'i-lucide-file-image'
  },
  {
    extensoes: ['.gif'],
    mime: 'image/gif',
    rotulo: 'GIF',
    familia: 'imagem',
    assinaturas: [{ bytes: b('GIF8') }],
    icone: 'i-lucide-file-image'
  },
  {
    extensoes: ['.webp'],
    mime: 'image/webp',
    rotulo: 'WEBP',
    familia: 'imagem',
    // RIFF....WEBP — as duas partes precisam bater
    assinaturas: [{ bytes: b('WEBP'), offset: 8 }],
    icone: 'i-lucide-file-image'
  }
]

/** Extensao em minusculas, com o ponto. '' quando nao ha. */
export function extensaoDe(nome: string) {
  const m = /\.[A-Za-z0-9]+$/.exec(nome.trim())
  return m ? m[0].toLowerCase() : ''
}

export function tipoPelaExtensao(nome: string, tipos: TipoArquivo[] = TIPOS_ANEXO) {
  const ext = extensaoDe(nome)
  if (!ext) return undefined
  return tipos.find(t => t.extensoes.includes(ext))
}

/**
 * Confere os magic bytes. Formato sem assinatura declarada passa —
 * a decisao de confiar na extensao e tomada no mapa, nao aqui.
 */
// Uint8Array, e nao Buffer: este arquivo tambem e importado pela TELA, onde o
// tipo do Node nao existe. Buffer e um Uint8Array, entao o servidor passa o
// dele sem conversao.
export function assinaturaConfere(dados: Uint8Array, tipo: TipoArquivo) {
  if (!tipo.assinaturas?.length) return true
  return tipo.assinaturas.some(a => {
    const inicio = a.offset ?? 0
    if (dados.length < inicio + a.bytes.length) return false
    return a.bytes.every((byte, i) => dados[inicio + i] === byte)
  })
}

/** Content-type para o download. Desconhecido vira octet-stream, nunca um palpite. */
export function mimeDoArquivo(nome: string, tipos: TipoArquivo[] = TIPOS_ANEXO) {
  return tipoPelaExtensao(nome, tipos)?.mime || 'application/octet-stream'
}

export function iconeDoArquivo(nome: string, tipos: TipoArquivo[] = TIPOS_ANEXO) {
  return tipoPelaExtensao(nome, tipos)?.icone || 'i-lucide-file'
}

/** Valor do atributo `accept` do <input type="file">. */
export function acceptDe(tipos: TipoArquivo[]) {
  const extensoes = tipos.flatMap(t => t.extensoes)
  const mimes = [...new Set(tipos.map(t => t.mime.split(';')[0]!))]
  return [...extensoes, ...mimes].join(',')
}

/** Lista exata, para a mensagem de erro do upload. */
export function rotulosDe(tipos: TipoArquivo[]) {
  return [...new Set(tipos.map(t => t.rotulo))].join(', ')
}

/** Lista curta por familia, para a tela: "PDF, Word, Excel, ...". */
export function familiasDe(tipos: TipoArquivo[]) {
  return [...new Set(tipos.map(t => t.familia))].join(', ')
}
