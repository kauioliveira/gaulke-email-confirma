import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

/**
 * Montador de PDF simples (A4, retrato) para os documentos do sistema:
 * dossie de comprovacao, folha de assinaturas.
 *
 * Um visual so para todos: a mesma familia (Helvetica), as mesmas margens, o
 * mesmo cabecalho e rodape com paginacao. Quem abre um documento da Gaulke
 * reconhece os outros.
 *
 * As fontes padrao do PDF so conhecem o alfabeto latino (WinAnsi): acentos do
 * portugues, sim; seta, emoji e caracteres de outros alfabetos, nao — e o
 * pdf-lib lanca erro ao encontrar um. `seguro()` troca ou remove esses
 * caracteres ANTES de escrever, em vez de o documento inteiro falhar por causa
 * de um nome com um caractere exotico.
 */

const A4 = { largura: 595.28, altura: 841.89 }
const MARGEM = 48
const MARCA = rgb(0.204, 0.22, 0.506) // #343881
const TEXTO = rgb(0.2, 0.25, 0.33)
const MUTADO = rgb(0.39, 0.45, 0.55)
const BORDA = rgb(0.88, 0.91, 0.94)

const TROCAS: Record<string, string> = { '→': '->', '←': '<-', '✓': 'v', '✔': 'v', '✗': 'x', '·': '·', ' ': ' ' }

export class DocumentoPdf {
  private pdf!: PDFDocument
  private fonte!: PDFFont
  private negrito!: PDFFont
  private pagina!: PDFPage
  private y = 0
  private suportados = new Map<string, boolean>()

  private constructor(private titulo: string, private rodape: string) {}

  static async criar(titulo: string, rodape: string) {
    const d = new DocumentoPdf(titulo, rodape)
    d.pdf = await PDFDocument.create()
    d.pdf.setTitle(titulo)
    d.pdf.setProducer('Gaulke Comunica')
    d.pdf.setCreator('Gaulke Comunica')
    d.fonte = await d.pdf.embedFont(StandardFonts.Helvetica)
    d.negrito = await d.pdf.embedFont(StandardFonts.HelveticaBold)
    d.novaPagina()
    return d
  }

  /** Troca o que a fonte nao sabe desenhar. */
  seguro(texto: unknown): string {
    let s = String(texto ?? '').normalize('NFC')
    for (const [de, para] of Object.entries(TROCAS)) s = s.split(de).join(para)
    let saida = ''
    for (const ch of s) {
      if (ch === '\n') { saida += ch; continue }
      let ok = this.suportados.get(ch)
      if (ok === undefined) {
        try { this.fonte.encodeText(ch); ok = true } catch { ok = false }
        this.suportados.set(ch, ok)
      }
      saida += ok ? ch : '?'
    }
    return saida
  }

  private novaPagina() {
    this.pagina = this.pdf.addPage([A4.largura, A4.altura])
    // faixa da marca no topo e o titulo do documento em todas as paginas
    this.pagina.drawRectangle({ x: 0, y: A4.altura - 6, width: A4.largura, height: 6, color: MARCA })
    this.pagina.drawText(this.seguro('Gaulke Contábil'), { x: MARGEM, y: A4.altura - 30, size: 9, font: this.negrito, color: MARCA })
    const t = this.seguro(this.titulo)
    this.pagina.drawText(t, {
      x: A4.largura - MARGEM - this.fonte.widthOfTextAtSize(t, 9),
      y: A4.altura - 30,
      size: 9,
      font: this.fonte,
      color: MUTADO
    })
    this.y = A4.altura - 58
  }

  private garantir(altura: number) {
    if (this.y - altura < MARGEM + 24) this.novaPagina()
  }

  /** Quebra o texto em linhas que cabem na largura. */
  private quebrar(texto: string, fonte: PDFFont, tamanho: number, largura: number) {
    const linhas: string[] = []
    for (const paragrafo of this.seguro(texto).split('\n')) {
      let atual = ''
      for (const palavra of paragrafo.split(/\s+/)) {
        const tentativa = atual ? `${atual} ${palavra}` : palavra
        if (fonte.widthOfTextAtSize(tentativa, tamanho) <= largura) { atual = tentativa; continue }
        if (atual) linhas.push(atual)
        // palavra maior que a linha (URL, hash): corta em pedacos
        let resto = palavra
        while (fonte.widthOfTextAtSize(resto, tamanho) > largura) {
          let n = resto.length
          while (n > 1 && fonte.widthOfTextAtSize(resto.slice(0, n), tamanho) > largura) n--
          linhas.push(resto.slice(0, n))
          resto = resto.slice(n)
        }
        atual = resto
      }
      linhas.push(atual)
    }
    return linhas
  }

  titulo1(texto: string, sub?: string) {
    this.garantir(50)
    this.pagina.drawText(this.seguro(texto), { x: MARGEM, y: this.y, size: 17, font: this.negrito, color: rgb(0.06, 0.09, 0.16) })
    this.y -= 18
    if (sub) {
      for (const l of this.quebrar(sub, this.fonte, 9.5, A4.largura - 2 * MARGEM)) {
        this.pagina.drawText(l, { x: MARGEM, y: this.y, size: 9.5, font: this.fonte, color: MUTADO })
        this.y -= 12
      }
    }
    this.y -= 10
  }

  secao(texto: string) {
    this.garantir(40)
    this.y -= 6
    this.pagina.drawText(this.seguro(texto.toUpperCase()), { x: MARGEM, y: this.y, size: 9, font: this.negrito, color: MARCA })
    this.y -= 6
    this.pagina.drawLine({ start: { x: MARGEM, y: this.y }, end: { x: A4.largura - MARGEM, y: this.y }, thickness: 0.8, color: BORDA })
    this.y -= 14
  }

  /** "Rotulo: valor", com o valor quebrando linha se precisar. */
  campo(rotulo: string, valor: unknown) {
    const larguraRotulo = 130
    const linhas = this.quebrar(valor === null || valor === undefined || valor === '' ? '—' : String(valor), this.fonte, 9.5, A4.largura - 2 * MARGEM - larguraRotulo)
    this.garantir(12 * linhas.length + 2)
    this.pagina.drawText(this.seguro(rotulo), { x: MARGEM, y: this.y, size: 9, font: this.negrito, color: MUTADO })
    for (const l of linhas) {
      this.pagina.drawText(l, { x: MARGEM + larguraRotulo, y: this.y, size: 9.5, font: this.fonte, color: TEXTO })
      this.y -= 12
    }
    this.y -= 2
  }

  paragrafo(texto: string, opcoes: { tamanho?: number; mutado?: boolean; mono?: boolean } = {}) {
    const tamanho = opcoes.tamanho ?? 9.5
    for (const l of this.quebrar(texto, this.fonte, tamanho, A4.largura - 2 * MARGEM)) {
      this.garantir(tamanho + 3)
      this.pagina.drawText(l, { x: MARGEM, y: this.y, size: tamanho, font: this.fonte, color: opcoes.mutado ? MUTADO : TEXTO })
      this.y -= tamanho + 3
    }
    this.y -= 4
  }

  /**
   * Tabela simples: larguras em fracoes da area util. As celulas quebram
   * linha; a linha da tabela cresce com a celula mais alta.
   */
  tabela(cabecalho: string[], linhas: unknown[][], fracoes: number[], tamanho = 8) {
    const util = A4.largura - 2 * MARGEM
    const larguras = fracoes.map(f => f * util)
    const desenharLinha = (celulas: unknown[], cab: boolean) => {
      const fonte = cab ? this.negrito : this.fonte
      const quebradas = celulas.map((c, i) => this.quebrar(c === null || c === undefined || c === '' ? '—' : String(c), fonte, tamanho, larguras[i]! - 6))
      const altura = Math.max(...quebradas.map(q => q.length)) * (tamanho + 2) + 6
      if (this.y - altura < MARGEM + 24) {
        this.novaPagina()
        if (!cab) desenharLinha(cabecalho, true)
      }
      if (cab) {
        this.pagina.drawRectangle({ x: MARGEM, y: this.y - altura + tamanho + 2, width: util, height: altura, color: rgb(0.97, 0.98, 0.99) })
      }
      let x = MARGEM
      quebradas.forEach((q, i) => {
        let yy = this.y
        for (const l of q) {
          this.pagina.drawText(l, { x: x + 3, y: yy, size: tamanho, font: fonte, color: cab ? MUTADO : TEXTO })
          yy -= tamanho + 2
        }
        x += larguras[i]!
      })
      this.y -= altura
      this.pagina.drawLine({ start: { x: MARGEM, y: this.y + tamanho }, end: { x: MARGEM + util, y: this.y + tamanho }, thickness: 0.5, color: BORDA })
    }
    this.garantir(40)
    desenharLinha(cabecalho, true)
    for (const l of linhas) desenharLinha(l, false)
    this.y -= 8
  }

  espaco(pontos = 8) {
    this.y -= pontos
  }

  /** Rodape com paginacao ("pagina X de Y") em todas as paginas, e grava. */
  async finalizar(): Promise<Uint8Array> {
    const paginas = this.pdf.getPages()
    paginas.forEach((p, i) => {
      p.drawLine({ start: { x: MARGEM, y: MARGEM + 10 }, end: { x: A4.largura - MARGEM, y: MARGEM + 10 }, thickness: 0.5, color: BORDA })
      const esquerda = this.seguro(this.rodape)
      p.drawText(esquerda.slice(0, 120), { x: MARGEM, y: MARGEM - 2, size: 7.5, font: this.fonte, color: MUTADO })
      const direita = `Página ${i + 1} de ${paginas.length}`
      p.drawText(direita, { x: A4.largura - MARGEM - this.fonte.widthOfTextAtSize(direita, 7.5), y: MARGEM - 2, size: 7.5, font: this.fonte, color: MUTADO })
    })
    return this.pdf.save()
  }
}
