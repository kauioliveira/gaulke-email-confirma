import { eq, desc } from 'drizzle-orm'
import { useDb, recipients, batches } from '../../../db'
import { lerFiltros, montarWhere, colunasRelatorio, ultimoIp } from '../../../utils/relatorio'
import { linkAcesso } from '../../../utils/urls'
import { auditar } from '../../../utils/auditoria'
import { gerarXlsx, enviarXlsx } from '../../../utils/planilha'

const CABECALHO = [
  'Lote', 'Disparado por', 'Nome', 'E-mail', 'Empresa', 'Codigo', 'Status', 'Enviado em',
  'Provavel leitura em', 'Qtd aberturas', 'Ultima abertura', 'Primeira abertura (qualquer)',
  'Acessou em', 'Confirmou leitura em', 'Baixou em', 'Qtd downloads',
  'Ultimo IP', 'Ultimo erro', 'Link de acesso'
]

function celula(v: unknown) {
  if (v === null || v === undefined) return ''
  // horario de Sao Paulo, e nao ISO em UTC: quem abre a planilha le a hora
  // como ela aconteceu aqui, sem somar 3h de cabeca
  const s = v instanceof Date ? formatarDataHora(v, '') : String(v)
  // aspas duplicadas + prefixo contra injecao de formula no Excel
  const seguro = /^[=+\-@]/.test(s) ? `'${s}` : s
  return `"${seguro.replace(/"/g, '""')}"`
}

export default defineEventHandler(async event => {
  const f = lerFiltros(getQuery(event) as Record<string, unknown>)
  const linhas = await useDb()
    .select({ ...colunasRelatorio, ultimoIp })
    .from(recipients)
    .innerJoin(batches, eq(batches.id, recipients.batchId))
    .where(montarWhere(f))
    .orderBy(desc(recipients.id))
    .limit(50000)

  const valores = linhas.map(l => [
    l.loteNome, l.loteDisparadoPor, l.nome, l.email, l.empresa, l.codigo, l.status, l.sentAt,
    l.firstHumanOpenAt, l.openCount, l.lastOpenAt, l.firstOpenAt,
    l.firstAccessAt, l.confirmedAt, l.firstDownloadAt, l.downloadCount,
    l.ultimoIp, l.ultimoErro, linkAcesso(l.token)
  ])
  const xlsx = String(getQuery(event).formato || '') === 'xlsx'

  // exportar leva dados pessoais para fora do sistema: fica registrado (LGPD)
  await auditar(event, 'relatorio.exportar', {
    entidade: 'relatorio',
    resumo: `Exportou o relatório de destinatários em ${xlsx ? 'XLSX' : 'CSV'} (${linhas.length} linha(s))`,
    dados: { filtros: f, linhas: linhas.length, formato: xlsx ? 'xlsx' : 'csv' }
  })

  if (xlsx) {
    return enviarXlsx(
      event,
      `relatorio-gaulke-${dataSP()}.xlsx`,
      gerarXlsx([{ nome: 'Destinatários', linhas: [CABECALHO, ...valores], larguras: [28, 22, 26, 32, 28, 16, 10, 19, 19, 8, 19, 19, 19, 19, 19, 8, 16, 40, 50] }])
    )
  }

  const corpo = valores.map(v => v.map(celula).join(';'))

  // BOM + ';' para o Excel em pt-BR abrir com acento e colunas corretas
  const csv = '﻿' + [CABECALHO.map(celula).join(';'), ...corpo].join('\r\n')
  const arquivo = `relatorio-gaulke-${dataSP()}.csv`

  setResponseHeaders(event, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="${arquivo}"`
  })
  return csv
})
