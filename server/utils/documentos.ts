import { resolve, sep, dirname, extname } from 'node:path'
import { mkdir, rename, copyFile, unlink, rm, rmdir } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { semAspas } from './env'

/**
 * Diretorio dos documentos que os CLIENTES enviam (decisao D7: tudo fica neste
 * sistema, no volume `documentos`, e nao numa pasta de rede).
 *
 * Organizacao (D7b), toda relativa a este diretorio:
 *
 *   quarentena/<aleatorio>.<ext>                      enquanto o antivirus nao liberou
 *   modelos/<nome>-<aleatorio>.<ext>                  arquivos modelo dos itens do checklist
 *   clientes/<CPF-ou-CNPJ>_<nome>/<ano>/SOL-000123_<titulo>/01-<item>/<arquivo>
 *
 * Sem CPF/CNPJ a pasta do cliente sai do e-mail. O caminho gravado no banco e
 * sempre RELATIVO: mudar o volume de lugar nao invalida nada.
 */
export function documentosDir() {
  return resolve(process.cwd(), semAspas(process.env.DOCUMENTOS_DIR) || './storage/documentos')
}

/**
 * Caminho absoluto de um relativo, SEM escapar do diretorio. Todo acesso a
 * arquivo de cliente passa por aqui: um caminho vindo do banco nunca e usado
 * cru, por mais que tenha sido este codigo que o gravou.
 */
export function caminhoDocumento(relativo: string) {
  const base = documentosDir()
  const alvo = resolve(base, relativo)
  if (!alvo.startsWith(base + sep)) {
    throw createError({ statusCode: 400, statusMessage: 'Caminho de documento invalido' })
  }
  return alvo
}

/** Trecho de caminho sem acento, espaco ou barra. Curto para nao estourar o limite do sistema de arquivos. */
export function slugPasta(texto: string, max = 50) {
  const s = texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, max)
    .replace(/-+$/g, '')
  return s || 'sem-nome'
}

/** Pasta do cliente: o documento identifica melhor que o nome, que muda de grafia. */
export function pastaDoCliente(c: { documento?: string | null; nome?: string | null; empresa?: string | null; email: string }) {
  const doc = (c.documento || '').replace(/\D/g, '')
  const nome = slugPasta(c.empresa || c.nome || c.email.split('@')[0] || '', 40)
  if (doc) return `clientes/${doc}_${nome}`
  return `clientes/${slugPasta(c.email, 60)}`
}

export function codigoSolicitacao(id: number) {
  return `SOL-${String(id).padStart(6, '0')}`
}

/** Pasta de uma solicitacao, dentro da do cliente e do ano (em Sao Paulo) em que foi criada. */
export function pastaDaSolicitacao(s: {
  id: number
  titulo: string
  createdAt: Date
  documento?: string | null
  destinatarioNome?: string | null
  empresa?: string | null
  destinatarioEmail: string
}) {
  const ano = dataSP(s.createdAt).slice(0, 4)
  const cliente = pastaDoCliente({
    documento: s.documento,
    nome: s.destinatarioNome,
    empresa: s.empresa,
    email: s.destinatarioEmail
  })
  return `${cliente}/${ano}/${codigoSolicitacao(s.id)}_${slugPasta(s.titulo, 40)}`
}

export function pastaDoItem(pastaSolic: string, item: { ordem: number; titulo: string }) {
  return `${pastaSolic}/${String(item.ordem).padStart(2, '0')}-${slugPasta(item.titulo, 40)}`
}

/**
 * Nome do arquivo na pasta final: o original, limpo, com um sufixo aleatorio
 * curto — dois "RG.jpg" do mesmo item nao podem se sobrescrever.
 */
export function nomeNaPasta(original: string) {
  const ext = extname(original).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 10)
  const base = slugPasta(original.slice(0, original.length - extname(original).length), 60)
  return `${base}-${randomBytes(3).toString('hex')}${ext}`
}

export function caminhoQuarentena(original: string) {
  const ext = extname(original).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 10)
  return `quarentena/${randomBytes(16).toString('hex')}${ext}`
}

/** Garante a pasta do destino e move. Entre volumes diferentes, copia e apaga. */
export async function moverDocumento(deRel: string, paraRel: string) {
  const de = caminhoDocumento(deRel)
  const para = caminhoDocumento(paraRel)
  await mkdir(dirname(para), { recursive: true })
  try {
    await rename(de, para)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
    await copyFile(de, para)
    await unlink(de)
  }
}

export async function apagarDocumento(rel: string) {
  try {
    await unlink(caminhoDocumento(rel))
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }
}

/**
 * Apaga a pasta de UMA solicitacao ou assinatura (retencao). So aceita o nivel
 * clientes/<cliente>/<ano>/<codigo>_..., nunca a pasta do cliente inteira nem a
 * raiz — um caminho vazio ou curto vindo do banco nao pode virar `rm -rf` de
 * tudo. Depois sobe removendo as pastas que ficaram vazias (ano, cliente).
 */
export async function apagarPastaDocumento(rel: string) {
  const partes = rel.split('/').filter(Boolean)
  if (partes.length < 4 || partes[0] !== 'clientes' || !/^(SOL|ASS)-\d{6}/.test(partes[3]!)) {
    throw new Error(`pasta fora do padrao, nao apagada: ${rel}`)
  }
  await rm(caminhoDocumento(partes.join('/')), { recursive: true, force: true })
  for (let n = partes.length - 1; n >= 2; n--) {
    try {
      await rmdir(caminhoDocumento(partes.slice(0, n).join('/')))
    } catch {
      break // nao vazia (outros anos, outras solicitacoes): para aqui
    }
  }
}

/**
 * Content-Disposition que aguenta acento: "Comprovante de endereço.pdf" sai
 * certo no navegador (filename*) e legivel nos antigos (filename ASCII).
 */
export function disposicao(nome: string, inline = false) {
  const ascii = nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '')
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nome)}`
}
