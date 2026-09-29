import { detalheAssinatura } from '../../../../utils/assinatura'

export default defineEventHandler(event => detalheAssinatura(Number(getRouterParam(event, 'id'))))
