/**
 * Modelo de blocos do editor visual de e-mail.
 *
 * O operador monta o e-mail com estas pecas; o HTML de tabelas e GERADO a
 * partir delas (server/utils/blocos.ts). Ninguem digita HTML, entao nao ha
 * como quebrar a renderizacao no Outlook nem apagar o botao por acidente.
 *
 * O texto dos blocos continua aceitando {{variavel}}: o renderizador de
 * blocos preserva os marcadores, e a substituicao acontece depois, no envio,
 * pelo mesmo caminho de sempre (server/utils/render.ts).
 */

export type CorAviso = 'neutro' | 'atencao' | 'alerta'
export type Alinhamento = 'esquerda' | 'centro' | 'direita'

export type BlocoLogo = { id: string; tipo: 'logo'; alinhamento: Alinhamento }
export type BlocoTitulo = { id: string; tipo: 'titulo'; texto: string }
export type BlocoTexto = { id: string; tipo: 'texto'; texto: string }
export type BlocoBotao = { id: string; tipo: 'botao'; texto: string }
export type BlocoCodigo = { id: string; tipo: 'codigo'; rotulo: string; ajuda: string }
export type BlocoAviso = { id: string; tipo: 'aviso'; texto: string; cor: CorAviso }
export type BlocoLista = { id: string; tipo: 'lista'; itens: string[] }
export type BlocoSeparador = { id: string; tipo: 'separador' }
export type BlocoImagem = {
  id: string
  tipo: 'imagem'
  arquivo: string
  alt: string
  largura: number
  alinhamento: Alinhamento
}
/** Fixo: nao pode ser removido nem reordenado, so o texto muda. */
export type BlocoRodape = { id: string; tipo: 'rodape'; texto: string }

export type Bloco =
  | BlocoLogo
  | BlocoTitulo
  | BlocoTexto
  | BlocoBotao
  | BlocoCodigo
  | BlocoAviso
  | BlocoLista
  | BlocoSeparador
  | BlocoImagem
  | BlocoRodape

export type TipoBloco = Bloco['tipo']

/** Formato de edicao de um template. */
export type FormatoTemplate = 'blocos' | 'html'

export const RODAPE_TEXTO_PADRAO =
  'Para comprovar a entrega e a ciência deste comunicado, registramos a data, a hora e o ' +
  'endereço IP do acesso à página, da confirmação de leitura e do download do arquivo. ' +
  'O tratamento desses dados segue a Lei 13.709/2018 (LGPD), limita-se a essa finalidade ' +
  'e os registros são mantidos por 24 meses.'

/**
 * O bloco de rodape e o unico obrigatorio: e ele que informa ao destinatario
 * que o acesso e registrado, que e a base da transparencia exigida pela LGPD.
 * A UI impede remover; esta funcao garante o mesmo do lado do servidor.
 */
export function ehBlocoFixo(tipo: TipoBloco) {
  return tipo === 'rodape'
}

export const ROTULOS_BLOCO: Record<TipoBloco, string> = {
  logo: 'Cabeçalho da empresa',
  titulo: 'Título',
  texto: 'Parágrafo',
  botao: 'Botão de acesso',
  codigo: 'Código de referência',
  aviso: 'Aviso destacado',
  lista: 'Lista de itens',
  separador: 'Separador',
  imagem: 'Imagem',
  rodape: 'Rodapé (LGPD + contato)'
}

export const ICONES_BLOCO: Record<TipoBloco, string> = {
  logo: 'i-lucide-image',
  titulo: 'i-lucide-heading',
  texto: 'i-lucide-align-left',
  botao: 'i-lucide-mouse-pointer-click',
  codigo: 'i-lucide-hash',
  aviso: 'i-lucide-triangle-alert',
  lista: 'i-lucide-list',
  separador: 'i-lucide-minus',
  imagem: 'i-lucide-image-plus',
  rodape: 'i-lucide-shield-check'
}
