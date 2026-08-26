import { reenviarFalhas } from '../../../../utils/sender'

export default defineEventHandler(async event =>
  reenviarFalhas(Number(getRouterParam(event, 'id')))
)
