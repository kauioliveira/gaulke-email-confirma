import { resumosDasListas } from '../../../utils/listas'

/** Todas as listas salvas, com o numero de contatos de cada uma. */
export default defineEventHandler(async () => resumosDasListas())
