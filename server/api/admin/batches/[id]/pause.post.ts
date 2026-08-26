import { pausarLote } from '../../../../utils/sender'

export default defineEventHandler(async event =>
  pausarLote(Number(getRouterParam(event, 'id')))
)
