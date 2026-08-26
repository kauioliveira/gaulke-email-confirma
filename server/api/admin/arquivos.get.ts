import { listarArquivos } from '../../utils/storage'

export default defineEventHandler(async () => ({ arquivos: await listarArquivos() }))
