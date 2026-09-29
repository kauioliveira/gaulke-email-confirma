import { createHash, randomInt, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { and, asc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import QRCode from 'qrcode'
import {
  useDb,
  useSql,
  assinDocumentos,
  assinSignatarios,
  assinCampos,
  assinEventos,
  certificados,
  type AssinDocumento,
  type AssinSignatario
} from '../db'
import { resolverConta, enviarEmail } from './mailer'
import { renderizarBlocos } from './blocos'
import { baseUrl } from './urls'
import { preencherEmail } from './solicitacoes'
import { caminhoDocumento, slugPasta, pastaDoCliente } from './documentos'
import { certificadoParaAssinar } from './certificados'
import { selarPdf } from './pades'
import { emitirWebhook } from './webhooks'
import type { Bloco } from '../../shared/types/blocos'
import type {
  ResumoAssinatura,
  DetalheAssinatura,
  LandingAssinatura,
  StatusAssinatura,
  StatusSignatario,
  TipoCampoAssinatura
} from '../../shared/types/api'

/**
 * Assinatura eletronica de documentos internos e contratos (decisao D5):
 * assinatura AVANCADA — e-mail + codigo de uso unico (OTP) + IP + dispositivo
 * + hash do documento —, com o selo PAdES do certificado da Gaulke so quando
 * marcado (D6). Horarios sempre em Sao Paulo.
 *
 * Estados do documento: rascunho -> aguardando -> concluido | recusado | cancelado
 * Estados do signatario: pendente (nao e a vez) -> aguardando -> assinado | recusado
 */

const ALFABETO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
const OTP_VALIDADE_MS = 10 * 60_000
const OTP_MAX_TENTATIVAS = 5

export const codigoAssinatura = (id: number) => `ASS-${String(id).padStart(6, '0')}`
export const linkAssinatura = (token: string, base = baseUrl()) => `${base}/a/${token}`
export const linkValidacao = (codigo: string, base = baseUrl()) => `${base}/validar?c=${codigo}`

export function novoCodigoVerificacao() {
  return Array.from({ length: 10 }, () => ALFABETO[randomInt(ALFABETO.length)]).join('')
}

const sha256 = (v: string | Uint8Array) => createHash('sha256').update(v).digest('hex')

/* -------------------------------------------------------------------------
 * Validacao da criacao
 * ---------------------------------------------------------------------- */

export const TIPOS_CAMPO = ['assinatura', 'rubrica', 'data', 'nome'] as const

export const criarAssinaturaSchema = z.object({
  arquivoTmp: z.string().regex(/^[0-9a-f-]{36}$/, 'Envie o PDF de novo'),
  arquivoNome: z.string().trim().min(1).max(260),
  titulo: z.string().trim().min(3, 'Dê um título ao documento').max(200),
  mensagem: z.string().trim().max(4000).nullish().transform(v => v || null),
  ordem: z.enum(['paralela', 'sequencial']).default('paralela'),
  assinarComoGaulke: z.boolean().default(false),
  certificadoId: z.number().int().positive().nullish(),
  prazo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish()
    .transform(v => v || null)
    .refine(v => !v || v >= dataSP(), 'O prazo não pode estar no passado'),
  clienteNome: z.string().trim().max(200).nullish().transform(v => v || null),
  clienteDocumento: z
    .string()
    .nullish()
    .transform(v => (v || '').replace(/\D/g, '') || null)
    .refine(v => !v || v.length === 11 || v.length === 14, 'CPF/CNPJ deve ter 11 ou 14 dígitos'),
  contaId: z.number().int().positive().nullish(),
  responderPara: z.string().trim().max(300).nullish().transform(v => v || null),
  signatarios: z
    .array(
      z.object({
        nome: z.string().trim().min(3, 'Informe o nome completo de quem assina').max(200),
        email: z.string().trim().toLowerCase().email('E-mail inválido').max(320),
        cpf: z
          .string()
          .nullish()
          .transform(v => (v || '').replace(/\D/g, '') || null)
          .refine(v => !v || v.length === 11, 'CPF deve ter 11 dígitos'),
        papel: z.string().trim().max(60).nullish().transform(v => v || null)
      })
    )
    .min(1, 'Inclua pelo menos uma pessoa para assinar')
    .max(20),
  campos: z
    .array(
      z.object({
        signatario: z.number().int().min(0),
        tipo: z.enum(TIPOS_CAMPO),
        pagina: z.number().int().min(1),
        x: z.number().min(0),
        y: z.number().min(0),
        largura: z.number().min(10).max(2000),
        altura: z.number().min(8).max(2000)
      })
    )
    .max(400)
    .default([])
})

/* -------------------------------------------------------------------------
 * Historico encadeado
 * ---------------------------------------------------------------------- */

type OpcoesEvento = { signatarioId?: number | null; porNome?: string | null; ip?: string | null; userAgent?: string | null }

function hashEvento(anterior: string | null, documentoId: number, tipo: string, descricao: string, o: OpcoesEvento, criadoEm: string) {
  return sha256(JSON.stringify([anterior, documentoId, o.signatarioId ?? null, tipo, descricao, o.porNome ?? null, o.ip ?? null, criadoEm]))
}

/**
 * Grava um evento com o hash do anterior. O lock por documento serializa
 * eventos simultaneos (dois signatarios ao mesmo tempo): sem ele os dois
 * leriam o mesmo "anterior" e a corrente bifurcaria.
 */
export async function registrarEventoAssin(documentoId: number, tipo: string, descricao: string, o: OpcoesEvento = {}) {
  const sqlc = useSql()
  await sqlc.begin(async tx => {
    await tx`select pg_advisory_xact_lock(${827011400}::int, ${documentoId}::int)`
    const [ult] = await tx<{ hash: string }[]>`select hash from sys_mail_assin_eventos where documento_id = ${documentoId} order by id desc limit 1`
    const anterior = ult?.hash ?? null
    const criadoEm = new Date().toISOString()
    const hash = hashEvento(anterior, documentoId, tipo, descricao, o, criadoEm)
    await tx`
      insert into sys_mail_assin_eventos (documento_id, signatario_id, tipo, descricao, por_nome, ip, user_agent, criado_em, hash_anterior, hash)
      values (${documentoId}, ${o.signatarioId ?? null}, ${tipo}, ${descricao}, ${o.porNome ?? null}, ${o.ip ?? null},
              ${o.userAgent?.slice(0, 500) ?? null}, ${criadoEm}::timestamptz, ${anterior}, ${hash})`
  })
}

/** Refaz a corrente: qualquer linha alterada, apagada ou inserida no meio aparece aqui. */
export async function verificarCorrente(documentoId: number) {
  const eventos = await useDb()
    .select()
    .from(assinEventos)
    .where(eq(assinEventos.documentoId, documentoId))
    .orderBy(asc(assinEventos.id))
  let anterior: string | null = null
  for (const e of eventos) {
    const esperado = hashEvento(anterior, documentoId, e.tipo, e.descricao, { signatarioId: e.signatarioId, porNome: e.porNome, ip: e.ip }, e.criadoEm.toISOString())
    if (e.hashAnterior !== anterior || e.hash !== esperado) return { ok: false, eventos: eventos.length, quebraNoEvento: e.id }
    anterior = e.hash
  }
  return { ok: true, eventos: eventos.length, quebraNoEvento: null as number | null }
}

/* -------------------------------------------------------------------------
 * E-mails
 * ---------------------------------------------------------------------- */

const RODAPE_ASSIN =
  'Esta é uma assinatura eletrônica: registramos a data, a hora (Brasília), o endereço IP e o dispositivo de cada ' +
  'acesso e assinatura, e o código de confirmação enviado a este e-mail. O tratamento segue a Lei 13.709/2018 (LGPD). ' +
  'O link é pessoal — não o encaminhe.'

type TipoEmailAssin = 'convite' | 'lembrete' | 'codigo' | 'concluido'

async function enviarEmailSignatario(
  doc: AssinDocumento,
  s: AssinSignatario,
  tipo: TipoEmailAssin,
  extra: { codigo?: string; anexo?: Buffer } = {}
) {
  const prazo = doc.prazo ? formatarData(`${doc.prazo}T12:00:00${DESLOCAMENTO_SP}`) : null
  const blocos: Bloco[] = [
    { id: 'logo', tipo: 'logo', alinhamento: 'centro' },
    { id: 'ola', tipo: 'titulo', texto: 'Olá, {{nome}}!' }
  ]
  let assunto = ''
  if (tipo === 'convite' || tipo === 'lembrete') {
    assunto = `${tipo === 'lembrete' ? 'Lembrete: ' : ''}Documento para assinar: ${doc.titulo}`
    blocos.push({
      id: 'intro',
      tipo: 'texto',
      texto:
        tipo === 'lembrete'
          ? `O documento "${doc.titulo}" ainda aguarda a sua assinatura.`
          : doc.mensagem || `A Contábil Gaulke enviou o documento "${doc.titulo}" para a sua assinatura eletrônica.`
    })
    if (prazo) blocos.push({ id: 'prazo', tipo: 'aviso', cor: 'atencao', texto: `Prazo para assinar: ${prazo}.`, alinhamento: 'esquerda' })
    blocos.push({ id: 'botao', tipo: 'botao', texto: 'Ver e assinar o documento' })
    blocos.push({
      id: 'como',
      tipo: 'texto',
      texto: 'Na hora de assinar, enviaremos um código de confirmação para este e-mail. Não é preciso instalar nada nem ter certificado digital.',
      alinhamento: 'esquerda'
    })
  } else if (tipo === 'codigo') {
    assunto = `Seu código para assinar: ${extra.codigo}`
    blocos.push({
      id: 'intro',
      tipo: 'texto',
      texto: `Use o código abaixo para confirmar a sua assinatura em "${doc.titulo}". Ele vale por 10 minutos.`,
      alinhamento: 'esquerda'
    })
    blocos.push({ id: 'cod', tipo: 'codigo', rotulo: 'Código de confirmação', ajuda: 'Se não foi você quem pediu, ignore este e-mail: sem o código ninguém assina no seu nome.' })
  } else {
    assunto = `Documento assinado por todos: ${doc.titulo}`
    blocos.push({
      id: 'intro',
      tipo: 'texto',
      texto: `Todas as pessoas assinaram "${doc.titulo}". O documento assinado, com a folha de assinaturas, vai anexado a este e-mail e também pode ser baixado pelo botão abaixo.`
    })
    blocos.push({ id: 'botao', tipo: 'botao', texto: 'Baixar o documento assinado' })
  }
  blocos.push({ id: 'rodape', tipo: 'rodape', texto: RODAPE_ASSIN })

  const html = preencherEmail(renderizarBlocos(blocos, assunto), {
    nome: s.nome.split(' ')[0] || s.nome,
    email: s.email,
    empresa: '',
    link: linkAssinatura(s.token),
    codigo: extra.codigo ?? codigoAssinatura(doc.id)
  })
  const conta = await resolverConta(doc.contaId)
  const dominio = (/@([^>\s]+)>?\s*$/.exec(conta.from)?.[1] || 'contabilgaulke.com.br').toLowerCase()
  await enviarEmail({
    conta,
    para: s.email,
    assunto,
    html,
    texto: [assunto, '', tipo === 'codigo' ? `Código: ${extra.codigo}` : `Acesse: ${linkAssinatura(s.token)}`, '', `Documento ${codigoAssinatura(doc.id)}`].join('\n'),
    responderPara: doc.responderPara,
    messageId: `<${codigoAssinatura(doc.id)}.${tipo}.${randomInt(1e9).toString(36)}@${dominio}>`,
    headers: { 'X-Gaulke-Assinatura': codigoAssinatura(doc.id) },
    ...(extra.anexo ? { anexos: [{ nome: `${codigoAssinatura(doc.id)}_${slugPasta(doc.titulo, 50)}_assinado.pdf`, conteudo: extra.anexo, tipo: 'application/pdf' }] } : {})
  })
}

/** Convite (ou lembrete). Nunca lanca: o erro fica no signatario e no historico. */
export async function convidar(signatarioId: number, tipo: 'convite' | 'lembrete' = 'convite', porNome?: string | null) {
  const db = useDb()
  const [s] = await db.select().from(assinSignatarios).where(eq(assinSignatarios.id, signatarioId))
  if (!s) return { ok: false, erro: 'signatário não existe' }
  const [doc] = await db.select().from(assinDocumentos).where(eq(assinDocumentos.id, s.documentoId))
  if (!doc) return { ok: false, erro: 'documento não existe' }
  try {
    await enviarEmailSignatario(doc, s, tipo)
    await db
      .update(assinSignatarios)
      .set({
        envioErro: null,
        ...(tipo === 'convite'
          ? { conviteEnviadoEm: new Date() }
          : { ultimoLembreteEm: new Date(), lembretesEnviados: sql`${assinSignatarios.lembretesEnviados} + 1` })
      })
      .where(eq(assinSignatarios.id, s.id))
    await registrarEventoAssin(doc.id, `email_${tipo}`, `${tipo === 'convite' ? 'Convite' : 'Lembrete'} enviado para ${s.nome} <${s.email}>`, {
      signatarioId: s.id,
      porNome
    })
    return { ok: true }
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e)
    await db.update(assinSignatarios).set({ envioErro: erro }).where(eq(assinSignatarios.id, s.id))
    await registrarEventoAssin(doc.id, 'email_erro', `Falha ao enviar ${tipo} para ${s.email}: ${erro}`, { signatarioId: s.id, porNome })
    return { ok: false, erro }
  }
}

/**
 * Libera quem pode assinar agora: na ordem paralela, todos de uma vez; na
 * sequencial, so o proximo da fila (quando nao ha ninguem aguardando).
 */
export async function liberarProximos(documentoId: number, porNome?: string | null) {
  const db = useDb()
  const [doc] = await db.select().from(assinDocumentos).where(eq(assinDocumentos.id, documentoId))
  if (!doc || doc.status !== 'aguardando') return
  const sigs = await db.select().from(assinSignatarios).where(eq(assinSignatarios.documentoId, documentoId)).orderBy(asc(assinSignatarios.ordem), asc(assinSignatarios.id))
  const liberar =
    doc.ordem === 'paralela'
      ? sigs.filter(s => s.status === 'pendente')
      : sigs.some(s => s.status === 'aguardando')
        ? []
        : sigs.filter(s => s.status === 'pendente').slice(0, 1)
  for (const s of liberar) {
    await db.update(assinSignatarios).set({ status: 'aguardando' }).where(eq(assinSignatarios.id, s.id))
    await convidar(s.id, 'convite', porNome)
  }
}

/* -------------------------------------------------------------------------
 * Codigo de confirmacao (OTP)
 * ---------------------------------------------------------------------- */

function hashOtp(token: string, codigo: string) {
  const pimenta = process.env.SESSION_SECRET || process.env.SMTP_CRYPTO_KEY || 'gaulke-comunica'
  return sha256(`${pimenta}:${token}:${codigo}`)
}

export async function enviarCodigo(doc: AssinDocumento, s: AssinSignatario, ctx: { ip: string | null; userAgent: string | null }) {
  if (s.otpEnviadoEm && Date.now() - s.otpEnviadoEm.getTime() < 60_000) {
    throw createError({ statusCode: 429, statusMessage: 'Acabamos de enviar um código. Confira o e-mail (e a caixa de spam) ou aguarde um minuto.' })
  }
  const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0')
  await useDb()
    .update(assinSignatarios)
    .set({ otpHash: hashOtp(s.token, codigo), otpExpiraEm: new Date(Date.now() + OTP_VALIDADE_MS), otpTentativas: 0, otpEnviadoEm: new Date() })
    .where(eq(assinSignatarios.id, s.id))
  try {
    await enviarEmailSignatario(doc, s, 'codigo', { codigo })
  } catch (e) {
    throw createError({ statusCode: 502, statusMessage: `Não foi possível enviar o código: ${e instanceof Error ? e.message : e}` })
  }
  await registrarEventoAssin(doc.id, 'codigo_enviado', `Código de confirmação enviado para ${s.email}`, { signatarioId: s.id, ip: ctx.ip, userAgent: ctx.userAgent })
}

function conferirCodigo(s: AssinSignatario, codigo: string) {
  if (!s.otpHash || !s.otpExpiraEm) return 'Peça um código de confirmação primeiro.'
  if (s.otpTentativas >= OTP_MAX_TENTATIVAS) return 'Muitas tentativas com este código. Peça um novo.'
  if (s.otpExpiraEm.getTime() < Date.now()) return 'O código expirou. Peça um novo.'
  const a = Buffer.from(hashOtp(s.token, codigo.replace(/\D/g, '')))
  const b = Buffer.from(s.otpHash)
  return a.length === b.length && timingSafeEqual(a, b) ? null : 'Código incorreto.'
}

/* -------------------------------------------------------------------------
 * Assinar e recusar
 * ---------------------------------------------------------------------- */

export const assinarSchema = z.object({
  codigo: z.string().regex(/^\d{6}$/, 'O código tem 6 dígitos'),
  tipo: z.enum(['digitada', 'desenhada']),
  nome: z.string().trim().min(3, 'Digite o seu nome').max(200),
  // PNG da assinatura desenhada (data URL); teto folgado para um traco a mao
  imagem: z
    .string()
    .max(400_000, 'A imagem da assinatura ficou grande demais')
    .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, 'Imagem da assinatura inválida')
    .nullish(),
  aceite: z.literal(true, { errorMap: () => ({ message: 'É preciso concordar com a assinatura eletrônica' }) })
})

export async function assinar(
  doc: AssinDocumento,
  s: AssinSignatario,
  d: z.output<typeof assinarSchema>,
  ctx: { ip: string | null; userAgent: string | null }
) {
  const db = useDb()
  if (doc.status !== 'aguardando') throw createError({ statusCode: 409, statusMessage: 'Este documento não está mais aguardando assinaturas.' })
  if (s.status === 'assinado') throw createError({ statusCode: 409, statusMessage: 'Você já assinou este documento.' })
  if (s.status !== 'aguardando') throw createError({ statusCode: 409, statusMessage: 'Ainda não é a sua vez de assinar.' })
  if (d.tipo === 'desenhada' && !d.imagem) throw createError({ statusCode: 400, statusMessage: 'Desenhe a sua assinatura.' })

  const erro = conferirCodigo(s, d.codigo)
  if (erro) {
    await db.update(assinSignatarios).set({ otpTentativas: sql`${assinSignatarios.otpTentativas} + 1` }).where(eq(assinSignatarios.id, s.id))
    await registrarEventoAssin(doc.id, 'codigo_invalido', `Tentativa de assinar com código inválido (${erro})`, { signatarioId: s.id, ip: ctx.ip, userAgent: ctx.userAgent })
    throw createError({ statusCode: 422, statusMessage: erro })
  }

  const agora = new Date()
  // o update condicional e a trava contra duplo clique / duas abas
  const feito = await db
    .update(assinSignatarios)
    .set({
      status: 'assinado',
      assinadoEm: agora,
      otpValidadoEm: agora,
      otpHash: null,
      tipoAssinatura: d.tipo,
      nomeAssinatura: d.nome,
      imagemAssinatura: d.tipo === 'desenhada' ? d.imagem! : null,
      ip: ctx.ip,
      userAgent: ctx.userAgent?.slice(0, 500) ?? null
    })
    .where(and(eq(assinSignatarios.id, s.id), eq(assinSignatarios.status, 'aguardando')))
    .returning({ id: assinSignatarios.id })
  if (!feito.length) throw createError({ statusCode: 409, statusMessage: 'Esta assinatura já foi registrada.' })

  await registrarEventoAssin(
    doc.id,
    'assinado',
    `${s.nome} <${s.email}> assinou (${d.tipo === 'digitada' ? `nome digitado: "${d.nome}"` : 'assinatura desenhada'}), código de confirmação validado; documento original SHA-256 ${doc.originalSha256}`,
    { signatarioId: s.id, ip: ctx.ip, userAgent: ctx.userAgent }
  )
  await emitirWebhook(
    'assinatura.assinada',
    { documentoId: doc.id, codigo: codigoAssinatura(doc.id), titulo: doc.titulo, signatario: { nome: s.nome, email: s.email, papel: s.papel }, assinadoEm: agora.toISOString() },
    `/admin/assinaturas/${doc.id}`
  )

  const restantes = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(assinSignatarios)
    .where(and(eq(assinSignatarios.documentoId, doc.id), sql`${assinSignatarios.status} <> 'assinado'`))
  if (!restantes[0]?.n) await finalizarDocumento(doc.id)
  else await liberarProximos(doc.id)
}

export async function recusar(doc: AssinDocumento, s: AssinSignatario, motivo: string, ctx: { ip: string | null; userAgent: string | null }) {
  const db = useDb()
  if (doc.status !== 'aguardando') throw createError({ statusCode: 409, statusMessage: 'Este documento não está mais aguardando assinaturas.' })
  if (s.status !== 'aguardando') throw createError({ statusCode: 409, statusMessage: s.status === 'assinado' ? 'Você já assinou.' : 'Ainda não é a sua vez.' })
  const texto = motivo.trim().slice(0, 1000)
  if (texto.length < 3) throw createError({ statusCode: 400, statusMessage: 'Conte o motivo da recusa.' })
  await db
    .update(assinSignatarios)
    .set({ status: 'recusado', recusadoEm: new Date(), recusaMotivo: texto, ip: ctx.ip, userAgent: ctx.userAgent?.slice(0, 500) ?? null })
    .where(eq(assinSignatarios.id, s.id))
  await db.update(assinDocumentos).set({ status: 'recusado' }).where(eq(assinDocumentos.id, doc.id))
  await registrarEventoAssin(doc.id, 'recusado', `${s.nome} <${s.email}> recusou: ${texto}`, { signatarioId: s.id, ip: ctx.ip, userAgent: ctx.userAgent })
  await emitirWebhook(
    'assinatura.recusada',
    { documentoId: doc.id, codigo: codigoAssinatura(doc.id), titulo: doc.titulo, signatario: { nome: s.nome, email: s.email }, motivo: texto },
    `/admin/assinaturas/${doc.id}`
  )
  await avisarQuemPediu(doc, `Assinatura recusada: ${doc.titulo}`, `${s.nome} (${s.email}) recusou assinar "${doc.titulo}".`, [`Motivo: ${texto}`])
}

export async function avisarQuemPediu(doc: AssinDocumento, assunto: string, texto: string, lista: string[] = [], anexo?: Buffer) {
  if (!doc.criadoPorEmail) return
  const link = `${baseUrl()}/admin/assinaturas/${doc.id}`
  const blocos: Bloco[] = [
    { id: 't', tipo: 'titulo', texto: assunto },
    { id: 'x', tipo: 'texto', texto, alinhamento: 'esquerda' },
    ...(lista.length ? [{ id: 'l', tipo: 'lista' as const, itens: lista, alinhamento: 'esquerda' as const }] : []),
    { id: 'b', tipo: 'botao', texto: 'Abrir o documento' },
    { id: 'r', tipo: 'rodape', texto: 'Aviso automático do Gaulke Comunica.' }
  ]
  try {
    await enviarEmail({
      conta: await resolverConta(doc.contaId),
      para: doc.criadoPorEmail,
      assunto: `[${codigoAssinatura(doc.id)}] ${assunto}`,
      html: preencherEmail(renderizarBlocos(blocos, assunto), { nome: '', email: doc.criadoPorEmail, empresa: '', link, codigo: codigoAssinatura(doc.id) }),
      texto: `${assunto}\n\n${texto}\n${lista.map(l => `- ${l}`).join('\n')}\n\n${link}`,
      ...(anexo ? { anexos: [{ nome: `${codigoAssinatura(doc.id)}_assinado.pdf`, conteudo: anexo, tipo: 'application/pdf' }] } : {})
    })
  } catch (e) {
    console.error('[gaulke-mail] aviso da assinatura', doc.id, e instanceof Error ? e.message : e)
  }
}

/* -------------------------------------------------------------------------
 * PDF final: assinaturas nos campos, carimbo nas paginas, folha de
 * assinaturas com QR e, se marcado, o selo PAdES da Gaulke
 * ---------------------------------------------------------------------- */

const COR_MARCA = rgb(0.204, 0.22, 0.506)
const COR_TEXTO = rgb(0.2, 0.25, 0.33)
const COR_MUTADA = rgb(0.39, 0.45, 0.55)
const COR_BORDA = rgb(0.85, 0.88, 0.92)

async function ativo(nome: string) {
  const b = await useStorage('assets:server').getItemRaw<Buffer | Uint8Array>(nome)
  if (!b) throw new Error(`arquivo interno ${nome} não encontrado`)
  return b instanceof Uint8Array ? b : new Uint8Array(b as ArrayBuffer)
}

/** Texto que a Helvetica (WinAnsi) consegue desenhar: o resto vira "?". */
function seguroPara(fonte: PDFFont) {
  const cache = new Map<string, boolean>()
  return (t: unknown) =>
    [...String(t ?? '').normalize('NFC')]
      .map(ch => {
        if (ch === '\n') return ch
        let ok = cache.get(ch)
        if (ok === undefined) {
          try {
            fonte.encodeText(ch)
            ok = true
          } catch {
            ok = false
          }
          cache.set(ch, ok)
        }
        return ok ? ch : '?'
      })
      .join('')
}

function quebrar(texto: string, fonte: PDFFont, tamanho: number, largura: number) {
  const linhas: string[] = []
  for (const par of texto.split('\n')) {
    let atual = ''
    for (const palavra of par.split(/\s+/)) {
      const tentativa = atual ? `${atual} ${palavra}` : palavra
      if (fonte.widthOfTextAtSize(tentativa, tamanho) <= largura || !atual) atual = tentativa
      else {
        linhas.push(atual)
        atual = palavra
      }
    }
    linhas.push(atual)
  }
  return linhas
}

const iniciais = (nome: string) =>
  nome
    .split(/\s+/)
    .filter(p => p.length > 2 || /^[A-ZÀ-Ú]/.test(p))
    .map(p => p[0]!.toUpperCase())
    .join('')
    .slice(0, 4)

function mascararCpf(cpf: string | null) {
  return cpf && cpf.length === 11 ? `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**` : null
}

function dispositivo(ua: string | null) {
  if (!ua) return 'não informado'
  const so = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'outro'
  const nav = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'navegador'
  return `${nav} em ${so}`
}

/** Desenha a assinatura (imagem ou nome na fonte manuscrita) dentro de um retangulo. */
function desenharAssinatura(
  pagina: PDFPage,
  r: { x: number; y: number; largura: number; altura: number },
  o: { imagem?: PDFImage | null; texto: string; manuscrita: PDFFont }
) {
  if (o.imagem) {
    const d = o.imagem.scaleToFit(r.largura, r.altura)
    pagina.drawImage(o.imagem, { x: r.x + (r.largura - d.width) / 2, y: r.y + (r.altura - d.height) / 2, width: d.width, height: d.height })
    return
  }
  let tam = Math.min(r.altura * 0.75, 40)
  while (tam > 6 && o.manuscrita.widthOfTextAtSize(o.texto, tam) > r.largura * 0.95) tam -= 0.5
  const w = o.manuscrita.widthOfTextAtSize(o.texto, tam)
  pagina.drawText(o.texto, { x: r.x + (r.largura - w) / 2, y: r.y + (r.altura - tam) / 2 + tam * 0.2, size: tam, font: o.manuscrita, color: rgb(0.05, 0.1, 0.35) })
}

export async function montarPdfFinal(documentoId: number) {
  const db = useDb()
  const [doc] = await db.select().from(assinDocumentos).where(eq(assinDocumentos.id, documentoId))
  if (!doc?.originalPath) throw new Error('documento sem PDF original')
  const sigs = await db.select().from(assinSignatarios).where(eq(assinSignatarios.documentoId, documentoId)).orderBy(asc(assinSignatarios.ordem), asc(assinSignatarios.id))
  const campos = await db.select().from(assinCampos).where(eq(assinCampos.documentoId, documentoId))

  const pdf = await PDFDocument.load(await readFile(caminhoDocumento(doc.originalPath)))
  pdf.registerFontkit(fontkit)
  const manuscrita = await pdf.embedFont(await ativo('fontes/GreatVibes-Regular.ttf'), { subset: true })
  const fonte = await pdf.embedFont(StandardFonts.Helvetica)
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold)
  const seg = seguroPara(fonte)
  const imagens = new Map<number, PDFImage>()
  for (const s of sigs) {
    if (s.tipoAssinatura === 'desenhada' && s.imagemAssinatura) {
      imagens.set(s.id, await pdf.embedPng(Buffer.from(s.imagemAssinatura.split(',')[1]!, 'base64')))
    }
  }
  const paginasOriginais = pdf.getPageCount()
  const codigo = codigoAssinatura(doc.id)

  // 1. campos
  for (const c of campos) {
    const s = sigs.find(x => x.id === c.signatarioId)
    if (!s?.assinadoEm || c.pagina > paginasOriginais) continue
    const pg = pdf.getPage(c.pagina - 1)
    const r = { x: c.x, y: c.y, largura: c.largura, altura: c.altura }
    if (c.tipo === 'assinatura' || c.tipo === 'rubrica') {
      const texto = c.tipo === 'rubrica' ? iniciais(s.nomeAssinatura || s.nome) : s.nomeAssinatura || s.nome
      desenharAssinatura(pg, r, { imagem: c.tipo === 'assinatura' || c.tipo === 'rubrica' ? imagens.get(s.id) : null, texto, manuscrita })
      if (c.tipo === 'assinatura') {
        const legenda = seg(`${s.nome} · ${formatarDataHora(s.assinadoEm)} · ${codigo}`)
        let tam = 5.5
        while (tam > 3.5 && fonte.widthOfTextAtSize(legenda, tam) > Math.max(r.largura, 120)) tam -= 0.25
        pg.drawText(legenda, { x: r.x, y: Math.max(2, r.y - tam - 1.5), size: tam, font: fonte, color: COR_MUTADA })
      }
    } else {
      const texto = seg(c.tipo === 'data' ? formatarData(s.assinadoEm) : s.nome)
      let tam = Math.min(r.altura * 0.7, 12)
      while (tam > 5 && fonte.widthOfTextAtSize(texto, tam) > r.largura) tam -= 0.25
      pg.drawText(texto, { x: r.x + 1, y: r.y + (r.altura - tam) / 2 + 1, size: tam, font: fonte, color: COR_TEXTO })
    }
  }

  // 2. carimbo discreto no rodape de cada pagina original
  const carimbo = seg(`Assinado eletronicamente via Gaulke Comunica · ${codigo} · confira em ${baseUrl()}/validar com o código ${doc.codigoVerificacao}`)
  for (const pg of pdf.getPages()) {
    const { width } = pg.getSize()
    let tam = 6
    while (tam > 4 && fonte.widthOfTextAtSize(carimbo, tam) > width - 40) tam -= 0.25
    pg.drawText(carimbo, { x: 20, y: 8, size: tam, font: fonte, color: COR_MUTADA })
  }

  // 3. folha de assinaturas
  const logo = await pdf.embedPng(await ativo('marca/logo.png'))
  const qr = await pdf.embedPng(await QRCode.toBuffer(linkValidacao(doc.codigoVerificacao), { margin: 1, width: 300, errorCorrectionLevel: 'M' }))
  const L = 595.28
  const A = 841.89
  const M = 48
  let pg = pdf.addPage([L, A])
  let y = A - M
  const novaPagina = () => {
    pg = pdf.addPage([L, A])
    y = A - M
  }
  const garantir = (h: number) => {
    if (y - h < M + 20) novaPagina()
  }
  const texto = (t: string, o: { tam?: number; f?: PDFFont; cor?: typeof COR_TEXTO; x?: number; largura?: number } = {}) => {
    const tam = o.tam ?? 9
    const f = o.f ?? fonte
    for (const linha of quebrar(seg(t), f, tam, o.largura ?? L - 2 * M - ((o.x ?? M) - M))) {
      garantir(tam + 3)
      pg.drawText(linha, { x: o.x ?? M, y: y - tam, size: tam, font: f, color: o.cor ?? COR_TEXTO })
      y -= tam + 3
    }
  }

  const ld = logo.scaleToFit(120, 40)
  pg.drawImage(logo, { x: M, y: y - ld.height, width: ld.width, height: ld.height })
  pg.drawImage(qr, { x: L - M - 90, y: y - 90, width: 90, height: 90 })
  y -= ld.height + 16
  texto('Folha de assinaturas', { tam: 18, f: negrito, cor: COR_MARCA })
  y -= 4
  texto(doc.titulo, { tam: 11, f: negrito, largura: L - 2 * M - 100 })
  texto(`${codigo} · código de verificação ${doc.codigoVerificacao}`, { tam: 9, cor: COR_MUTADA })
  y = Math.min(y, A - M - 100)
  y -= 8
  const campo = (rotulo: string, valor: string) => {
    garantir(14)
    pg.drawText(seg(rotulo), { x: M, y: y - 8.5, size: 8.5, font: negrito, color: COR_MUTADA })
    const antes = y
    texto(valor, { tam: 8.5, x: M + 120, largura: L - 2 * M - 120 })
    if (y === antes) y -= 12
  }
  campo('Arquivo original', `${doc.originalNome ?? 'documento.pdf'} (${doc.originalPaginas ?? paginasOriginais} página(s))`)
  campo('SHA-256 do original', doc.originalSha256 ?? '—')
  campo('Enviado por', `${doc.criadoPorNome ?? '—'} em ${formatarDataHora(doc.enviadoEm ?? doc.createdAt)}`)
  campo('Concluído em', `${formatarDataHora(new Date())} (horário de Brasília)`)
  if (doc.clienteNome || doc.clienteDocumento) campo('Referente a', [doc.clienteNome, doc.clienteDocumento].filter(Boolean).join(' · '))

  y -= 10
  texto('Assinaturas', { tam: 12, f: negrito, cor: COR_MARCA })
  y -= 4
  for (const s of sigs) {
    const altura = 104
    garantir(altura + 8)
    const topo = y
    pg.drawRectangle({ x: M, y: topo - altura, width: L - 2 * M, height: altura, borderColor: COR_BORDA, borderWidth: 0.8, color: rgb(0.985, 0.988, 0.995) })
    const col = L - 2 * M - 190
    y -= 8
    texto(s.nome, { tam: 10.5, f: negrito, x: M + 10, largura: col })
    texto([s.papel, s.email, mascararCpf(s.cpf) && `CPF ${mascararCpf(s.cpf)}`].filter(Boolean).join(' · '), { tam: 8, cor: COR_MUTADA, x: M + 10, largura: col })
    texto(`Assinou em ${formatarDataHora(s.assinadoEm)} (Brasília)`, { tam: 8.5, x: M + 10, largura: col })
    texto(`Identificação: link pessoal enviado ao e-mail + código de uso único validado às ${formatarHora(s.otpValidadoEm)}`, { tam: 7.5, cor: COR_MUTADA, x: M + 10, largura: col })
    texto(`IP ${s.ip ?? '—'} · ${dispositivo(s.userAgent)} · ${s.tipoAssinatura === 'desenhada' ? 'assinatura desenhada' : 'nome digitado'}`, { tam: 7.5, cor: COR_MUTADA, x: M + 10, largura: col })
    // a assinatura em si, a direita
    desenharAssinatura(pg, { x: L - M - 180, y: topo - altura + 22, largura: 170, altura: 60 }, { imagem: imagens.get(s.id), texto: s.nomeAssinatura || s.nome, manuscrita })
    pg.drawLine({ start: { x: L - M - 175, y: topo - altura + 20 }, end: { x: L - M - 15, y: topo - altura + 20 }, thickness: 0.5, color: COR_BORDA })
    y = topo - altura - 8
  }

  // selo da Gaulke, se marcado
  let selo: Awaited<ReturnType<typeof certificadoParaAssinar>> | null = null
  if (doc.assinarComoGaulke) {
    selo = await certificadoParaAssinar(doc.certificadoId)
    y -= 4
    texto('Selo digital da Contábil Gaulke', { tam: 12, f: negrito, cor: COR_MARCA })
    texto(
      `Este PDF foi assinado digitalmente com o certificado ICP-Brasil de ${selo.registro.titular}${selo.registro.documento ? ` (${selo.registro.documentoTipo} ${selo.registro.documento})` : ''}, emitido por ${selo.registro.emissor ?? '—'}, no padrão PAdES. Qualquer alteração no arquivo invalida o selo. A hora do selo é a do servidor (Brasília), sem carimbo do tempo de terceiros.`,
      { tam: 8.5 }
    )
  }

  y -= 8
  texto('Validade', { tam: 12, f: negrito, cor: COR_MARCA })
  texto(
    'As assinaturas acima são eletrônicas avançadas: cada pessoa recebeu um link pessoal no próprio e-mail e confirmou a assinatura com um código de uso único enviado a esse e-mail. Data, hora, IP e dispositivo ficam registrados num histórico encadeado por hash (cada registro carrega o hash do anterior). As partes reconhecem este meio de comprovação de autoria e integridade, nos termos do art. 10, § 2º, da MP 2.200-2/2001.',
    { tam: 8.5 }
  )
  y -= 4
  texto(`Para conferir a autenticidade, leia o QR code ou acesse ${baseUrl()}/validar e informe o código ${doc.codigoVerificacao} — ou envie lá este PDF.`, { tam: 8.5, f: negrito })

  // historico resumido
  const eventos = await db.select().from(assinEventos).where(eq(assinEventos.documentoId, documentoId)).orderBy(asc(assinEventos.id))
  y -= 10
  texto('Histórico', { tam: 12, f: negrito, cor: COR_MARCA })
  for (const e of eventos) {
    texto(`${formatarDataHora(e.criadoEm)} · ${e.descricao}${e.ip ? ` · IP ${e.ip}` : ''}`, { tam: 7, cor: COR_MUTADA })
  }

  const numero = pdf.getPageCount()
  for (let i = paginasOriginais; i < numero; i++) {
    const p = pdf.getPage(i)
    p.drawText(seg(`${codigo} · folha de assinaturas · página ${i - paginasOriginais + 1} de ${numero - paginasOriginais}`), { x: M, y: 24, size: 7, font: fonte, color: COR_MUTADA })
  }
  pdf.setProducer('Gaulke Comunica')
  pdf.setModificationDate(new Date())

  let bytes: Uint8Array = await pdf.save()
  if (selo) {
    bytes = await selarPdf(bytes, {
      certPem: selo.certPem,
      keyPem: selo.keyPem,
      nome: selo.registro.titular,
      motivo: `Documento ${codigo} assinado por ${sigs.map(s => s.nome).join(', ')}`,
      local: 'Brasil'
    })
  }
  return { bytes: Buffer.from(bytes), sigs, doc, selado: !!selo }
}

/**
 * Todos assinaram: monta o PDF final, grava na pasta, conclui e manda para
 * todo mundo. Uma falha (certificado vencido, por exemplo) NAO perde as
 * assinaturas: fica registrada e o botao "Gerar de novo" tenta outra vez.
 * Sem retentativa automatica de proposito: o erro tipico e permanente (selo
 * com certificado vencido) e so muda quando alguem age.
 */
export async function finalizarDocumento(documentoId: number) {
  const db = useDb()
  try {
    const { bytes, sigs, doc, selado } = await montarPdfFinal(documentoId)
    const caminho = `${doc.pasta}/${codigoAssinatura(doc.id)}_assinado.pdf`
    const abs = caminhoDocumento(caminho)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, bytes)
    const hash = sha256(bytes)
    await db
      .update(assinDocumentos)
      .set({ status: 'concluido', concluidoEm: new Date(), finalPath: caminho, finalSha256: hash, finalizacaoErro: null })
      .where(eq(assinDocumentos.id, doc.id))
    await registrarEventoAssin(doc.id, 'concluido', `Todos assinaram. PDF final gerado${selado ? ' e selado com o certificado da Gaulke (PAdES)' : ''}, SHA-256 ${hash}`)
    const [atual] = await db.select().from(assinDocumentos).where(eq(assinDocumentos.id, doc.id))
    await emitirWebhook(
      'assinatura.concluida',
      {
        documentoId: doc.id,
        codigo: codigoAssinatura(doc.id),
        codigoVerificacao: doc.codigoVerificacao,
        titulo: doc.titulo,
        cliente: { nome: doc.clienteNome, documento: doc.clienteDocumento },
        sha256: hash,
        selado,
        pasta: doc.pasta,
        arquivo: caminho,
        signatarios: sigs.map(s => ({ nome: s.nome, email: s.email, assinadoEm: s.assinadoEm })),
        validacao: linkValidacao(doc.codigoVerificacao)
      },
      `/admin/assinaturas/${doc.id}`
    )
    for (const s of sigs) {
      try {
        await enviarEmailSignatario(atual!, s, 'concluido', { anexo: bytes.length <= 15 * 1024 * 1024 ? bytes : undefined })
      } catch (e) {
        await registrarEventoAssin(doc.id, 'email_erro', `Falha ao enviar o PDF assinado para ${s.email}: ${e instanceof Error ? e.message : e}`, { signatarioId: s.id })
      }
    }
    await avisarQuemPediu(atual!, `Documento assinado por todos: ${doc.titulo}`, `Todas as ${sigs.length} pessoa(s) assinaram "${doc.titulo}". O PDF final vai anexado.`, [], bytes.length <= 15 * 1024 * 1024 ? bytes : undefined)
    return { ok: true }
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e)
    await db.update(assinDocumentos).set({ finalizacaoErro: erro }).where(eq(assinDocumentos.id, documentoId))
    await registrarEventoAssin(documentoId, 'finalizacao_erro', `Falha ao gerar o PDF final: ${erro}`)
    console.error('[gaulke-mail] finalizar assinatura', documentoId, erro)
    return { ok: false, erro }
  }
}

/* -------------------------------------------------------------------------
 * Pasta e lembretes
 * ---------------------------------------------------------------------- */

export function pastaDaAssinatura(d: { id: number; titulo: string; createdAt: Date; clienteNome: string | null; clienteDocumento: string | null }, primeiro: { nome: string; email: string; cpf: string | null }) {
  const ano = dataSP(d.createdAt).slice(0, 4)
  const cliente = pastaDoCliente({
    documento: d.clienteDocumento ?? primeiro.cpf,
    nome: d.clienteNome ?? primeiro.nome,
    email: primeiro.email
  })
  return `${cliente}/${ano}/${codigoAssinatura(d.id)}_${slugPasta(d.titulo, 40)}`
}

/** Lembrete a quem esta com a vez: a cada 3 dias, ate 3, em dia util das 8h as 18h (SP). */
export async function lembrarSignatarios() {
  if (!emHorarioComercialSP()) return
  const corte = new Date(Date.now() - 3 * 86_400_000).toISOString()
  const pendentes = await useSql()<{ id: number }[]>`
    select s.id from sys_mail_assin_signatarios s
      join sys_mail_assin_documentos d on d.id = s.documento_id and d.status = 'aguardando'
     where s.status = 'aguardando' and s.lembretes_enviados < 3 and s.convite_enviado_em is not null
       and coalesce(s.ultimo_lembrete_em, s.convite_enviado_em) < ${corte}::timestamptz
     limit 50`
  for (const p of pendentes) await convidar(p.id, 'lembrete', 'lembrete automático')
}

/* -------------------------------------------------------------------------
 * Leitura para as telas
 * ---------------------------------------------------------------------- */

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)

/** "ma***@empresa.com.br": o suficiente para a pessoa se reconhecer. */
export function mascararEmail(email: string) {
  const [u = '', d = ''] = email.split('@')
  return `${u.slice(0, 2)}${'*'.repeat(Math.max(2, Math.min(6, u.length - 2)))}@${d}`
}

export function resumoAssinatura(d: AssinDocumento, sigs: AssinSignatario[]): ResumoAssinatura {
  return {
    id: d.id,
    codigo: codigoAssinatura(d.id),
    titulo: d.titulo,
    status: d.status as StatusAssinatura,
    ordem: d.ordem as 'paralela' | 'sequencial',
    assinarComoGaulke: d.assinarComoGaulke,
    prazo: d.prazo,
    clienteNome: d.clienteNome,
    criadoPorNome: d.criadoPorNome,
    createdAt: d.createdAt.toISOString(),
    enviadoEm: iso(d.enviadoEm),
    concluidoEm: iso(d.concluidoEm),
    total: sigs.length,
    assinados: sigs.filter(s => s.status === 'assinado').length,
    aguardando: sigs.filter(s => s.status === 'aguardando').map(s => s.nome),
    finalizacaoErro: d.finalizacaoErro
  }
}

export async function carregarAssinatura(id: number) {
  const [d] = await useDb().select().from(assinDocumentos).where(eq(assinDocumentos.id, id))
  if (!d) throw createError({ statusCode: 404, statusMessage: 'Documento não encontrado' })
  return d
}

export async function detalheAssinatura(id: number): Promise<DetalheAssinatura> {
  const db = useDb()
  const d = await carregarAssinatura(id)
  const sigs = await db.select().from(assinSignatarios).where(eq(assinSignatarios.documentoId, id)).orderBy(asc(assinSignatarios.ordem), asc(assinSignatarios.id))
  const campos = await db.select().from(assinCampos).where(eq(assinCampos.documentoId, id)).orderBy(asc(assinCampos.pagina), asc(assinCampos.id))
  const eventos = await db.select().from(assinEventos).where(eq(assinEventos.documentoId, id)).orderBy(asc(assinEventos.id))
  let certificado: DetalheAssinatura['certificado'] = null
  if (d.certificadoId) {
    const [c] = await db.select().from(certificados).where(eq(certificados.id, d.certificadoId))
    if (c) certificado = { nome: c.nome, titular: c.titular, validoAte: c.validoAte.toISOString() }
  }
  return {
    ...resumoAssinatura(d, sigs),
    mensagem: d.mensagem,
    criadoPorUserId: d.criadoPorUserId,
    clienteDocumento: d.clienteDocumento,
    originalNome: d.originalNome,
    originalSha256: d.originalSha256,
    originalPaginas: d.originalPaginas,
    finalSha256: d.finalSha256,
    codigoVerificacao: d.codigoVerificacao,
    linkValidacao: linkValidacao(d.codigoVerificacao),
    contaNome: d.contaNome,
    responderPara: d.responderPara,
    certificado,
    canceladoEm: iso(d.canceladoEm),
    canceladoPorNome: d.canceladoPorNome,
    canceladoMotivo: d.canceladoMotivo,
    pasta: d.pasta,
    signatarios: sigs.map(s => ({
      id: s.id,
      ordem: s.ordem,
      nome: s.nome,
      email: s.email,
      cpf: s.cpf,
      papel: s.papel,
      status: s.status as StatusSignatario,
      conviteEnviadoEm: iso(s.conviteEnviadoEm),
      envioErro: s.envioErro,
      visualizadoEm: iso(s.visualizadoEm),
      assinadoEm: iso(s.assinadoEm),
      recusadoEm: iso(s.recusadoEm),
      recusaMotivo: s.recusaMotivo,
      ip: s.ip,
      tipoAssinatura: s.tipoAssinatura as 'digitada' | 'desenhada' | null,
      lembretesEnviados: s.lembretesEnviados
    })),
    campos: campos.map(c => ({ id: c.id, signatario: c.signatarioId, tipo: c.tipo as TipoCampoAssinatura, pagina: c.pagina, x: c.x, y: c.y, largura: c.largura, altura: c.altura })),
    eventos: eventos.map(e => ({ id: e.id, tipo: e.tipo, descricao: e.descricao, porNome: e.porNome, ip: e.ip, criadoEm: e.criadoEm.toISOString(), hash: e.hash })),
    corrente: await verificarCorrente(id)
  }
}

/** Signatario pelo token do link. Mensagem neutra: nao revela se o token existiu. */
export async function signatarioDoToken(token: string) {
  if (!/^[0-9a-f-]{36}$/i.test(token)) throw createError({ statusCode: 404, statusMessage: 'Link inválido ou expirado' })
  const db = useDb()
  const [s] = await db.select().from(assinSignatarios).where(eq(assinSignatarios.token, token))
  if (!s) throw createError({ statusCode: 404, statusMessage: 'Link inválido ou expirado' })
  const [d] = await db.select().from(assinDocumentos).where(eq(assinDocumentos.id, s.documentoId))
  if (!d || d.status === 'rascunho') throw createError({ statusCode: 404, statusMessage: 'Link inválido ou expirado' })
  return { doc: d, sig: s }
}

export async function landingAssinatura(doc: AssinDocumento, eu: AssinSignatario): Promise<LandingAssinatura> {
  const db = useDb()
  const sigs = await db.select().from(assinSignatarios).where(eq(assinSignatarios.documentoId, doc.id)).orderBy(asc(assinSignatarios.ordem), asc(assinSignatarios.id))
  const campos = await db.select().from(assinCampos).where(and(eq(assinCampos.documentoId, doc.id), eq(assinCampos.signatarioId, eu.id)))
  return {
    titulo: doc.titulo,
    mensagem: doc.mensagem,
    codigo: codigoAssinatura(doc.id),
    status: doc.status as StatusAssinatura,
    prazo: doc.prazo,
    remetente: doc.criadoPorNome,
    paginas: doc.originalPaginas ?? 0,
    eu: {
      nome: eu.nome,
      email: mascararEmail(eu.email),
      status: eu.status as StatusSignatario,
      assinadoEm: iso(eu.assinadoEm),
      codigoEnviadoEm: iso(eu.otpEnviadoEm)
    },
    signatarios: sigs.map(s => ({ nome: s.nome, status: s.status as StatusSignatario, assinadoEm: iso(s.assinadoEm), eu: s.id === eu.id })),
    campos: campos.map(c => ({ tipo: c.tipo as TipoCampoAssinatura, pagina: c.pagina, x: c.x, y: c.y, largura: c.largura, altura: c.altura })),
    temFinal: doc.status === 'concluido' && !!doc.finalPath
  }
}
