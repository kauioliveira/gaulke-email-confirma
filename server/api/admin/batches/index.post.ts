import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { useDb, batches, recipients, templates, accounts } from '../../../db'
import { novoToken, novoCodigo } from '../../../utils/ids'
import { caminhoNoStorage } from '../../../utils/storage'
import { stat } from 'node:fs/promises'
import { registrarEvento } from '../../../utils/tracking'
import { renderizarBlocos } from '../../../utils/blocos'
import { blocosSchema, faltaBotaoDeAcesso, MSG_BOTAO_OBRIGATORIO } from '../../../utils/blocos-schema'
import { auditar } from '../../../utils/auditoria'
import { suprimidos } from '../../../utils/supressao'
import { registrarContatosEmpresa } from '../../../utils/empresa-contatos'
import { camposLoteSchema, normalizarCamposLote, gravarCamposLote } from '../../../utils/lote-campos'

const schema = z.object({
  nome: z.string().min(1).max(200),
  templateId: z.number().int().optional().nullable(),
  // conta de envio; ausente usa a padrao das configuracoes
  contaId: z.number().int().optional().nullable(),
  // abrir chamado no painel (resposta / sem confirmacao); ausente = o do canal
  criarTickets: z.boolean().optional(),
  /**
   * "Respostas para": sai por um canal e as respostas vao para outro endereco
   * (o do setor, por exemplo). Aceita "email@x" ou "Nome <email@x>". Ausente =
   * o reply-to do proprio canal.
   */
  responderPara: z
    .string()
    .trim()
    .max(300)
    .refine(v => v === '' || /^[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+$|<[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+>\s*$/.test(v), {
      message: 'Endereço de resposta inválido'
    })
    .nullish(),
  assunto: z.string().min(1).max(300),
  html: z.string().min(1),
  arquivoNome: z.string().optional().nullable(),
  arquivoOriginal: z.string().optional().nullable(),
  /**
   * nenhum (comunicado) | unico (um arquivo para todos) | individual (cada
   * destinatario com o SEU arquivo, em destinatarios[].arquivoNome)
   */
  modoAnexo: z.enum(['nenhum', 'unico', 'individual']).optional(),
  /** individual: quem ficou sem arquivo recebe o e-mail mesmo assim (sem anexo) */
  enviarSemArquivo: z.boolean().default(false),
  intervaloMs: z.number().int().min(1000).max(600000).default(10000),
  exigirConfirmacao: z.boolean().default(true),
  pedirRecibo: z.boolean().default(false),
  /**
   * Lembrete automatico a quem nao confirmou: a cada N dias, ate `max` vezes,
   * so em dia util das 8h as 18h. Ausente = sem lembrete.
   */
  lembrete: z.object({ dias: z.number().int().min(1).max(30), max: z.number().int().min(1).max(5) }).nullish(),
  // ISO 8601 com fuso; presente = o lote ja nasce agendado
  agendadoPara: z.string().datetime({ offset: true }).nullish(),
  // snapshot do editor visual, para reabrir o lote depois
  formato: z.enum(['blocos', 'html']).default('html'),
  /**
   * Os MESMOS blocos que o editor de templates valida.
   *
   * Aqui era `z.array(z.any())`, o que deixava esta rota — a unica que
   * realmente dispara e-mail — sem validacao nenhuma de bloco: um POST direto
   * passava um rodape vazio, sem o aviso de LGPD, e o HTML era gerado a partir
   * dele mesmo assim (veja a regeracao logo abaixo).
   */
  blocos: blocosSchema.nullish(),
  /**
   * Campos que o cliente preenche na pagina antes de baixar (texto, escolha,
   * declaracao...). Obrigatorio sem resposta bloqueia confirmacao e download.
   */
  campos: camposLoteSchema.default([]),
  destinatarios: z
    .array(
      z.object({
        email: z.string().email(),
        nome: z.string().optional().default(''),
        empresa: z.string().optional().default(''),
        extras: z.record(z.string()).optional(),
        // CPF/CNPJ (so digitos ou com pontuacao) e o arquivo individual
        documento: z.string().max(20).nullish(),
        arquivoNome: z.string().max(260).nullish(),
        arquivoOriginal: z.string().max(260).nullish()
      })
    )
    .min(1)
})

export default defineEventHandler(async event => {
  const dados = validar(schema, await readBody(event))
  const operador = event.context.operador
  const db = useDb()

  /**
   * Com anexo, o botao de acesso volta a ser obrigatorio: sem ele o e-mail
   * anuncia um documento que o destinatario nao tem como alcancar. Sem anexo a
   * regra nao se aplica — e um comunicado, e o botao e opcional.
   */
  const modoAnexo = dados.modoAnexo ?? (dados.arquivoNome ? 'unico' : 'nenhum')
  // valida antes de criar qualquer coisa: campo mal configurado nao vira lote
  const campos = normalizarCamposLote(dados.campos)
  const comArquivoIndividual = dados.destinatarios.filter(d => d.arquivoNome)
  if (modoAnexo === 'individual') {
    if (!comArquivoIndividual.length) {
      throw createError({ statusCode: 400, statusMessage: 'Nenhum destinatário tem arquivo individual ligado.' })
    }
    const sem = dados.destinatarios.length - comArquivoIndividual.length
    if (sem && !dados.enviarSemArquivo) {
      throw createError({
        statusCode: 400,
        statusMessage: `${sem} destinatário(s) ficaram sem arquivo. Ligue um arquivo a cada um, remova-os, ou marque "enviar sem anexo para quem ficou sem arquivo".`
      })
    }
    // cada arquivo precisa existir de verdade no storage, antes de criar o lote
    for (const d of comArquivoIndividual) {
      const info = await stat(caminhoNoStorage(d.arquivoNome!)).catch(() => null)
      if (!info?.isFile()) {
        throw createError({ statusCode: 400, statusMessage: `Arquivo de ${d.email} não encontrado no servidor (${d.arquivoOriginal ?? d.arquivoNome}). Envie de novo.` })
      }
    }
  }

  if ((dados.arquivoNome || modoAnexo === 'individual') && dados.formato === 'blocos' && dados.blocos?.length) {
    if (faltaBotaoDeAcesso(dados.blocos)) {
      throw createError({ statusCode: 400, statusMessage: MSG_BOTAO_OBRIGATORIO })
    }
  }

  // valida o arquivo antes de criar o lote, para nao disparar link quebrado
  if (dados.arquivoNome) {
    const caminho = caminhoNoStorage(dados.arquivoNome)
    const info = await stat(caminho).catch(() => null)
    if (!info?.isFile()) {
      throw createError({ statusCode: 400, statusMessage: 'Arquivo do lote nao encontrado no servidor' })
    }
  }

  /**
   * A conta e resolvida na CRIACAO para o nome ficar gravado no lote, e para o
   * erro aparecer agora — e nao no meio do disparo, com metade da lista ja
   * enviada.
   */
  let contaId: number | null = null
  let contaNome: string | null = null
  let canalCriaTickets = false
  if (dados.contaId) {
    const [c] = await db.select().from(accounts).where(eq(accounts.id, dados.contaId))
    if (!c) throw createError({ statusCode: 400, statusMessage: 'Conta de envio nao encontrada' })
    if (c.ativa !== 'true') {
      throw createError({ statusCode: 400, statusMessage: `A conta "${c.nome}" esta desativada` })
    }
    contaId = c.id
    contaNome = c.nome
    canalCriaTickets = c.criarTickets
  } else {
    const [padrao] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.padrao, 'true'), eq(accounts.ativa, 'true')))
      .limit(1)
    if (padrao) {
      contaId = padrao.id
      contaNome = padrao.nome
      canalCriaTickets = padrao.criarTickets
    }
  }

  /**
   * Em modo blocos o HTML e GERADO AQUI, e nao o que a tela mandou.
   *
   * O `html` do template e um cache derivado dos blocos, gravado quando ele foi
   * salvo pela ultima vez. Quando a arte do e-mail muda (o cabecalho, por
   * exemplo), esse cache fica velho: o preview redesenha na hora e mostra o
   * visual novo, mas o lote saia com o HTML antigo — a tela dizia uma coisa e o
   * destinatario recebia outra, sem erro nenhum aparecer. Regerar no envio
   * elimina a divergencia, e de quebra impede que um html arbitrario vindo do
   * cliente vire o corpo do e-mail.
   */
  const html =
    dados.formato === 'blocos' && dados.blocos?.length
      ? renderizarBlocos(dados.blocos as never, dados.assunto)
      : dados.html

  // lembrete e "voce ainda nao confirmou": sem o botao nao ha como confirmar,
  // e todo mundo receberia lembrete ate o limite
  if (dados.lembrete) {
    const semBotao =
      dados.formato === 'blocos' && dados.blocos?.length
        ? faltaBotaoDeAcesso(dados.blocos)
        : !/\{\{\s*link\s*\}\}/.test(html)
    if (semBotao) {
      throw createError({
        statusCode: 400,
        statusMessage: 'O lembrete automático precisa do botão de acesso no e-mail: é por ele que a pessoa confirma o recebimento.'
      })
    }
  }

  if (dados.templateId) {
    const t = (await db.select({ id: templates.id }).from(templates).where(eq(templates.id, dados.templateId)))[0]
    if (!t) throw createError({ statusCode: 400, statusMessage: 'Template nao encontrado' })
  }

  const [lote] = await db
    .insert(batches)
    .values({
      nome: dados.nome,
      templateId: dados.templateId ?? null,
      // snapshot: o relatorio precisa mostrar exatamente o que foi enviado
      assuntoSnapshot: dados.assunto,
      htmlSnapshot: html,
      formato: dados.formato,
      blocos: (dados.blocos ?? null) as never,
      // preenchido quando a pessoa entrou pela sessao do painel; com a senha
      // do .env nao ha quem registrar, e fica nulo
      criadoPorUserId: operador?.id ?? null,
      criadoPorNome: operador?.nome ?? null,
      contaId,
      contaNome,
      responderPara: dados.responderPara || null,
      criarTickets: dados.criarTickets ?? canalCriaTickets,
      modoAnexo,
      // no individual o arquivo e de cada destinatario; o lote nao tem um so
      arquivoPath: modoAnexo === 'unico' ? dados.arquivoNome ?? null : null,
      arquivoNome:
        modoAnexo === 'unico'
          ? dados.arquivoOriginal || dados.arquivoNome || null
          : modoAnexo === 'individual'
            ? `Arquivo individual (${comArquivoIndividual.length} destinatário(s))`
            : null,
      intervaloMs: dados.intervaloMs,
      exigirConfirmacao: dados.exigirConfirmacao ? 'true' : 'false',
      pedirRecibo: dados.pedirRecibo ? 'true' : 'false',
      lembreteDias: dados.lembrete?.dias ?? null,
      lembreteMax: dados.lembrete?.max ?? 0,
      status: dados.agendadoPara ? 'agendado' : 'rascunho',
      agendadoPara: dados.agendadoPara ? new Date(dados.agendadoPara) : null,
      agendadoEm: dados.agendadoPara ? new Date() : null,
      total: dados.destinatarios.length
    })
    .returning()

  /**
   * Dedupe final no servidor: a UI pode ter sido burlada.
   *
   * No anexo individual a chave e e-mail + arquivo: na contabilidade o mesmo
   * socio recebe por varias empresas, e cada arquivo precisa do seu link e do
   * seu codigo — deduplicar so pelo e-mail deixava ele com um arquivo so.
   */
  const vistos = new Set<string>()
  const chaveDe = (email: string, arquivo: string | null | undefined) =>
    modoAnexo === 'individual' && arquivo ? `${email}|${arquivo}` : email
  const linhas = []
  // enderecos suprimidos (devolveram definitivamente) ficam de fora: a tela ja
  // avisa antes; aqui e a garantia
  const bloqueados = new Set((await suprimidos(dados.destinatarios.map(d => d.email))).map(s => s.email))
  let ignoradosSupressao = 0
  for (const d of dados.destinatarios) {
    const email = d.email.trim().toLowerCase()
    if (bloqueados.has(email)) { ignoradosSupressao++; continue }
    const chave = chaveDe(email, d.arquivoNome)
    if (vistos.has(chave)) continue
    vistos.add(chave)
    linhas.push({
      batchId: lote!.id,
      email,
      nome: d.nome || null,
      empresa: d.empresa || null,
      documento: soDigitos(d.documento) ?? null,
      arquivoPath: modoAnexo === 'individual' ? d.arquivoNome ?? null : null,
      arquivoNome: modoAnexo === 'individual' ? d.arquivoOriginal || d.arquivoNome || null : null,
      dadosExtras: (d.extras && Object.keys(d.extras).length ? d.extras : null) as never,
      token: novoToken(),
      codigo: novoCodigo(),
      status: 'pendente'
    })
  }

  if (!linhas.length) {
    await db.delete(batches).where(eq(batches.id, lote!.id))
    throw createError({
      statusCode: 400,
      statusMessage: 'Todos os destinatários estão na lista de supressão (devolveram definitivamente). Corrija os e-mails.'
    })
  }

  await gravarCamposLote(lote!.id, campos)

  // insere em blocos para nao estourar o limite de parametros do Postgres
  const inseridos = []
  for (let i = 0; i < linhas.length; i += 500) {
    inseridos.push(...(await db.insert(recipients).values(linhas.slice(i, i + 500)).returning({ id: recipients.id })))
  }

  if (inseridos.length !== lote!.total) {
    await db.update(batches).set({ total: inseridos.length }).where(eq(batches.id, lote!.id))
  }
  await Promise.all(inseridos.map(r => registrarEvento(r.id, 'enfileirado')))
  // aprende qual e-mail recebe por CPF/CNPJ (sugestao na busca de empresa)
  await registrarContatosEmpresa(linhas, 'lote')

  await auditar(event, 'lote.criar', {
    entidade: 'lote',
    id: lote!.id,
    resumo:
      `Criou o lote "${lote!.nome}" com ${inseridos.length} destinatário(s)` +
      (lote!.agendadoPara ? `, agendado para ${formatarDataHora(lote!.agendadoPara)}` : ''),
    dados: {
      assunto: dados.assunto,
      total: inseridos.length,
      canal: contaNome,
      responderPara: dados.responderPara || null,
      arquivo: lote!.arquivoNome,
      lembrete: dados.lembrete ?? null,
      templateId: dados.templateId ?? null,
      agendadoPara: dados.agendadoPara ?? null,
      campos: campos.length ? campos.map(c => ({ tipo: c.tipo, titulo: c.titulo, obrigatorio: c.obrigatorio })) : undefined
    }
  })

  return { lote: { ...lote!, total: inseridos.length }, destinatarios: inseridos.length, ignoradosSupressao }
})
