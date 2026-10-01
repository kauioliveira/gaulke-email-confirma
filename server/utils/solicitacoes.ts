import { createHash, randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  useDb,
  solicitacoes,
  solicItens,
  solicArquivos,
  solicEventos,
  type Solicitacao,
  type SolicItem
} from '../db'
import { resolverConta, enviarEmail } from './mailer'
import { emitirWebhook } from './webhooks'
import { sortearCodigo } from './codigos'
import { renderizarBlocos } from './blocos'
import { baseUrl } from './urls'
import { verificarArquivo } from './antivirus'
import {
  caminhoDocumento,
  caminhoQuarentena,
  codigoSolicitacao,
  moverDocumento,
  nomeNaPasta,
  pastaDoItem,
  apagarDocumento
} from './documentos'
import {
  FAMILIAS_SOLICITACAO,
  tiposDoItem,
  tipoPelaExtensao,
  assinaturaConfere,
  descreverFamilias,
  mimeDoArquivo,
  TIPOS_SOLICITACAO
} from '../../shared/types/tipos-arquivo'
import type { Bloco } from '../../shared/types/blocos'
import type {
  ResumoSolicitacao,
  DetalheSolicitacao,
  StatusSolicitacao,
  StatusItemSolicitacao,
  StatusAntivirus,
  LandingSolicitacao
} from '../../shared/types/api'

/**
 * Solicitacao de documentos: a Gaulke pede, o cliente entrega item a item
 * pelo link /r/<token>, a Gaulke analisa e tudo fica na pasta do cliente.
 *
 * Estado da solicitacao (derivado dos itens, nunca editado a mao — so
 * concluir, reabrir e cancelar sao explicitos):
 *
 *   aberta      falta algo obrigatorio do cliente (pendente ou recusado)
 *   em_analise  o obrigatorio foi entregue e ha item esperando a Gaulke
 *   concluida   todo obrigatorio aprovado (ou "nao possuo" aceito) e nada
 *               esperando analise — automatico, ou manual
 *   cancelada   explicito, com motivo
 */

export const MAX_ARQUIVO_SOLIC = 25 * 1024 * 1024
const MAX_POR_ITEM_TETO = 30

const familiasValidas = FAMILIAS_SOLICITACAO.map(f => f.valor) as [string, ...string[]]

export const itemSolicSchema = z.object({
  titulo: z.string().trim().min(1, 'Informe o nome do item').max(200),
  instrucao: z.string().trim().max(1000).nullish().transform(v => v || null),
  obrigatorio: z.boolean().default(true),
  tipos: z.array(z.enum(familiasValidas)).max(familiasValidas.length).default([]),
  maxArquivos: z.number().int().min(1).max(MAX_POR_ITEM_TETO).default(5),
  // so arquivos que ESTE sistema guardou em documentos/modelos
  modeloPath: z
    .string()
    .regex(/^modelos\/[A-Za-z0-9._-]+$/, 'Arquivo modelo invalido')
    .nullish()
    .transform(v => v || null),
  modeloNome: z.string().trim().max(260).nullish().transform(v => v || null)
})

const destinatarioSchema = z.object({
  nome: z.string().trim().max(200).nullish().transform(v => v || null),
  email: z.string().trim().toLowerCase().email('E-mail invalido').max(320),
  documento: z
    .string()
    .nullish()
    .transform(v => (v || '').replace(/\D/g, '') || null)
    .refine(v => !v || v.length === 11 || v.length === 14, 'CPF/CNPJ deve ter 11 ou 14 digitos'),
  empresa: z.string().trim().max(200).nullish().transform(v => v || null)
})

export const criarSolicSchema = z.object({
  titulo: z.string().trim().min(3, 'De um titulo a solicitacao').max(200),
  mensagem: z.string().trim().max(4000).nullish().transform(v => v || null),
  checklistId: z.number().int().positive().nullish(),
  prazo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish()
    .transform(v => v || null)
    .refine(v => !v || v >= dataSP(), 'O prazo nao pode estar no passado'),
  lembretes: z.boolean().default(true),
  avisarConclusao: z.boolean().default(true),
  contaId: z.number().int().positive().nullish(),
  responderPara: z.string().trim().max(300).nullish().transform(v => v || null),
  itens: z.array(itemSolicSchema).min(1, 'Inclua pelo menos um documento').max(40),
  destinatarios: z.array(destinatarioSchema).min(1, 'Inclua pelo menos um cliente').max(500)
})

export type CriarSolic = z.output<typeof criarSolicSchema>

/* -------------------------------------------------------------------------
 * Historico
 * ---------------------------------------------------------------------- */

export async function registrarEventoSolic(
  solicId: number,
  tipo: string,
  descricao: string,
  o: { itemId?: number | null; porNome?: string | null; ip?: string | null; meta?: Record<string, unknown> } = {}
) {
  try {
    await useDb()
      .insert(solicEventos)
      .values({
        solicId,
        itemId: o.itemId ?? null,
        tipo,
        descricao,
        porNome: o.porNome ?? null,
        ip: o.ip ?? null,
        meta: (o.meta ?? null) as never
      })
  } catch (e) {
    // o historico nunca derruba a acao que ja aconteceu
    console.error('[gaulke-mail] historico da solicitacao', solicId, tipo, e instanceof Error ? e.message : e)
  }
}

/* -------------------------------------------------------------------------
 * Estado
 * ---------------------------------------------------------------------- */

type ItemParaStatus = Pick<SolicItem, 'status' | 'obrigatorio' | 'analisadoEm'>

const entregue = (i: ItemParaStatus) => i.status === 'enviado' || i.status === 'aprovado' || i.status === 'nao_possui'
const resolvido = (i: ItemParaStatus) => i.status === 'aprovado' || (i.status === 'nao_possui' && !!i.analisadoEm)
const esperandoAnalise = (i: ItemParaStatus) => i.status === 'enviado' || (i.status === 'nao_possui' && !i.analisadoEm)

export function statusPelosItens(itens: ItemParaStatus[]): 'aberta' | 'em_analise' | 'concluida' {
  const obrig = itens.filter(i => i.obrigatorio)
  const algoEsperando = itens.some(esperandoAnalise)
  const temResolvido = itens.some(resolvido)
  // sem obrigatorio nenhum, concluir exige ao menos uma entrega resolvida
  if (obrig.every(resolvido) && !algoEsperando && (obrig.length > 0 || temResolvido)) return 'concluida'
  if (obrig.every(entregue) && algoEsperando) return 'em_analise'
  return 'aberta'
}

/** Codigo publico novo, sorteado e unico (SOL-26-X7K2P9). */
export function novoCodigoSolicitacao() {
  return sortearCodigo('SOL', async codigo =>
    (await useDb().select({ id: solicitacoes.id }).from(solicitacoes).where(eq(solicitacoes.codigo, codigo)).limit(1)).length > 0
  )
}

/**
 * Recalcula depois de qualquer mudanca num item. So mexe em solicitacao
 * aberta ou em analise: concluida e cancelada mudam por acao explicita.
 * Devolve a transicao para quem chamou decidir os avisos.
 */
export async function recalcularStatus(solicId: number, porNome?: string | null) {
  const db = useDb()
  const [s] = await db.select().from(solicitacoes).where(eq(solicitacoes.id, solicId))
  if (!s || (s.status !== 'aberta' && s.status !== 'em_analise')) return { antes: s?.status, depois: s?.status }

  const itens = await db.select().from(solicItens).where(eq(solicItens.solicId, solicId))
  const depois = statusPelosItens(itens)
  if (depois === s.status) return { antes: s.status, depois }

  await db
    .update(solicitacoes)
    .set(
      depois === 'concluida'
        ? { status: depois, concluidaEm: new Date(), concluidaPorNome: porNome ?? null }
        : { status: depois }
    )
    .where(eq(solicitacoes.id, solicId))

  if (depois === 'concluida') {
    await registrarEventoSolic(solicId, 'concluida', 'Todos os documentos obrigatórios foram aprovados', { porNome })
    if (s.avisarConclusao) await enviarEmailSolic(solicId, 'concluida')
    await webhookSolicitacao('solicitacao.concluida', s, { concluidaPor: porNome ?? null, automatica: true })
  }
  return { antes: s.status, depois }
}

/* -------------------------------------------------------------------------
 * E-mails
 * ---------------------------------------------------------------------- */

export function linkSolicitacao(token: string, base = baseUrl()) {
  return `${base}/r/${token}`
}

function escapar(v: unknown) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Preenche o HTML gerado pelos blocos. Nao usa o renderizar() dos lotes de
 * proposito: aquele injeta o pixel de abertura do /c/<token>, que aqui nao
 * existe — e o acesso ao link ja registra o que interessa.
 */
export function preencherEmail(html: string, v: { nome: string; email: string; empresa: string; link: string; codigo: string }) {
  const valores: Record<string, string> = {
    nome: escapar(v.nome),
    // o rodape fixo do e-mail diz "enviado para {{email}}"
    email: escapar(v.email),
    empresa: escapar(v.empresa),
    codigo: escapar(v.codigo),
    link: v.link,
    base: baseUrl()
  }
  return html
    .replace(/<img src="\{\{pixel\}\}"[^>]*>/g, '')
    .replace(/\{\{\s*#([\w]+)\s*\}\}([\s\S]*?)\{\{\s*\/\1\s*\}\}/g, (_m, k: string, corpo: string) => (valores[k] ? corpo : ''))
    .replace(/\{\{\s*([\w]+)\s*\}\}/g, (m, k: string) => valores[k] ?? m)
}

const RODAPE_SOLIC =
  'Os documentos enviados por este link ficam guardados com segurança pela Contábil Gaulke e são ' +
  'usados somente para esta finalidade. Registramos a data, a hora e o endereço IP de cada envio. ' +
  'O tratamento segue a Lei 13.709/2018 (LGPD). Este link é pessoal — evite compartilhá-lo.'

export type TipoEmailSolic = 'pedido' | 'lembrete' | 'pendencias' | 'concluida'

function rotuloItem(i: SolicItem) {
  const formato = i.tipos.length ? ` — ${descreverFamilias(i.tipos)}` : ''
  return `${i.titulo}${i.obrigatorio ? '' : ' (opcional)'}${formato}`
}

export function montarEmail(tipo: TipoEmailSolic, s: Solicitacao, itens: SolicItem[]) {
  const prazo = s.prazo ? formatarData(`${s.prazo}T12:00:00${DESLOCAMENTO_SP}`) : null
  const blocos: Bloco[] = [
    { id: 'logo', tipo: 'logo', alinhamento: 'centro' },
    { id: 'ola', tipo: 'titulo', texto: 'Olá, {{nome}}!' }
  ]
  let assunto = ''
  let botao = 'Enviar documentos'

  if (tipo === 'pedido') {
    assunto = `Documentos solicitados: ${s.titulo}`
    blocos.push({
      id: 'intro',
      tipo: 'texto',
      texto:
        s.mensagem ||
        `A Contábil Gaulke precisa de alguns documentos{{#empresa}} de {{empresa}}{{/empresa}} para dar andamento a: ${s.titulo}.`
    })
    blocos.push({ id: 'o-que', tipo: 'texto', texto: 'Pelo botão abaixo você envia cada um deles, direto do computador ou tirando uma foto com o celular:', alinhamento: 'esquerda' })
    blocos.push({ id: 'itens', tipo: 'lista', itens: itens.map(rotuloItem), alinhamento: 'esquerda' })
  } else if (tipo === 'lembrete') {
    const faltam = itens.filter(i => i.obrigatorio && (i.status === 'pendente' || i.status === 'recusado'))
    assunto = `Lembrete: ainda faltam documentos — ${s.titulo}`
    blocos.push({
      id: 'intro',
      tipo: 'texto',
      texto: `Ainda não recebemos ${faltam.length === 1 ? 'um documento' : `${faltam.length} documentos`} da solicitação "${s.titulo}":`
    })
    blocos.push({ id: 'itens', tipo: 'lista', itens: faltam.map(rotuloItem), alinhamento: 'esquerda' })
  } else if (tipo === 'pendencias') {
    const recusados = itens.filter(i => i.status === 'recusado')
    assunto = `Precisamos de um novo envio — ${s.titulo}`
    botao = 'Enviar novamente'
    blocos.push({
      id: 'intro',
      tipo: 'texto',
      texto: `Analisamos os documentos da solicitação "${s.titulo}". ${recusados.length === 1 ? 'Um deles precisa' : 'Alguns precisam'} ser enviados de novo:`
    })
    blocos.push({
      id: 'itens',
      tipo: 'lista',
      itens: recusados.map(i => `${i.titulo}: ${i.motivo || 'envie novamente'}`),
      alinhamento: 'esquerda'
    })
    blocos.push({ id: 'resto', tipo: 'texto', texto: 'Os demais documentos já foram recebidos — não é preciso enviá-los de novo.' })
  } else {
    assunto = `Documentos recebidos — ${s.titulo}`
    botao = 'Ver o que foi enviado'
    blocos.push({
      id: 'intro',
      tipo: 'texto',
      texto: `Recebemos e conferimos os documentos da solicitação "${s.titulo}". Não é preciso enviar mais nada. Obrigado!`
    })
  }

  if (prazo && tipo !== 'concluida') {
    blocos.push({ id: 'prazo', tipo: 'aviso', cor: 'atencao', texto: `Prazo para envio: ${prazo}.`, alinhamento: 'esquerda' })
  }
  blocos.push({ id: 'botao', tipo: 'botao', texto: botao })
  if (tipo !== 'concluida') {
    blocos.push({
      id: 'dica',
      tipo: 'texto',
      texto: 'Você pode enviar aos poucos: o link continua valendo e guarda o que já foi enviado.',
      alinhamento: 'esquerda'
    })
  }
  blocos.push({ id: 'rodape', tipo: 'rodape', texto: RODAPE_SOLIC })

  const codigo = codigoSolicitacao(s)
  const link = linkSolicitacao(s.token)
  const html = preencherEmail(renderizarBlocos(blocos, assunto), {
    nome: s.destinatarioNome || s.destinatarioEmail.split('@')[0] || '',
    email: s.destinatarioEmail,
    empresa: s.empresa || '',
    link,
    codigo
  })
  const texto = [
    `Olá ${s.destinatarioNome || ''},`.trim(),
    '',
    assunto,
    '',
    ...(tipo === 'concluida' ? [] : itens.filter(i => tipo === 'pedido' || i.status === 'recusado' || i.status === 'pendente').map(i => `- ${rotuloItem(i)}`)),
    '',
    `Acesse: ${link}`,
    prazo && tipo !== 'concluida' ? `Prazo: ${prazo}` : '',
    '',
    `Código da solicitação: ${codigo}`
  ]
    .filter((l, i, a) => l !== '' || a[i - 1] !== '')
    .join('\n')

  return { assunto, html, texto }
}

/**
 * Envia um dos e-mails ao cliente. Nunca lanca: o erro do SMTP fica gravado
 * na solicitacao (envio_erro) e no historico, e aparece na tela.
 */
export async function enviarEmailSolic(
  solicId: number,
  tipo: TipoEmailSolic,
  o: { porNome?: string | null } = {}
): Promise<{ ok: boolean; erro?: string }> {
  const db = useDb()
  const [s] = await db.select().from(solicitacoes).where(eq(solicitacoes.id, solicId))
  if (!s) return { ok: false, erro: 'solicitação não existe' }
  const itens = await db.select().from(solicItens).where(eq(solicItens.solicId, solicId)).orderBy(asc(solicItens.ordem))

  const { assunto, html, texto } = montarEmail(tipo, s, itens)
  const DESCRICAO: Record<TipoEmailSolic, string> = {
    pedido: 'Pedido enviado',
    lembrete: 'Lembrete enviado',
    pendencias: 'Pendências enviadas',
    concluida: 'Aviso de conclusão enviado'
  }

  try {
    const conta = await resolverConta(s.contaId)
    const dominio = (/@([^>\s]+)>?\s*$/.exec(conta.from)?.[1] || 'contabilgaulke.com.br').toLowerCase()
    const messageId = `<${codigoSolicitacao(s)}.${tipo}.${randomBytes(4).toString('hex')}@${dominio}>`
    await enviarEmail({
      conta,
      para: s.destinatarioEmail,
      assunto,
      html,
      texto,
      responderPara: s.responderPara,
      messageId,
      headers: { 'X-Gaulke-Solicitacao': codigoSolicitacao(s) }
    })
    await db
      .update(solicitacoes)
      .set({
        envioErro: null,
        ...(tipo === 'pedido' ? { enviadoEm: new Date(), messageId } : {}),
        ...(tipo === 'lembrete' ? { ultimoLembreteEm: new Date(), lembretesEnviados: sql`${solicitacoes.lembretesEnviados} + 1` } : {})
      })
      .where(eq(solicitacoes.id, s.id))
    if (tipo === 'pendencias') {
      await db
        .update(solicItens)
        .set({ recusaAvisadaEm: new Date() })
        .where(and(eq(solicItens.solicId, s.id), eq(solicItens.status, 'recusado'), isNull(solicItens.recusaAvisadaEm)))
    }
    await registrarEventoSolic(s.id, `email_${tipo}`, `${DESCRICAO[tipo]} para ${s.destinatarioEmail}`, {
      porNome: o.porNome ?? null,
      meta: { messageId, conta: conta.nome }
    })
    return { ok: true }
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e)
    await db.update(solicitacoes).set({ envioErro: erro }).where(eq(solicitacoes.id, s.id))
    await registrarEventoSolic(s.id, 'email_erro', `Falha ao enviar (${DESCRICAO[tipo].toLowerCase()}): ${erro}`, {
      porNome: o.porNome ?? null
    })
    return { ok: false, erro }
  }
}

/**
 * Aviso interno para quem pediu (cliente terminou de entregar, arquivo
 * infectado). Sai pelo mesmo canal da solicitacao; sem e-mail de quem pediu
 * (acesso por senha local), fica so no historico.
 */
/**
 * Aviso por e-mail a quem pediu. O resultado vai para o HISTORICO da
 * solicitacao — enviado (com a resposta do servidor SMTP), falhou (com o erro)
 * ou sem e-mail de quem pediu — e nao so para o log do servidor, que se perde
 * no reinicio: "fui avisado?" precisa ter resposta na tela.
 */
export async function avisarEquipe(s: Solicitacao, assunto: string, texto: string, lista: string[] = []) {
  const quem = s.criadoPorNome || 'Quem pediu'
  if (!s.criadoPorEmail) {
    await registrarEventoSolic(s.id, 'aviso_equipe_sem_email', `Aviso "${assunto}" não enviado: ${quem} não tem e-mail cadastrado (acesso pela senha local sem SENHA_LOCAL_EMAIL).`)
    return false
  }
  const link = `${baseUrl()}/admin/solicitacoes/${s.id}`
  const blocos: Bloco[] = [
    { id: 't', tipo: 'titulo', texto: assunto },
    { id: 'x', tipo: 'texto', texto, alinhamento: 'esquerda' },
    ...(lista.length ? [{ id: 'l', tipo: 'lista' as const, itens: lista, alinhamento: 'esquerda' as const }] : []),
    { id: 'b', tipo: 'botao', texto: 'Abrir a solicitação' },
    { id: 'r', tipo: 'rodape', texto: 'Aviso automático do Gaulke Comunica.' }
  ]
  const html = preencherEmail(renderizarBlocos(blocos, assunto), { nome: '', email: s.criadoPorEmail, empresa: '', link, codigo: codigoSolicitacao(s) })
  try {
    const conta = await resolverConta(s.contaId)
    const info = await enviarEmail({
      conta,
      para: s.criadoPorEmail,
      assunto: `[${codigoSolicitacao(s)}] ${assunto}`,
      html,
      texto: `${assunto}\n\n${texto}\n${lista.map(l => `- ${l}`).join('\n')}\n\n${link}`
    })
    await registrarEventoSolic(s.id, 'aviso_equipe', `${quem} foi avisado por e-mail (${s.criadoPorEmail}): "${assunto}"`, {
      meta: { para: s.criadoPorEmail, canal: conta.nome, respostaSmtp: info.response, messageId: info.messageId }
    })
    return true
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[gaulke-mail] aviso interno da solicitacao', s.id, msg)
    await registrarEventoSolic(s.id, 'aviso_equipe_erro', `Falha ao avisar ${quem} (${s.criadoPorEmail}) — "${assunto}": ${msg}`, { meta: { para: s.criadoPorEmail } })
    return false
  }
}

/* -------------------------------------------------------------------------
 * Arquivos do cliente
 * ---------------------------------------------------------------------- */

function recusar(msg: string, status = 400): never {
  throw createError({ statusCode: status, statusMessage: msg })
}

/** Arquivos ativos (nao removidos e nao infectados) de um item. */
async function arquivosAtivos(itemId: number) {
  return useDb()
    .select()
    .from(solicArquivos)
    .where(
      and(
        eq(solicArquivos.itemId, itemId),
        isNull(solicArquivos.removidoEm),
        sql`${solicArquivos.antivirus} <> 'infectado'`
      )
    )
}

/**
 * Recebe um arquivo do cliente:
 *   1. formato: extensao aceita NO ITEM e assinatura do conteudo conferida;
 *   2. grava na QUARENTENA, com o SHA-256;
 *   3. antivirus: limpo -> pasta do cliente; infectado -> apagado e quem
 *      pediu e avisado; clamd fora -> fica na quarentena, tentado de novo
 *      pelo agendador (processarQuarentena).
 */
export async function receberArquivo(o: {
  solic: Solicitacao
  item: SolicItem
  nome: string
  dados: Buffer
  ip: string | null
  userAgent: string | null
}) {
  const { solic, item } = o
  if (solic.status === 'concluida' || solic.status === 'cancelada') recusar('Esta solicitação já foi encerrada.', 409)
  if (item.status === 'aprovado') recusar('Este documento já foi aprovado — não é preciso enviar de novo.', 409)
  if (item.status === 'nao_possui') recusar('Você marcou que não possui este documento. Desfaça antes de enviar um arquivo.', 409)

  const tipos = tiposDoItem(item.tipos)
  const tipo = tipoPelaExtensao(o.nome, tipos)
  if (!tipo) {
    const outro = tipoPelaExtensao(o.nome, TIPOS_SOLICITACAO)
    recusar(
      outro
        ? `Este item aceita ${descreverFamilias(item.tipos)}. O arquivo enviado é ${outro.rotulo}.`
        : `Formato não aceito. Envie ${descreverFamilias(item.tipos)}.`,
      415
    )
  }
  if (!o.dados.length) recusar('O arquivo está vazio.')
  if (o.dados.length > MAX_ARQUIVO_SOLIC) recusar('O arquivo passa de 25 MB. Envie uma versão menor (ou em partes).', 413)
  if (!assinaturaConfere(o.dados, tipo)) {
    recusar(`O conteúdo do arquivo não é um ${tipo.rotulo} válido. Ele pode estar corrompido ou com a extensão trocada.`, 415)
  }
  const ativos = await arquivosAtivos(item.id)
  if (ativos.length >= item.maxArquivos) {
    recusar(`Este item aceita até ${item.maxArquivos} arquivo(s). Remova um para enviar outro.`, 409)
  }

  const sha256 = createHash('sha256').update(o.dados).digest('hex')
  if (ativos.some(a => a.sha256 === sha256)) recusar('Este mesmo arquivo já foi enviado neste item.', 409)

  const quarentena = caminhoQuarentena(o.nome)
  const abs = caminhoDocumento(quarentena)
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, o.dados, { mode: 0o640 })

  const [arq] = await useDb()
    .insert(solicArquivos)
    .values({
      itemId: item.id,
      solicId: solic.id,
      caminho: quarentena,
      nomeOriginal: o.nome.slice(0, 260),
      tamanho: o.dados.length,
      mime: mimeDoArquivo(o.nome, TIPOS_SOLICITACAO),
      sha256,
      ip: o.ip,
      userAgent: o.userAgent
    })
    .returning()

  await registrarEventoSolic(solic.id, 'arquivo_recebido', `Arquivo "${o.nome}" recebido em "${item.titulo}"`, {
    itemId: item.id,
    ip: o.ip,
    porNome: 'cliente',
    meta: { arquivoId: arq!.id, tamanho: o.dados.length, sha256 }
  })

  return liberarDaQuarentena(arq!.id)
}

/** Passa um arquivo da quarentena pelo antivirus e da o destino. */
export async function liberarDaQuarentena(arquivoId: number) {
  const db = useDb()
  const [arq] = await db.select().from(solicArquivos).where(eq(solicArquivos.id, arquivoId))
  if (!arq) return { status: 'erro' as const, mensagem: 'arquivo não existe' }
  if (arq.antivirus !== 'pendente' && arq.antivirus !== 'erro') {
    return { status: arq.antivirus, mensagem: arq.antivirusMsg ?? '' }
  }

  const r = await verificarArquivo(caminhoDocumento(arq.caminho))
  const [s] = await db.select().from(solicitacoes).where(eq(solicitacoes.id, arq.solicId))
  const [item] = await db.select().from(solicItens).where(eq(solicItens.id, arq.itemId))
  if (!s || !item) return r

  if (r.status === 'erro') {
    await db.update(solicArquivos).set({ antivirus: 'erro', antivirusMsg: r.mensagem }).where(eq(solicArquivos.id, arq.id))
    return r
  }

  if (r.status === 'infectado') {
    await apagarDocumento(arq.caminho)
    await db
      .update(solicArquivos)
      .set({ antivirus: 'infectado', antivirusMsg: r.mensagem, removidoEm: new Date() })
      .where(eq(solicArquivos.id, arq.id))
    await registrarEventoSolic(s.id, 'arquivo_infectado', `Arquivo "${arq.nomeOriginal}" bloqueado pelo antivírus (${r.mensagem}) e apagado`, {
      itemId: item.id,
      ip: arq.ip
    })
    await avisarEquipe(
      s,
      'Arquivo bloqueado pelo antivírus',
      `O cliente ${s.destinatarioNome || s.destinatarioEmail} enviou um arquivo em "${item.titulo}" que o antivírus identificou como ameaça (${r.mensagem}). O arquivo foi apagado e o cliente viu o aviso na tela. Vale confirmar com ele por telefone.`,
      [`Arquivo: ${arq.nomeOriginal}`, `Enviado de: ${arq.ip || 'IP desconhecido'}`]
    )
    return r
  }

  // limpo, ou sem antivirus configurado (desenvolvimento): segue para a pasta
  const destino = `${pastaDoItem(s.pasta!, item)}/${nomeNaPasta(arq.nomeOriginal)}`
  await moverDocumento(arq.caminho, destino)
  await db
    .update(solicArquivos)
    .set({ antivirus: r.status, antivirusMsg: r.mensagem, caminho: destino })
    .where(eq(solicArquivos.id, arq.id))

  if (item.status === 'pendente' || item.status === 'recusado') {
    await db
      .update(solicItens)
      .set({ status: 'enviado', motivo: null, analisadoEm: null, analisadoPorNome: null, recusaAvisadaEm: null })
      .where(eq(solicItens.id, item.id))
  }
  await db.update(solicitacoes).set({ ultimaEntregaEm: new Date() }).where(eq(solicitacoes.id, s.id))
  await recalcularStatus(s.id)
  return r
}

/** O cliente tira um arquivo antes da analise. O registro fica; o arquivo sai do disco. */
export async function removerArquivoDoCliente(solic: Solicitacao, arquivoId: number, ip: string | null) {
  const db = useDb()
  if (solic.status === 'concluida' || solic.status === 'cancelada') recusar('Esta solicitação já foi encerrada.', 409)
  const [arq] = await db
    .select()
    .from(solicArquivos)
    .where(and(eq(solicArquivos.id, arquivoId), eq(solicArquivos.solicId, solic.id), isNull(solicArquivos.removidoEm)))
  if (!arq) recusar('Arquivo não encontrado.', 404)
  const [item] = await db.select().from(solicItens).where(eq(solicItens.id, arq.itemId))
  if (!item) recusar('Arquivo não encontrado.', 404)
  if (item.status === 'aprovado') recusar('Este documento já foi aprovado e não pode mais ser alterado.', 409)

  await apagarDocumento(arq.caminho)
  await db.update(solicArquivos).set({ removidoEm: new Date() }).where(eq(solicArquivos.id, arq.id))
  await registrarEventoSolic(solic.id, 'arquivo_removido', `Cliente removeu "${arq.nomeOriginal}" de "${item.titulo}"`, {
    itemId: item.id,
    ip,
    porNome: 'cliente'
  })

  // sem arquivo liberado no item, ele volta a pendente
  const restantes = (await arquivosAtivos(item.id)).filter(a => a.antivirus === 'limpo' || a.antivirus === 'sem_antivirus')
  if (!restantes.length && item.status === 'enviado') {
    await db.update(solicItens).set({ status: 'pendente' }).where(eq(solicItens.id, item.id))
  }
  await recalcularStatus(solic.id)
}

/* -------------------------------------------------------------------------
 * Rotinas do agendador
 * ---------------------------------------------------------------------- */

/** Arquivos que o clamd nao conseguiu verificar (fora do ar): tenta de novo. */
export async function processarQuarentena() {
  const pendentes = await useDb()
    .select({ id: solicArquivos.id })
    .from(solicArquivos)
    .where(
      and(
        inArray(solicArquivos.antivirus, ['pendente', 'erro']),
        isNull(solicArquivos.removidoEm),
        lt(solicArquivos.enviadoEm, new Date(Date.now() - 60_000))
      )
    )
    .orderBy(asc(solicArquivos.id))
    .limit(20)
  for (const p of pendentes) {
    const r = await liberarDaQuarentena(p.id)
    // clamd continua fora: nao adianta insistir nos proximos agora
    if (r.status === 'erro') break
  }
}

const DIAS_ENTRE_LEMBRETES = 3
const MAX_LEMBRETES = 3

/**
 * Lembretes ao cliente: a cada 3 dias sem entrega completa, no maximo 3, e so
 * em horario comercial de dia util (Sao Paulo) — lembrete de madrugada soa
 * como spam e costuma ser ignorado.
 */
export async function enviarLembretes() {
  if (!emHorarioComercialSP()) return

  const corte = new Date(Date.now() - DIAS_ENTRE_LEMBRETES * 86_400_000)
  const candidatas = await useDb()
    .select({ id: solicitacoes.id })
    .from(solicitacoes)
    .where(
      and(
        eq(solicitacoes.status, 'aberta'),
        eq(solicitacoes.lembretes, true),
        lt(solicitacoes.lembretesEnviados, MAX_LEMBRETES),
        sql`${solicitacoes.enviadoEm} is not null`,
        sql`coalesce(${solicitacoes.ultimoLembreteEm}, ${solicitacoes.enviadoEm}) < ${corte.toISOString()}::timestamptz`,
        // entrega recente: o cliente esta mexendo, nao e hora de cobrar
        or(isNull(solicitacoes.ultimaEntregaEm), lt(solicitacoes.ultimaEntregaEm, corte)),
        sql`exists (select 1 from sys_mail_solic_itens i where i.solic_id = ${solicitacoes.id}
                     and i.obrigatorio and i.status in ('pendente', 'recusado'))`
      )
    )
    .limit(50)
  for (const c of candidatas) await enviarEmailSolic(c.id, 'lembrete', { porNome: 'lembrete automático' })
}

/**
 * Avisa quem pediu que o cliente terminou de entregar. Espera 10 minutos
 * depois da ultima entrega: quem esta enviando 8 arquivos gera um aviso so,
 * e nao oito.
 */
export async function avisarEntregasConcluidas() {
  const db = useDb()
  const prontas = await db
    .select()
    .from(solicitacoes)
    .where(
      and(
        eq(solicitacoes.status, 'em_analise'),
        lt(solicitacoes.ultimaEntregaEm, new Date(Date.now() - 10 * 60_000)),
        or(isNull(solicitacoes.avisoEquipeEm), sql`${solicitacoes.avisoEquipeEm} < ${solicitacoes.ultimaEntregaEm}`)
      )
    )
    .limit(20)
  for (const s of prontas) {
    await db.update(solicitacoes).set({ avisoEquipeEm: new Date() }).where(eq(solicitacoes.id, s.id))
    const itens = await db.select().from(solicItens).where(eq(solicItens.solicId, s.id)).orderBy(asc(solicItens.ordem))
    const analisar = itens.filter(esperandoAnalise)
    await avisarEquipe(
      s,
      'Documentos prontos para análise',
      `${s.destinatarioNome || s.destinatarioEmail}${s.empresa ? ` (${s.empresa})` : ''} entregou os documentos obrigatórios de "${s.titulo}".`,
      analisar.map(i => (i.status === 'nao_possui' ? `${i.titulo} — informou que não possui` : i.titulo))
    )
    await webhookSolicitacao('solicitacao.entregue', s, {
      itens: analisar.map(i => ({ titulo: i.titulo, status: i.status }))
    })
  }
}

/** Payload comum dos webhooks de solicitacao: quem, o que e onde estao os arquivos. */
export async function webhookSolicitacao(
  evento: 'solicitacao.entregue' | 'solicitacao.concluida' | 'solicitacao.respondida',
  s: Solicitacao,
  extra: Record<string, unknown> = {}
) {
  await emitirWebhook(
    evento,
    {
      solicitacaoId: s.id,
      codigo: codigoSolicitacao(s),
      titulo: s.titulo,
      cliente: { nome: s.destinatarioNome, email: s.destinatarioEmail, documento: s.documento, empresa: s.empresa },
      pasta: s.pasta,
      criadoPor: s.criadoPorNome,
      ...extra
    },
    `/admin/solicitacoes/${s.id}`
  )
}

/* -------------------------------------------------------------------------
 * Leitura para as telas
 * ---------------------------------------------------------------------- */

/** Contagens por solicitacao, para a lista e o cabecalho do detalhe. */
export const CONTAGENS_SOLIC = sql<{
  total: number
  obrigatorios: number
  obrigatorios_entregues: number
  aprovados: number
  para_analisar: number
  recusados: number
}>`(
  select json_build_object(
    'total', count(*),
    'obrigatorios', count(*) filter (where i.obrigatorio),
    'obrigatorios_entregues', count(*) filter (where i.obrigatorio and i.status in ('enviado', 'aprovado', 'nao_possui')),
    'aprovados', count(*) filter (where i.status = 'aprovado' or (i.status = 'nao_possui' and i.analisado_em is not null)),
    'para_analisar', count(*) filter (where i.status = 'enviado' or (i.status = 'nao_possui' and i.analisado_em is null)),
    'recusados', count(*) filter (where i.status = 'recusado')
  ) from sys_mail_solic_itens i where i.solic_id = sys_mail_solic.id
)`

type Contagens = { total: number; obrigatorios: number; obrigatorios_entregues: number; aprovados: number; para_analisar: number; recusados: number }

export function resumoDaLinha(s: Solicitacao, c: Contagens): ResumoSolicitacao {
  const iso = (d: Date | null) => (d ? d.toISOString() : null)
  return {
    id: s.id,
    codigo: codigoSolicitacao(s),
    titulo: s.titulo,
    destinatarioNome: s.destinatarioNome,
    destinatarioEmail: s.destinatarioEmail,
    empresa: s.empresa,
    documento: s.documento,
    status: s.status as StatusSolicitacao,
    prazo: s.prazo,
    grupo: s.grupo,
    criadoPorNome: s.criadoPorNome,
    createdAt: s.createdAt.toISOString(),
    enviadoEm: iso(s.enviadoEm),
    envioErro: s.envioErro,
    primeiroAcessoEm: iso(s.primeiroAcessoEm),
    ultimaEntregaEm: iso(s.ultimaEntregaEm),
    concluidaEm: iso(s.concluidaEm),
    totalItens: Number(c.total),
    obrigatorios: Number(c.obrigatorios),
    obrigatoriosEntregues: Number(c.obrigatorios_entregues),
    aprovados: Number(c.aprovados),
    paraAnalisar: Number(c.para_analisar),
    recusados: Number(c.recusados)
  }
}

export async function carregarSolicitacao(id: number) {
  const [s] = await useDb().select().from(solicitacoes).where(eq(solicitacoes.id, id))
  if (!s) throw createError({ statusCode: 404, statusMessage: 'Solicitação não encontrada' })
  return s
}

export async function detalheSolicitacao(id: number): Promise<DetalheSolicitacao> {
  const db = useDb()
  const [linha] = await db
    .select({ s: solicitacoes, c: CONTAGENS_SOLIC })
    .from(solicitacoes)
    .where(eq(solicitacoes.id, id))
  if (!linha) throw createError({ statusCode: 404, statusMessage: 'Solicitação não encontrada' })
  const s = linha.s

  const itens = await db.select().from(solicItens).where(eq(solicItens.solicId, id)).orderBy(asc(solicItens.ordem))
  const arquivos = await db
    .select()
    .from(solicArquivos)
    .where(eq(solicArquivos.solicId, id))
    .orderBy(asc(solicArquivos.enviadoEm))
  const eventos = await db
    .select()
    .from(solicEventos)
    .where(eq(solicEventos.solicId, id))
    .orderBy(desc(solicEventos.criadoEm), desc(solicEventos.id))
    .limit(300)

  const iso = (d: Date | null) => (d ? d.toISOString() : null)
  return {
    ...resumoDaLinha(s, linha.c as Contagens),
    criadoPorUserId: s.criadoPorUserId,
    mensagem: s.mensagem,
    contaId: s.contaId,
    contaNome: s.contaNome,
    responderPara: s.responderPara,
    lembretes: s.lembretes,
    lembretesEnviados: s.lembretesEnviados,
    ultimoLembreteEm: iso(s.ultimoLembreteEm),
    avisarConclusao: s.avisarConclusao,
    link: linkSolicitacao(s.token),
    pasta: s.pasta,
    concluidaPorNome: s.concluidaPorNome,
    canceladaEm: iso(s.canceladaEm),
    canceladaPorNome: s.canceladaPorNome,
    canceladaMotivo: s.canceladaMotivo,
    recusasNaoAvisadas: itens.filter(i => i.status === 'recusado' && !i.recusaAvisadaEm).length,
    itens: itens.map(i => ({
      id: i.id,
      ordem: i.ordem,
      titulo: i.titulo,
      instrucao: i.instrucao,
      obrigatorio: i.obrigatorio,
      tipos: i.tipos,
      maxArquivos: i.maxArquivos,
      modeloNome: i.modeloPath ? i.modeloNome : null,
      status: i.status as StatusItemSolicitacao,
      motivo: i.motivo,
      analisadoPorNome: i.analisadoPorNome,
      analisadoEm: iso(i.analisadoEm),
      recusaAvisadaEm: iso(i.recusaAvisadaEm),
      arquivos: arquivos
        .filter(a => a.itemId === i.id)
        .map(a => ({
          id: a.id,
          nome: a.nomeOriginal,
          tamanho: a.tamanho,
          enviadoEm: a.enviadoEm.toISOString(),
          antivirus: a.antivirus as StatusAntivirus,
          antivirusMsg: a.antivirusMsg,
          sha256: a.sha256,
          removidoEm: iso(a.removidoEm)
        }))
    })),
    eventos: eventos.map(e => ({
      id: e.id,
      itemId: e.itemId,
      tipo: e.tipo,
      descricao: e.descricao,
      porNome: e.porNome,
      ip: e.ip,
      criadoEm: e.criadoEm.toISOString()
    }))
  }
}

/* -------------------------------------------------------------------------
 * Link publico do cliente
 * ---------------------------------------------------------------------- */

/** Solicitacao do token. Mensagem neutra: nao revela se o token existiu. */
export async function solicitacaoDoToken(token: string) {
  if (!/^[0-9a-f-]{36}$/i.test(token)) throw createError({ statusCode: 404, statusMessage: 'Link inválido ou expirado' })
  const [s] = await useDb().select().from(solicitacoes).where(eq(solicitacoes.token, token))
  if (!s) throw createError({ statusCode: 404, statusMessage: 'Link inválido ou expirado' })
  return s
}

export async function itemDoToken(s: Solicitacao, itemId: number) {
  const [item] = await useDb()
    .select()
    .from(solicItens)
    .where(and(eq(solicItens.id, itemId), eq(solicItens.solicId, s.id)))
  if (!item) throw createError({ statusCode: 404, statusMessage: 'Item não encontrado' })
  return item
}

/** O que a pagina /r/<token> mostra. Nada interno: pasta, hash e IP ficam de fora. */
export async function landingSolicitacao(s: Solicitacao): Promise<LandingSolicitacao> {
  const db = useDb()
  const encerrada = s.status === 'cancelada'
  const itens = encerrada
    ? []
    : await db.select().from(solicItens).where(eq(solicItens.solicId, s.id)).orderBy(asc(solicItens.ordem))
  const arquivos = encerrada
    ? []
    : await db
        .select()
        .from(solicArquivos)
        .where(and(eq(solicArquivos.solicId, s.id), isNull(solicArquivos.removidoEm)))
        .orderBy(asc(solicArquivos.enviadoEm))
  return {
    titulo: s.titulo,
    mensagem: s.mensagem,
    nome: s.destinatarioNome,
    empresa: s.empresa,
    codigo: codigoSolicitacao(s),
    prazo: s.prazo,
    status: s.status as StatusSolicitacao,
    itens: itens.map(i => ({
      id: i.id,
      titulo: i.titulo,
      instrucao: i.instrucao,
      obrigatorio: i.obrigatorio,
      tipos: i.tipos,
      maxArquivos: i.maxArquivos,
      modeloNome: i.modeloPath ? i.modeloNome || 'modelo' : null,
      status: i.status as StatusItemSolicitacao,
      motivo: i.motivo,
      analisado: !!i.analisadoEm && i.status !== 'recusado',
      arquivos: arquivos
        .filter(a => a.itemId === i.id)
        .map(a => ({
          id: a.id,
          nome: a.nomeOriginal,
          tamanho: a.tamanho,
          enviadoEm: a.enviadoEm.toISOString(),
          antivirus: a.antivirus as StatusAntivirus
        }))
    }))
  }
}

/** Registra o acesso ao link. Um evento por hora no maximo: F5 nao vira historico. */
export async function registrarAcessoSolic(s: Solicitacao, ip: string | null) {
  const agora = new Date()
  const recente = s.ultimoAcessoEm && agora.getTime() - s.ultimoAcessoEm.getTime() < 3_600_000
  await useDb()
    .update(solicitacoes)
    .set({ ultimoAcessoEm: agora, ...(s.primeiroAcessoEm ? {} : { primeiroAcessoEm: agora }) })
    .where(eq(solicitacoes.id, s.id))
  if (!recente) {
    await registrarEventoSolic(s.id, 'acesso', s.primeiroAcessoEm ? 'Cliente abriu o link' : 'Cliente abriu o link pela primeira vez', {
      ip,
      porNome: 'cliente'
    })
  }
}

/** "Nao possuo": vale para item pendente ou recusado, sem arquivo no item. */
export async function marcarNaoPossui(s: Solicitacao, item: SolicItem, justificativa: string, ip: string | null) {
  if (s.status === 'concluida' || s.status === 'cancelada') recusar('Esta solicitação já foi encerrada.', 409)
  if (item.status !== 'pendente' && item.status !== 'recusado') {
    recusar(item.status === 'nao_possui' ? 'Você já marcou este item.' : 'Remova os arquivos deste item antes de marcar que não possui.', 409)
  }
  // obrigatorio e obrigatorio: "nao tenho" nao resolve (se falta, a equipe fala com o cliente)
  if (item.obrigatorio) recusar('Este documento é obrigatório. Se você não tiver, fale com a Contábil Gaulke.', 422)
  if ((await arquivosAtivos(item.id)).length) recusar('Remova os arquivos deste item antes de marcar que não possui.', 409)
  const texto = justificativa.trim().slice(0, 500)

  const db = useDb()
  await db
    .update(solicItens)
    .set({ status: 'nao_possui', motivo: texto || null, analisadoEm: null, analisadoPorNome: null, recusaAvisadaEm: null })
    .where(eq(solicItens.id, item.id))
  await db.update(solicitacoes).set({ ultimaEntregaEm: new Date() }).where(eq(solicitacoes.id, s.id))
  await registrarEventoSolic(s.id, 'nao_possui', `Cliente informou que não possui "${item.titulo}"${texto ? `: ${texto}` : ''}`, {
    itemId: item.id,
    ip,
    porNome: 'cliente'
  })
  await recalcularStatus(s.id)
}

export async function desfazerNaoPossui(s: Solicitacao, item: SolicItem, ip: string | null) {
  if (s.status === 'concluida' || s.status === 'cancelada') recusar('Esta solicitação já foi encerrada.', 409)
  if (item.status !== 'nao_possui') recusar('Este item não está marcado como "não possuo".', 409)
  if (item.analisadoEm) recusar('A equipe já analisou este item. Fale conosco para mudar.', 409)
  await useDb().update(solicItens).set({ status: 'pendente', motivo: null }).where(eq(solicItens.id, item.id))
  await registrarEventoSolic(s.id, 'nao_possui_desfeito', `Cliente desfez o "não possuo" de "${item.titulo}"`, {
    itemId: item.id,
    ip,
    porNome: 'cliente'
  })
  await recalcularStatus(s.id)
}
