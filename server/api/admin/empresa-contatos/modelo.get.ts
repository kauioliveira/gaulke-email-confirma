/**
 * Planilha de exemplo da importacao de e-mails por CPF/CNPJ
 * (ImportarContatos.vue). Mesmo formato do modelo das listas: CSV com ';' e
 * BOM, que o Excel em pt-BR abre com acento e colunas separadas.
 */
export default defineEventHandler(event => {
  const celula = (v: string) => `"${v.replace(/"/g, '""')}"`
  const linhas = [
    ['CNPJ', 'E-mail', 'Nome', 'Empresa'],
    ['27.851.136/0001-61', 'financeiro@empresa.com.br; socio@empresa.com.br', 'Maria Souza', 'Empresa Exemplo Ltda'],
    ['123.456.789-09', 'joao@email.com', 'João Silva', '']
  ].map(l => l.map(celula).join(';'))

  setResponseHeaders(event, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': 'attachment; filename="modelo-emails-por-cnpj.csv"'
  })
  return '﻿' + linhas.join('\r\n')
})
