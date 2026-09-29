import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { PassThrough } from 'node:stream'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { Zip, ZipPassThrough } from 'fflate'
import { useDb, solicItens, solicArquivos } from '../../../../db'
import { auditar } from '../../../../utils/auditoria'
import { carregarSolicitacao } from '../../../../utils/solicitacoes'
import { caminhoDocumento, codigoSolicitacao, disposicao, slugPasta } from '../../../../utils/documentos'
import { ROTULO_STATUS_ITEM } from '../../../../../shared/utils/solicitacao'
import type { StatusItemSolicitacao } from '../../../../../shared/types/api'

/**
 * Tudo o que o cliente enviou, num ZIP: uma pasta por item, com o nome
 * original dos arquivos, e um MANIFESTO.txt com o que cada item ficou
 * (aprovado, recusado, "nao possuo" e a justificativa) e o SHA-256 de cada
 * arquivo — quem recebe o ZIP consegue provar que nada foi trocado.
 *
 * Streaming e sem compressao (PDF e foto ja vem comprimidos): 300 MB de
 * documentos nao passam pela memoria de uma vez. `?itens=1,2` baixa so esses.
 */
export default defineEventHandler(async event => {
  const s = await carregarSolicitacao(Number(getRouterParam(event, 'id')))
  const soItens = String(getQuery(event).itens || '')
    .split(',')
    .map(Number)
    .filter(Boolean)
  const db = useDb()
  const itens = await db
    .select()
    .from(solicItens)
    .where(and(eq(solicItens.solicId, s.id), soItens.length ? inArray(solicItens.id, soItens) : undefined))
    .orderBy(asc(solicItens.ordem))
  const arquivos = await db
    .select()
    .from(solicArquivos)
    .where(
      and(
        eq(solicArquivos.solicId, s.id),
        isNull(solicArquivos.removidoEm),
        inArray(solicArquivos.antivirus, ['limpo', 'sem_antivirus'])
      )
    )
    .orderBy(asc(solicArquivos.enviadoEm))
  if (!arquivos.some(a => itens.some(i => i.id === a.itemId))) {
    throw createError({ statusCode: 404, statusMessage: 'Ainda não há arquivo liberado para baixar' })
  }

  const codigo = codigoSolicitacao(s.id)
  const saida = new PassThrough()
  const zip = new Zip((err, pedaco, fim) => {
    if (err) return saida.destroy(err)
    saida.write(pedaco)
    if (fim) saida.end()
  })

  const manifesto: string[] = [
    `${codigo} — ${s.titulo}`,
    `Cliente: ${s.destinatarioNome || '-'} <${s.destinatarioEmail}>${s.empresa ? ` · ${s.empresa}` : ''}${s.documento ? ` · ${s.documento}` : ''}`,
    `Gerado em ${formatarDataHora(new Date())} (horário de Brasília)`,
    ''
  ]

  void (async () => {
    try {
      for (const item of itens) {
        const pasta = `${String(item.ordem).padStart(2, '0')}-${slugPasta(item.titulo, 40)}`
        const doItem = arquivos.filter(a => a.itemId === item.id)
        manifesto.push(`[${ROTULO_STATUS_ITEM[item.status as StatusItemSolicitacao] ?? item.status}] ${item.titulo}${item.obrigatorio ? '' : ' (opcional)'}`)
        if (item.motivo) manifesto.push(`    ${item.status === 'nao_possui' ? 'Justificativa do cliente' : 'Motivo'}: ${item.motivo}`)
        if (item.analisadoPorNome) manifesto.push(`    Analisado por ${item.analisadoPorNome} em ${formatarDataHora(item.analisadoEm)}`)
        const usados = new Set<string>()
        for (const a of doItem) {
          const abs = caminhoDocumento(a.caminho)
          if (!(await stat(abs).catch(() => null))?.isFile()) {
            manifesto.push(`    ! ${a.nomeOriginal}: arquivo não encontrado no servidor`)
            continue
          }
          // dois "RG.jpg" no mesmo item: o segundo vira "RG (2).jpg"
          let nome = a.nomeOriginal.replace(/[/\\]/g, '_')
          for (let n = 2; usados.has(nome.toLowerCase()); n++) nome = a.nomeOriginal.replace(/(\.[^.]*)?$/, ` (${n})$1`)
          usados.add(nome.toLowerCase())

          const f = new ZipPassThrough(`${pasta}/${nome}`)
          f.mtime = a.enviadoEm
          zip.add(f)
          for await (const pedaco of createReadStream(abs)) {
            f.push(pedaco as Uint8Array)
            // respeita quem esta baixando: nao enche a memoria com o ZIP inteiro
            if (saida.writableNeedDrain) await new Promise(r => saida.once('drain', r))
          }
          f.push(new Uint8Array(0), true)
          manifesto.push(`    ${nome} · ${a.tamanho} bytes · enviado em ${formatarDataHora(a.enviadoEm)} · SHA-256 ${a.sha256}`)
        }
        manifesto.push('')
      }
      const m = new ZipPassThrough('MANIFESTO.txt')
      zip.add(m)
      m.push(new TextEncoder().encode(manifesto.join('\r\n')), true)
      zip.end()
    } catch (e) {
      saida.destroy(e instanceof Error ? e : new Error(String(e)))
    }
  })()

  await auditar(event, 'solicitacao.baixar_zip', {
    entidade: 'solicitacao',
    id: s.id,
    resumo: `Baixou o ZIP da ${codigo} (${s.destinatarioEmail})${soItens.length ? ` — ${itens.length} item(ns)` : ''}`
  })
  setResponseHeaders(event, {
    'content-type': 'application/zip',
    'content-disposition': disposicao(`${codigo}_${slugPasta(s.empresa || s.destinatarioNome || s.destinatarioEmail, 40)}.zip`),
    'cache-control': 'no-store, private'
  })
  return sendStream(event, saida)
})
