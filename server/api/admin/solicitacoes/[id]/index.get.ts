import { detalheSolicitacao } from '../../../../utils/solicitacoes'

export default defineEventHandler(event => detalheSolicitacao(Number(getRouterParam(event, 'id'))))
