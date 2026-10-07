/**
 * Casa arquivos com destinatarios, para o envio com anexo INDIVIDUAL (cada
 * cliente recebe o SEU arquivo: guia DAS, holerite, informe).
 *
 * Funcao pura, na pasta shared: a tela usa para mostrar a previa enquanto a
 * pessoa sobe os arquivos, e o resultado e o que vai para o servidor.
 *
 * Pelo NOME do arquivo, da pista mais forte para a mais fraca:
 *  1. CPF (11 digitos) ou CNPJ (14 digitos), com ou sem pontuacao:
 *     "DAS_12.345.678/0001-90_09-2026.pdf", "12345678000190.pdf";
 *  2. o e-mail do destinatario: "fulano@cliente.com.br.pdf";
 *  3. o nome ou a empresa IGUAL ao nome do arquivo (sem acento, caixa ou
 *     pontuacao): "ACME Ltda.pdf" para a empresa "Acme LTDA". Igual, e nao
 *     "contem": "Maria.pdf" nao pode ir para "Maria Oliveira" e "Maria Souza".
 * O que sobrar a pessoa liga a mao na tela. Antes de tudo isso valem os
 * documentos que o servidor ja leu DE DENTRO do arquivo (`documentos`).
 */

export type ArquivoParaCasar = {
  nome: string
  original: string
  /** CPF/CNPJ ja descobertos pelo servidor (nome ou conteudo do arquivo); valem antes do nome */
  documentos?: string[]
}
export type DestinatarioParaCasar = { email: string; documento?: string | null; nome?: string | null; empresa?: string | null }
export type ComoCasou = 'documento' | 'email' | 'nome' | 'manual'

export type ResultadoCasamento = {
  /** e-mail do destinatario -> arquivo */
  casados: Record<string, { arquivo: ArquivoParaCasar; como: ComoCasou }>
  /** destinatarios sem arquivo */
  semArquivo: string[]
  /** arquivos que nao casaram com ninguem */
  semDono: ArquivoParaCasar[]
  /** mais de um arquivo para a mesma pessoa: o primeiro ficou, os outros aqui */
  repetidos: { email: string; arquivo: ArquivoParaCasar }[]
}

/** So os digitos; CPF/CNPJ vazio ou de tamanho errado vira null. */
export function soDigitos(v: string | null | undefined) {
  const d = String(v ?? '').replace(/\D/g, '')
  return d.length === 11 || d.length === 14 ? d : null
}

function baseSemExtensao(nome: string) {
  return nome.replace(/\.[A-Za-z0-9]{1,6}$/, '')
}

/** Sequencias de 11 ou 14 digitos no nome, aceitando . / - e espaco no meio. */
export function documentosNoNome(nome: string) {
  const base = baseSemExtensao(nome)
  const achados = new Set<string>()
  for (const m of base.matchAll(/\d[\d.\/\s-]*\d/g)) {
    const d = m[0].replace(/\D/g, '')
    if (d.length === 11 || d.length === 14) achados.add(d)
  }
  return [...achados]
}

function chaveTexto(v: string | null | undefined) {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

export function casarArquivos(
  arquivos: ArquivoParaCasar[],
  destinatarios: DestinatarioParaCasar[],
  manuais: Record<string, string> = {}
): ResultadoCasamento {
  const porDocumento = new Map<string, string>()
  const porEmail = new Map<string, string>()
  const porTexto = new Map<string, string | null>()
  for (const d of destinatarios) {
    const email = d.email.trim().toLowerCase()
    porEmail.set(email, email)
    const doc = soDigitos(d.documento)
    if (doc) porDocumento.set(doc, email)
    // nome/empresa repetido entre destinatarios nao serve de pista: vira null
    for (const t of [chaveTexto(d.nome), chaveTexto(d.empresa)]) {
      if (t.length < 4) continue
      porTexto.set(t, porTexto.has(t) && porTexto.get(t) !== email ? null : email)
    }
  }

  const casados: ResultadoCasamento['casados'] = {}
  const semDono: ArquivoParaCasar[] = []
  const repetidos: ResultadoCasamento['repetidos'] = []

  const ligar = (email: string, arquivo: ArquivoParaCasar, como: ComoCasou) => {
    if (casados[email]) repetidos.push({ email, arquivo })
    else casados[email] = { arquivo, como }
  }

  for (const a of arquivos) {
    // ligacao feita a mao na tela vale mais que qualquer regra
    const manual = manuais[a.nome]
    if (manual && porEmail.has(manual)) { ligar(manual, a, 'manual'); continue }

    const doc = [...(a.documentos ?? []), ...documentosNoNome(a.original)].map(d => porDocumento.get(d)).find(Boolean)
    if (doc) { ligar(doc, a, 'documento'); continue }

    const email = (a.original.toLowerCase().match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? [])
      .map(e => e.replace(/\.(pdf|docx?|xlsx?|zip|png|jpe?g|txt|csv|odt|ods)$/i, ''))
      .map(e => porEmail.get(e))
      .find(Boolean)
    if (email) { ligar(email, a, 'email'); continue }

    const texto = porTexto.get(chaveTexto(baseSemExtensao(a.original)))
    if (texto) { ligar(texto, a, 'nome'); continue }

    semDono.push(a)
  }

  return {
    casados,
    semArquivo: destinatarios.map(d => d.email.trim().toLowerCase()).filter(e => !casados[e]),
    semDono,
    repetidos
  }
}
