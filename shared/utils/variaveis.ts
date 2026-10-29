/**
 * Nome de coluna da planilha -> chave de variável do e-mail.
 *
 * "Alíquota do Simples" vira `aliquota_do_simples`. O banco guarda o nome
 * original da coluna; a normalização acontece dos DOIS lados (no template e
 * nos dados) na hora de renderizar, então {{Alíquota do Simples}},
 * {{aliquota do simples}} e {{aliquota_do_simples}} dão no mesmo.
 */
export function chaveVariavel(nome: string) {
  return nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
}
