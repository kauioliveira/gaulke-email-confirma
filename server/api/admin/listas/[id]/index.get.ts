import { detalheLista } from '../../../../utils/listas'

export default defineEventHandler(async event => detalheLista(Number(getRouterParam(event, 'id'))))
