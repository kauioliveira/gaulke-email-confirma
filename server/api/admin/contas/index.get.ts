import { listarContas } from '../../../utils/contas'
import { chaveConfigurada, impressaoDaChave } from '../../../utils/cripto'
import { servidorPadrao } from '../../../utils/contas'

/**
 * Lista os canais de saida. A senha nunca vem junto.
 *
 * Todo usuario le esta lista (e ela que alimenta o "Sai por" do envio); so o
 * admin altera, nas rotas vizinhas.
 */
export default defineEventHandler(async () => {
  return {
    contas: chaveConfigurada() ? await listarContas() : [],
    // A tela precisa explicar o que fazer em vez de so falhar ao salvar.
    chave: { configurada: chaveConfigurada(), impressao: impressaoDaChave() },
    // O servidor costuma ser o mesmo para todas as caixas: o canal novo ja
    // nasce com ele, e so pede usuario, senha e remetente.
    sugestao: await servidorPadrao()
  }
})
