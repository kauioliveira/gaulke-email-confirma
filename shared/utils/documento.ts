/**
 * CPF e CNPJ: o banco guarda so os digitos; a tela mostra formatado.
 */

export const soDigitosDoc = (v: string | null | undefined) => (v || '').replace(/\D/g, '')

/** 12345678000195 -> 12.345.678/0001-95 · 12345678909 -> 123.456.789-09 */
export function formatarDocumento(v: string | null | undefined) {
  const d = soDigitosDoc(v)
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  return v || ''
}

/**
 * Mascara enquanto a pessoa digita: ate 11 digitos vira CPF, a partir do 12o
 * vira CNPJ. Colar "12345678000195" ou "12.345.678/0001-95" da no mesmo.
 */
export function mascaraDocumento(v: string) {
  const d = soDigitosDoc(v).slice(0, 14)
  if (d.length <= 11) {
    return d
      .replace(/^(\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2')
  }
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2')
}

/** Vazio, CPF (11) ou CNPJ (14) */
export const documentoValido = (v: string | null | undefined) => [0, 11, 14].includes(soDigitosDoc(v).length)

/** Papeis de quem assina, na folha de assinaturas. Vazio tambem vale. */
export const PAPEIS_ASSINATURA = [
  'Contratante',
  'Contratado(a)',
  'Parte',
  'Testemunha',
  'Sócio(a)',
  'Administrador(a)',
  'Representante legal',
  'Procurador(a)',
  'Fiador(a)',
  'Avalista',
  'Cônjuge (anuência)',
  'Interveniente',
  'Contador(a) responsável',
  'Contábil Gaulke',
  'Ciente'
] as const
