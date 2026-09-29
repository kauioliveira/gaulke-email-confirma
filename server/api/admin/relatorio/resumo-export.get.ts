import { lerPeriodo } from '../../../utils/periodo'
import { montarResumo, type LinhaFunil } from '../../../utils/resumo'
import { gerarXlsx, enviarXlsx } from '../../../utils/planilha'
import { auditar } from '../../../utils/auditoria'

const CAB_FUNIL = ['Enviados', 'Prováveis leituras', 'Acessos', 'Confirmações', '% confirmação', 'Downloads', 'Respostas', 'Devoluções']

function funil(l: LinhaFunil) {
  return [
    l.enviados, l.aberturas, l.acessos, l.confirmados,
    l.enviados ? Math.round((l.confirmados / l.enviados) * 1000) / 10 : 0,
    l.downloads, l.respostas, l.devolucoes
  ]
}

/** O resumo do periodo em XLSX, uma aba para cada visao. */
export default defineEventHandler(async event => {
  const p = lerPeriodo(getQuery(event))
  const r = await montarResumo(p.inicio, p.fim)
  const titulo = [`Gaulke Comunica — resumo de ${formatarData(p.inicio)} a ${formatarData(p.fim)} (horário de Brasília)`]

  const dados = gerarXlsx([
    { nome: 'Por lote', linhas: [titulo, [], ['Lote', 'Disparado em', ...CAB_FUNIL], ...r.porLote.map(l => [l.grupo, l.disparadoEm, ...funil(l)])], larguras: [40, 19, 10, 12, 10, 12, 12, 10, 10, 11] },
    { nome: 'Por usuário', linhas: [titulo, [], ['Quem criou', 'Lotes', ...CAB_FUNIL], ...r.porUsuario.map(l => [l.grupo, l.lotes, ...funil(l)])], larguras: [32, 8] },
    { nome: 'Por setor', linhas: [titulo, [], ['Setor', 'Lotes', ...CAB_FUNIL], ...r.porSetor.map(l => [l.grupo, l.lotes, ...funil(l)])], larguras: [24, 8] },
    { nome: 'Por canal', linhas: [titulo, [], ['Canal de saída', 'Lotes', ...CAB_FUNIL], ...r.porCanal.map(l => [l.grupo, l.lotes, ...funil(l)])], larguras: [32, 8] },
    { nome: 'Nunca confirmam', linhas: [titulo, [], ['E-mail', 'Nome', 'Empresa', 'Envios', 'Último envio'], ...r.nuncaConfirmam.map(x => [x.email, x.nome, x.empresa, x.envios, x.ultimoEnvio])], larguras: [34, 28, 28, 8, 19] },
    { nome: 'Devoluções por domínio', linhas: [titulo, [], ['Domínio', 'Devoluções', 'Endereços'], ...r.devolucoesPorDominio.map(x => [x.dominio, x.devolucoes, x.enderecos])], larguras: [34, 12, 12] }
  ])

  await auditar(event, 'relatorio.exportar_resumo', {
    entidade: 'relatorio',
    resumo: `Exportou o resumo de ${p.de} a ${p.ate} em XLSX`,
    dados: { de: p.de, ate: p.ate }
  })
  return enviarXlsx(event, `resumo-gaulke-${p.de}_a_${p.ate}.xlsx`, dados)
})
