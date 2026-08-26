import { linhasModelo, COLUNAS_MODELO } from '../../utils/lista'

/**
 * Planilha de exemplo para download.
 *
 * Gerada a partir das mesmas constantes que a tela mostra, para o modelo nao
 * envelhecer em relacao ao que o importador realmente aceita.
 */
export default defineEventHandler(event => {
  const celula = (v: string) => `"${v.replace(/"/g, '""')}"`
  const linhas = [
    COLUNAS_MODELO.map(celula).join(';'),
    ...linhasModelo().map(l => l.map(celula).join(';'))
  ]

  // BOM + ';' para o Excel em pt-BR abrir com acento e colunas separadas
  const csv = '﻿' + linhas.join('\r\n')

  setResponseHeaders(event, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': 'attachment; filename="modelo-lista-gaulke.csv"'
  })
  return csv
})
