import type { Bloco } from '~~/shared/types/blocos'

/**
 * Ponto de partida de um template novo, no cliente.
 *
 * Espelha server/utils/blocos.ts::blocosPadrao(). Existem os dois porque o
 * servidor precisa dele no seed inicial e a tela precisa dele ao criar um
 * template sem ida ao servidor. Mudou um, mude o outro.
 */
export function blocosPadraoCliente(): Bloco[] {
  const id = (s: string) => `b-${s}-${Math.random().toString(36).slice(2, 7)}`
  return [
    { id: id('logo'), tipo: 'logo', alinhamento: 'centro' },
    { id: id('saud'), tipo: 'titulo', texto: 'Olá, {{nome}}!' },
    {
      id: id('intro'),
      tipo: 'texto',
      texto:
        'Disponibilizamos um documento importante para a sua análise. O acesso é individual e está vinculado a este e-mail.'
    },
    {
      id: id('instr'),
      tipo: 'texto',
      texto: 'Clique no botão abaixo para visualizar, confirmar a leitura e baixar o arquivo.'
    },
    { id: id('botao'), tipo: 'botao', texto: 'Acessar documento' },
    {
      id: id('cod'),
      tipo: 'codigo',
      rotulo: 'Código de referência',
      ajuda: 'Informe este código caso precise falar com a nossa equipe.'
    },
    {
      id: id('rod'),
      tipo: 'rodape',
      texto:
        'Para comprovar a entrega e a ciência deste comunicado, registramos a data, a hora e o endereço IP do acesso à página, da confirmação de leitura e do download do arquivo. O tratamento desses dados segue a Lei 13.709/2018 (LGPD), limita-se a essa finalidade e os registros são mantidos por 24 meses.'
    }
  ]
}
