import type { Solicitacao, SolicItem } from '../db'
import { codigoSolicitacao } from './documentos'
import { ROTULO_STATUS_ITEM, ROTULO_STATUS_SOLIC } from '../../shared/utils/solicitacao'
import { rotuloTipoItem } from '../../shared/utils/itens-solic'
import type { StatusItemSolicitacao, StatusSolicitacao } from '../../shared/types/api'

/**
 * Respostas dos clientes em CSV para o Excel brasileiro: separador ";",
 * BOM UTF-8 (sem ele o Excel quebra os acentos) e protecao contra formula —
 * resposta que comeca com = + - @ viraria formula ao abrir a planilha.
 */

function celula(v: unknown) {
  let t = v == null ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`
  return /[";\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
}

const linha = (vs: unknown[]) => vs.map(celula).join(';')
const BOM = '﻿'

/** Valor da celula: a resposta pronta; documento vira o status. */
function valorDoItem(i: SolicItem) {
  if (i.tipo === 'documento') return ROTULO_STATUS_ITEM[i.status as StatusItemSolicitacao] ?? i.status
  return i.resposta?.exibicao ?? ''
}

/** Uma solicitacao: uma linha por item. */
export function csvDaSolicitacao(s: Solicitacao, todos: SolicItem[]) {
  const itens = todos.filter(i => i.tipo !== 'informativo')
  const linhas = [
    linha(['codigo', 'ordem', 'item', 'tipo', 'obrigatorio', 'status', 'resposta', 'respondido_em', 'ip']),
    ...itens.map(i =>
      linha([
        codigoSolicitacao(s),
        i.ordem,
        i.titulo,
        rotuloTipoItem(i.tipo),
        i.obrigatorio ? 'sim' : 'não',
        ROTULO_STATUS_ITEM[i.status as StatusItemSolicitacao] ?? i.status,
        i.tipo === 'documento' ? '' : (i.resposta?.exibicao ?? ''),
        i.respondidoEm ? formatarDataHora(i.respondidoEm) : '',
        i.respostaIp ?? ''
      ])
    )
  ]
  return BOM + linhas.join('\r\n')
}

/**
 * Varios clientes do mesmo envio: uma linha por cliente, uma coluna por item
 * (pelo titulo, na ordem do pedido) — e o que deixa comparar as respostas.
 */
export function csvDoGrupo(lista: { s: Solicitacao; itens: SolicItem[] }[]) {
  const titulos: string[] = []
  for (const { itens } of lista) for (const i of itens) if (i.tipo !== 'informativo' && !titulos.includes(i.titulo)) titulos.push(i.titulo)
  const linhas = [
    linha(['codigo', 'cliente', 'email', 'cpf_cnpj', 'empresa', 'situacao', ...titulos]),
    ...lista.map(({ s, itens }) =>
      linha([
        codigoSolicitacao(s),
        s.destinatarioNome ?? '',
        s.destinatarioEmail,
        s.documento ?? '',
        s.empresa ?? '',
        ROTULO_STATUS_SOLIC[s.status as StatusSolicitacao] ?? s.status,
        ...titulos.map(t => {
          const i = itens.find(x => x.titulo === t)
          return i ? valorDoItem(i) : ''
        })
      ])
    )
  ]
  return BOM + linhas.join('\r\n')
}
