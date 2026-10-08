<script setup lang="ts">
import {
  TIPOS_ANEXO,
  acceptDe,
  familiasDe,
  iconeDoArquivo as iconePorExtensao
} from '~~/shared/types/tipos-arquivo'
import { tamanho, duracao } from '~/utils/formato'
import { normalizarConfig } from '~~/shared/utils/itens-solic'
import { destinatariosDasLinhas, nomeDoLotePeloArquivo, type LinhaArquivo } from '~/utils/lote-arquivos'
import {
  FORMATOS_NOME,
  AMOSTRA_NOME,
  AMOSTRA_EMPRESA,
  abreviarNome,
  formatarNome,
  formatarDestinatario,
  type FormatoNome
} from '~/utils/nomes'

// a chave pela URL remonta a página ao trocar entre envio comum e "arquivos por cliente"
definePageMeta({ layout: 'admin', middleware: 'admin', key: r => r.fullPath })

const toast = useToast()
// canais de saida sao geridos so por admin; os demais apenas escolhem
const { eAdmin } = usePapel()
const route = useRoute()
/**
 * /admin/lotes/novo?origem=arquivos: o lote "arquivos por cliente" começa
 * pelo ZIP — os destinatários saem do CNPJ de cada arquivo (LoteArquivos).
 * Os passos de e-mail e revisão são os mesmos do envio comum.
 */
const porArquivos = route.query.origem === 'arquivos'
useHead({ title: porArquivos ? 'Arquivos por cliente — Gaulke Comunica' : 'Novo envio — Gaulke Comunica' })
const passo = ref(1)
const PASSOS = porArquivos
  ? [
      { n: 1, titulo: 'Template e arquivos', icone: 'i-lucide-folder-archive' },
      { n: 2, titulo: 'Página de download', icone: 'i-lucide-text-cursor-input' },
      { n: 3, titulo: 'Revisar e-mail', icone: 'i-lucide-mail' },
      { n: 4, titulo: 'Revisão', icone: 'i-lucide-rocket' }
    ]
  : [
      { n: 1, titulo: 'Lista', icone: 'i-lucide-users' },
      { n: 2, titulo: 'Arquivo', icone: 'i-lucide-file-text' },
      { n: 3, titulo: 'E-mail', icone: 'i-lucide-mail' },
      { n: 4, titulo: 'Revisão', icone: 'i-lucide-rocket' }
    ]

/* ---------- Passo 1: lista (SeletorDestinatarios) ---------- */
// "Usar num envio", da tela da lista: /admin/lotes/novo?lista=12
const listaInicial = Number(route.query.lista) || undefined

/* ---------- Passo 1 do "arquivos por cliente": um arquivo por linha ---------- */
const linhasArquivos = ref<LinhaArquivo[]>([])
const destinatariosArquivos = computed(() => destinatariosDasLinhas(linhasArquivos.value))
/** o nome do lote nasce do ZIP; depois de editado pela pessoa, não muda mais */
const nomeEditado = ref(false)
function sugerirNomeLote(arquivo: string) {
  if (!nomeEditado.value) nomeLote.value = nomeDoLotePeloArquivo(arquivo)
}

/* ---------- campos da página do cliente (preenchidos antes de baixar) ---------- */
const camposPagina = ref<ItemModeloChecklist[]>([])
const erroCampos = computed(() => {
  for (const [i, c] of camposPagina.value.entries()) {
    if (c.tipo !== 'informativo' && !c.titulo.trim()) return `Dê um nome ao campo ${i + 1}.`
    if (c.tipo === 'informativo' && !c.config.texto?.trim()) {
      return `Item ${i + 1} (texto informativo): falta o texto. A linha de cima é só o título — clique em “Escrever o texto” no item.`
    }
    const r = normalizarConfig(c.tipo, c.config)
    if (!r.ok) return `Campo ${i + 1}: ${r.erro}`
  }
  return null
})

/* ---------- O carrinho: todas as origens somam no mesmo lote ---------- */
/**
 * Indexado por e-mail em minúsculas (o SeletorDestinatarios cuida disso):
 * duas origens trazendo a mesma pessoa resultam em UM destinatário.
 */
type Item = ItemDestinatario
const carrinho = ref<Record<string, Item>>({})

/**
 * Padronizacao dos nomes escolhida por quem dispara. E aplicada na SAIDA, nao
 * na entrada: o carrinho guarda o texto original, entao trocar de formato
 * refaz a lista inteira sem perder informacao.
 */
const formatoNome = ref<FormatoNome>('titulo')
const formatoEmpresa = ref<FormatoNome>('titulo')

/** Abreviacao combina com qualquer uma das caixas, e so vale para o nome. */
const abreviar = ref(false)

/** Como cada opcao ficaria, no proprio texto de amostra do campo. */
function exemploNome(f: FormatoNome) {
  const base = formatarNome(AMOSTRA_NOME, f)
  return abreviar.value ? abreviarNome(base) : base
}

const exemploEmpresa = (f: FormatoNome) => formatarNome(AMOSTRA_EMPRESA, f)

const listaProcessada = computed(() => ({
  validos: (porArquivos ? destinatariosArquivos.value : Object.values(carrinho.value)).map(d =>
    formatarDestinatario(d, {
      nome: formatoNome.value,
      empresa: formatoEmpresa.value,
      abreviarNome: abreviar.value
    })
  ),
  rejeitados: [] as { linha: number; email: string; motivo: string }[]
}))

const totalCarrinho = computed(() => (porArquivos ? destinatariosArquivos.value.length : Object.keys(carrinho.value).length))
/** para a tabela do seletor mostrar o nome ja padronizado */
const listaFormatada = computed(() => new Map(listaProcessada.value.validos.map(d => [d.email, d])))

/* ---------- Passo 2: arquivo ---------- */
const { data: arquivos, refresh: recarregarArquivos } = await useFetch<RespostaArquivos>(api('/api/admin/arquivos'))
const arquivoNome = ref('')
const arquivoOriginal = ref('')
const enviandoArquivo = ref(false)

/**
 * `accept` e lista de formatos saem do MESMO mapa que o servidor usa para
 * aceitar o upload (shared/types/tipos-arquivo.ts). Mantê-los aqui à mão
 * faria a tela oferecer um formato que o servidor recusa, ou o contrário.
 */
const ACCEPT_ANEXO = acceptDe(TIPOS_ANEXO)
const FORMATOS_ANEXO = familiasDe(TIPOS_ANEXO)

/** Ícone conforme a extensão, para a lista de arquivos já enviados. */
function iconeDoArquivo(nome: string) {
  return iconePorExtensao(nome || '')
}

/**
 * Vincular um anexo torna o botão de acesso obrigatório — é ele que leva o
 * destinatário até o arquivo. Se a pessoa já tinha removido o botão (o que é
 * permitido num comunicado sem anexo), ele volta AQUI, com aviso, em vez de o
 * erro aparecer lá na frente, na hora de criar o lote, com a lista já montada.
 */
function garantirBotaoDeAcesso() {
  if (formatoEmail.value !== 'blocos' || !blocosEmail.value.length) return
  if (blocosEmail.value.some(b => b.tipo === 'botao')) return

  const botao: Bloco = {
    id: `b-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    tipo: 'botao',
    texto: 'Acessar documento'
  }
  // antes do rodapé, que fecha o e-mail
  const i = blocosEmail.value.findIndex(b => b.tipo === 'rodape')
  const lista = [...blocosEmail.value]
  lista.splice(i >= 0 ? i : lista.length, 0, botao)
  blocosEmail.value = lista

  toast.add({
    title: 'Botão de acesso recolocado',
    description: 'Com um arquivo anexo o e-mail precisa do botão — sem ele o destinatário não chega ao documento.',
    color: 'info'
  })
}

async function subirAnexo(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  if (!f) return
  enviandoArquivo.value = true
  try {
    const fd = new FormData()
    fd.append('arquivo', f)
    const r = await $fetch<any>(api('/api/admin/upload'), { method: 'POST', body: fd })
    arquivoNome.value = r.nome
    arquivoOriginal.value = r.nomeOriginal
    await recarregarArquivos()
    garantirBotaoDeAcesso()
    toast.add({ title: 'Arquivo enviado', description: r.nomeOriginal, color: 'success' })
  } catch (err: any) {
    toast.add({
      title: 'Falha no upload',
      description: err?.data?.statusMessage || err?.statusMessage,
      color: 'error'
    })
  } finally {
    enviandoArquivo.value = false
    input.value = ''
  }
}

function escolherExistente(a: any) {
  arquivoNome.value = a.nome
  arquivoOriginal.value = a.nome
  garantirBotaoDeAcesso()
}

/** Desvincula o anexo — o envio volta a ser um comunicado simples. */
function removerAnexo() {
  arquivoNome.value = ''
  arquivoOriginal.value = ''
}

/* ---------- modo do anexo: nenhum | único | individual ---------- */
type ModoAnexo = 'nenhum' | 'unico' | 'individual'
const modoAnexo = ref<ModoAnexo>(porArquivos ? 'individual' : 'nenhum')
const MODOS_ANEXO: { valor: ModoAnexo; titulo: string; texto: string; icone: string }[] = [
  { valor: 'nenhum', titulo: 'Sem anexo', texto: 'Só um aviso (comunicado).', icone: 'i-lucide-megaphone' },
  { valor: 'unico', titulo: 'Um arquivo para todos', texto: 'O mesmo documento para a lista inteira.', icone: 'i-lucide-file' },
  { valor: 'individual', titulo: 'Um arquivo para cada destinatário', texto: 'Cada cliente recebe o SEU: guia, holerite, informe.', icone: 'i-lucide-files' }
]

// anexo individual: arquivos recebidos, ligações feitas à mão e a opção de
// mandar sem anexo para quem ficou sem arquivo
type ArquivoIndividual = { nome: string; original: string; tamanho: number; tipo: string }
const arquivosIndividuais = ref<ArquivoIndividual[]>([])
const ligacoesManuais = ref<Record<string, string>>({})
const enviarSemArquivo = ref(false)

const casamento = computed(() =>
  casarArquivos(arquivosIndividuais.value, listaProcessada.value.validos, ligacoesManuais.value)
)
const totalComArquivo = computed(() => Object.keys(casamento.value.casados).length)

function escolherModoAnexo(m: ModoAnexo) {
  modoAnexo.value = m
  if (m !== 'unico') removerAnexo()
  if (m !== 'nenhum') garantirBotaoDeAcesso()
}
// o botão de acesso é obrigatório também no individual
watch(totalComArquivo, n => { if (n && modoAnexo.value === 'individual') garantirBotaoDeAcesso() })
watch(() => destinatariosArquivos.value.length, n => { if (n) garantirBotaoDeAcesso() })

/* ---------- Passo 3: e-mail ---------- */
const { data: templatesData } = await useFetch<RespostaTemplates>(api('/api/admin/templates'))
const templateId = ref<number | null>(null)
const assunto = ref('')
const html = ref('')
const formatoEmail = ref<FormatoTemplate>('html')
const blocosEmail = ref<Bloco[]>([])

/**
 * Imagens do bloco de imagem: as artes fixas de public/brand e as enviadas
 * pela tela, numa lista só. `recarregarImagens` roda depois de cada upload.
 */
const { data: brand, refresh: recarregarImagens } = await useFetch<{
  arquivos: { nome: string; caminho: string; origem: 'sistema' | 'enviada' }[]
}>(api('/api/admin/imagens'), {
  lazy: true,
  server: false
})
const arquivosBrand = computed(() => brand.value?.arquivos || [])

/**
 * O lote HERDA o formato do template. Editar aqui altera só este envio — o
 * template original continua intacto, que é o mesmo comportamento do assunto.
 */
function aplicarTemplate(id: number | null) {
  const t = templatesData.value?.templates.find(x => x.id === id)
  if (!t) return
  templateId.value = t.id
  assunto.value = t.assunto
  html.value = t.html
  formatoEmail.value = (t as any).formato === 'blocos' ? 'blocos' : 'html'
  const bs = (t as any).blocos
  blocosEmail.value = Array.isArray(bs) && bs.length ? JSON.parse(JSON.stringify(bs)) : blocosPadraoCliente()
}
// no "arquivos por cliente" a pessoa escolhe o template de propósito, antes do ZIP
if (!porArquivos && templatesData.value?.templates.length) aplicarTemplate(templatesData.value.templates[0]!.id)
const templateEscolhido = computed(() => templatesData.value?.templates.find(t => t.id === templateId.value) ?? null)

const opcoesTemplates = computed(() =>
  (templatesData.value?.templates || []).map(t => ({
    label: `${t.nome}${t.categoria ? ` · ${t.categoria}` : ''}${t.tipo === 'comunicado' ? ' (comunicado)' : ''}`,
    value: t.id
  }))
)

/* ---------- Passo 4: revisão ---------- */
const nomeLote = ref(porArquivos ? '' : `Envio ${formatarData(new Date())}`)
const intervaloSegundos = ref(10)
const exigirConfirmacao = ref(true)
const pedirRecibo = ref(false)
// lembrete automatico: so com o botao de acesso, que e por onde se confirma
const lembreteLigado = ref(false)
const lembreteDias = ref(3)
const lembreteMax = ref(2)
const temBotaoDeAcesso = computed(() =>
  formatoEmail.value === 'blocos' ? blocosEmail.value.some(b => b.tipo === 'botao') : /\{\{\s*link\s*\}\}/.test(html.value)
)
const lembreteDoEnvio = computed(() =>
  lembreteLigado.value && temBotaoDeAcesso.value ? { dias: lembreteDias.value, max: lembreteMax.value } : null
)
const criando = ref(false)

/* ---------- agendamento ---------- */
const quandoDisparar = ref<'depois' | 'agendar'>('depois')
const dataAgendada = ref('')

/**
 * Sugere daqui a 1h, na hora cheia — evita cair numa data invalida.
 * A hora e a de Sao Paulo, e nao a do computador de quem agenda: o campo e
 * interpretado como horario de Brasilia (veja agendadoParaISO).
 */
function sugerirHorario() {
  const p = partesSP(new Date(Date.now() + 60 * 60 * 1000))
  return `${p.ano}-${p.mes}-${p.dia}T${p.hora}:00`
}

watch(quandoDisparar, v => {
  if (v === 'agendar' && !dataAgendada.value) dataAgendada.value = sugerirHorario()
})

/**
 * O input datetime-local devolve hora SEM fuso ("2026-08-27T08:00"). Ela e
 * sempre entendida como horario de Sao Paulo, e nao do navegador: quem agenda
 * de um notebook com o relogio em outro fuso continuaria marcando 8h de
 * Brasilia. Mandar a string crua faria 8h virar 8h UTC — 3h antes.
 */
const agendadoParaISO = computed(() => {
  if (quandoDisparar.value !== 'agendar' || !dataAgendada.value) return null
  return localSPparaISO(dataAgendada.value)
})

const agendamentoValido = computed(() => {
  if (quandoDisparar.value !== 'agendar') return true
  const iso = agendadoParaISO.value
  return !!iso && new Date(iso).getTime() > Date.now()
})

const OPCOES_INTERVALO = [
  { label: '5 segundos', value: 5 },
  { label: '10 segundos (recomendado)', value: 10 },
  { label: '15 segundos', value: 15 },
  { label: '30 segundos', value: 30 },
  { label: '60 segundos', value: 60 }
]

const tempoEstimado = computed(() =>
  duracao(Math.max(0, listaProcessada.value.validos.length - 1) * intervaloSegundos.value * 1000)
)

const podeAvancar = computed(() => {
  if (passo.value === 1) return totalCarrinho.value > 0 && (!porArquivos || (!!nomeLote.value.trim() && !!templateId.value))
  if (passo.value === 2 && porArquivos) return !erroCampos.value
  if (passo.value === 2) {
    if (modoAnexo.value === 'unico') return !!arquivoNome.value
    if (modoAnexo.value === 'individual') {
      return totalComArquivo.value > 0 && (!casamento.value.semArquivo.length || enviarSemArquivo.value)
    }
  }
  if (passo.value === 3) {
    const temConteudo = formatoEmail.value === 'blocos' ? blocosEmail.value.length > 0 : !!html.value
    return !!assunto.value && temConteudo
  }
  return true
})

/**
 * Contas de envio. A escolha fica gravada no lote: e ela que decide de qual
 * caixa o e-mail sai, e o relatorio precisa poder dizer isso depois.
 */
const { data: contasData } = await useFetch<RespostaContas>(api('/api/admin/contas'), {
  lazy: true,
  server: false
})
// 0 = nenhuma conta escolhida. O USelect nao aceita null no v-model, e a
// conversao para null acontece no envio.
const contaId = ref<number>(0)
const contasAtivas = computed(() => (contasData.value?.contas ?? []).filter(c => c.ativa))
const itensConta = computed(() =>
  contasAtivas.value.map(c => ({
    label: c.padrao ? `${c.nome} (padrão)` : c.nome,
    value: c.id
  }))
)
// pré-seleciona a padrão assim que a lista chega, sem sobrescrever uma escolha
// que a pessoa já tenha feito
watch(contasAtivas, cs => {
  if (!contaId.value) contaId.value = cs.find(c => c.padrao)?.id ?? cs[0]?.id ?? 0
}, { immediate: true })

const rotuloFormatoNome = computed(() => {
  const nome = FORMATOS_NOME.find(f => f.valor === formatoNome.value)?.titulo || ''
  const empresa = FORMATOS_NOME.find(f => f.valor === formatoEmpresa.value)?.titulo || ''
  return `nome ${abreviar.value ? 'abreviado, ' : ''}${nome.toLowerCase()} · empresa ${empresa.toLowerCase()}`
})

const contaEscolhida = computed(() => contasAtivas.value.find(c => c.id === contaId.value) || null)

/**
 * "Respostas para": sai por um canal e as respostas podem ir para outro — o
 * do setor, por exemplo. 'canal' = o reply-to do próprio canal de saída.
 */
const OUTRO = 'outro'
const respostaModo = ref<string>('canal')
const respostaOutro = ref('')
const itensResposta = computed(() => {
  const proprio = contaEscolhida.value?.responderPara || contaEscolhida.value?.remetente
  const vistos = new Set<string>([String(proprio ?? '').toLowerCase()])
  const deOutrosCanais = contasAtivas.value
    .filter(c => c.id !== contaId.value)
    .map(c => ({ canal: c.nome, endereco: c.responderPara || c.remetente }))
    .filter(x => {
      const k = x.endereco.toLowerCase()
      if (vistos.has(k)) return false
      vistos.add(k)
      return true
    })
  return [
    { label: proprio ? `O do próprio canal — ${proprio}` : 'O do próprio canal', value: 'canal' },
    ...deOutrosCanais.map(x => ({ label: `${x.canal} — ${x.endereco}`, value: x.endereco })),
    { label: 'Outro endereço…', value: OUTRO }
  ]
})
// trocou o canal: a opção escolhida pode ter deixado de existir
watch(contaId, () => {
  if (respostaModo.value !== OUTRO && respostaModo.value !== 'canal'
    && !itensResposta.value.some(i => i.value === respostaModo.value)) respostaModo.value = 'canal'
})
/** o que vai para o lote: nulo = o do canal */
const responderPara = computed(() => {
  if (respostaModo.value === 'canal') return null
  if (respostaModo.value === OUTRO) return respostaOutro.value.trim() || null
  return respostaModo.value
})
const respostaInvalida = computed(
  () => respostaModo.value === OUTRO && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(respostaOutro.value.trim())
)

/* ---------- domínios que não recebem e-mail / digitados errado ---------- */
const emailsDaLista = computed(() => listaProcessada.value.validos.map(d => d.email))
const dominiosSemEmail = ref(0)

/** Troca o domínio em todos os e-mails afetados (a chave do carrinho é o e-mail). */
function corrigirDominio(de: string, para: string) {
  if (porArquivos) {
    let trocados = 0
    linhasArquivos.value = linhasArquivos.value.map(l => ({
      ...l,
      emails: l.emails.map(e => {
        if (!e.email.endsWith(`@${de}`)) return e
        trocados++
        return { ...e, email: `${e.email.slice(0, -de.length)}${para}`, manual: true }
      })
    }))
    toast.add({ title: `${trocados} e-mail(s) corrigido(s) para @${para}`, color: 'success', icon: 'i-lucide-wand-sparkles' })
    return
  }
  const novo: Record<string, Item> = {}
  let trocados = 0
  for (const [email, item] of Object.entries(carrinho.value)) {
    if (email.endsWith(`@${de}`)) {
      const corrigido = `${email.slice(0, -de.length)}${para}`
      novo[corrigido] = { ...item, email: corrigido }
      trocados++
    } else {
      novo[email] = item
    }
  }
  carrinho.value = novo
  toast.add({ title: `${trocados} e-mail(s) corrigido(s) para @${para}`, color: 'success', icon: 'i-lucide-wand-sparkles' })
}
function removerEmails(emails: string[]) {
  const fora = new Set(emails)
  if (porArquivos) {
    linhasArquivos.value = linhasArquivos.value.map(l => ({
      ...l,
      emails: l.emails.map(e => (fora.has(e.email) ? { ...e, marcado: false } : e))
    }))
    toast.add({ title: `${emails.length} e-mail(s) desmarcado(s)`, color: 'success' })
    return
  }
  carrinho.value = Object.fromEntries(Object.entries(carrinho.value).filter(([e]) => !fora.has(e)))
  toast.add({ title: `${emails.length} destinatário(s) removido(s) da lista`, color: 'success' })
}

/* ---------- chamados no painel ---------- */
// pré-marcado conforme o canal; quem envia pode desligar para este lote
const criarTickets = ref(false)
watch(contaEscolhida, c => { criarTickets.value = !!c?.criarTickets }, { immediate: true })

/**
 * As respostas vão para uma caixa que alguém monitora? Se o "Respostas para"
 * aponta para um endereço que não é de canal com monitor ligado, o sistema não
 * vai ver as respostas — nem abrir chamado.
 */
const caixaNaoMonitorada = computed(() => {
  const destino = (responderPara.value || contaEscolhida.value?.responderPara || contaEscolhida.value?.remetente || '')
    .replace(/.*</, '').replace(/>.*/, '').trim().toLowerCase()
  if (!destino) return false
  return !contasAtivas.value.some(c =>
    c.monitorarCaixa && [c.remetente, c.responderPara ?? ''].some(e => e.replace(/.*</, '').replace(/>.*/, '').trim().toLowerCase() === destino)
  )
})

/* ---------- confirmação antes de criar/agendar ---------- */
const confirmando = ref(false)
const resumoEnvio = computed(() => ({
  canal: contaEscolhida.value?.nome ?? null,
  remetente: contaEscolhida.value?.remetente ?? null,
  responderPara: responderPara.value ?? contaEscolhida.value?.responderPara ?? null,
  destinatarios: listaProcessada.value.validos.length,
  anexo: porArquivos
    ? `Um arquivo por cliente: ${new Set(destinatariosArquivos.value.map(d => d.arquivoNome)).size} arquivo(s)${camposPagina.value.length ? ` · ${camposPagina.value.length} campo(s) na página` : ''}`
    : modoAnexo.value === 'individual'
      ? `Individual: ${totalComArquivo.value} com arquivo${casamento.value.semArquivo.length ? `, ${casamento.value.semArquivo.length} sem arquivo (vão sem anexo)` : ''}`
      : arquivoOriginal.value || null,
  quando: (agendadoParaISO.value ? 'agendado' : 'rascunho') as 'agendado' | 'rascunho',
  agendadoPara: agendadoParaISO.value,
  duracao: tempoEstimado.value,
  exigirConfirmacao: exigirConfirmacao.value,
  lembrete: lembreteDoEnvio.value,
  avisos: [
    ...(dominiosSemEmail.value
      ? [`${dominiosSemEmail.value} endereço(s)/domínio(s) da lista não recebe(m) e-mail — esses envios vão voltar como devolução.`]
      : []),
    ...(criarTickets.value && caixaNaoMonitorada.value
      ? ['As respostas vão para uma caixa que o sistema NÃO monitora: respostas de clientes não serão vistas nem viram chamado.']
      : [])
  ]
}))

async function criarLote() {
  criando.value = true
  try {
    const r = await $fetch<any>(api('/api/admin/batches'), {
      method: 'POST',
      body: {
        nome: nomeLote.value,
        templateId: templateId.value,
        assunto: assunto.value,
        // em modo visual o HTML do lote é gerado pelos blocos no servidor
        html: html.value,
        formato: formatoEmail.value,
        blocos: formatoEmail.value === 'blocos' ? blocosEmail.value : null,
        arquivoNome: arquivoNome.value || null,
        arquivoOriginal: arquivoOriginal.value || null,
        intervaloMs: intervaloSegundos.value * 1000,
        contaId: contaId.value || null,
        responderPara: responderPara.value,
        criarTickets: criarTickets.value,
        exigirConfirmacao: exigirConfirmacao.value,
        pedirRecibo: pedirRecibo.value,
        lembrete: lembreteDoEnvio.value,
        agendadoPara: agendadoParaISO.value,
        modoAnexo: modoAnexo.value,
        enviarSemArquivo: porArquivos ? false : enviarSemArquivo.value,
        campos: porArquivos ? camposPagina.value.map(c => ({ tipo: c.tipo, titulo: c.titulo, instrucao: c.instrucao, obrigatorio: c.obrigatorio, config: c.config })) : [],
        // no individual, cada destinatário leva o arquivo dele; no "arquivos
        // por cliente" o arquivo já vem em cada destinatário
        destinatarios: porArquivos ? listaProcessada.value.validos : listaProcessada.value.validos.map(d => {
          const c = modoAnexo.value === 'individual' ? casamento.value.casados[d.email] : undefined
          return c ? { ...d, arquivoNome: c.arquivo.nome, arquivoOriginal: c.arquivo.original } : d
        })
      }
    })
    toast.add({
      title: agendadoParaISO.value
        ? `Lote agendado para ${formatarDataHora(agendadoParaISO.value)}`
        : `Lote criado com ${r.destinatarios} destinatários`,
      description: r.ignoradosSupressao
        ? `${r.ignoradosSupressao} endereço(s) ficaram de fora: já devolveram antes (lista de supressão).`
        : undefined,
      color: 'success'
    })
    confirmando.value = false
    await navigateTo(`/admin/lotes/${r.lote.id}`)
  } catch (e: any) {
    toast.add({ title: 'Erro ao criar o lote', description: e?.statusMessage, color: 'error' })
  } finally {
    criando.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-semibold">{{ porArquivos ? 'Enviar arquivos por cliente' : 'Novo envio' }}</h1>
      <p class="text-sm text-muted">
        {{
          porArquivos
            ? 'Suba o ZIP com um arquivo para cada cliente: o sistema acha o CNPJ, busca o e-mail e cada um recebe o seu, com link e código próprios.'
            : 'Importe a lista, escolha o documento e revise o e-mail antes de disparar.'
        }}
      </p>
    </div>

    <UAlert
      v-if="!porArquivos && passo === 1"
      color="neutral"
      variant="subtle"
      icon="i-lucide-folder-archive"
      title="Tem um arquivo para cada cliente num ZIP?"
      description="Use o envio de arquivos por cliente: o sistema lê o CNPJ de cada arquivo e monta a lista sozinho."
      :actions="[{ label: 'Enviar arquivos por cliente', to: '/admin/lotes/novo?origem=arquivos', icon: 'i-lucide-arrow-right', color: 'neutral', variant: 'outline' }]"
    />

    <!-- Trilha de passos -->
    <div class="flex flex-wrap items-center gap-2">
      <template v-for="(p, i) in PASSOS" :key="p.n">
        <button
          class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition"
          :class="passo === p.n ? 'bg-primary text-inverted' : passo > p.n ? 'text-primary' : 'text-muted'"
          @click="passo > p.n && (passo = p.n)"
        >
          <UIcon :name="passo > p.n ? 'i-lucide-check-circle-2' : p.icone" class="size-4" />
          {{ p.titulo }}
        </button>
        <UIcon v-if="i < PASSOS.length - 1" name="i-lucide-chevron-right" class="size-4 text-muted" />
      </template>
    </div>

    <!-- PASSO 1 (arquivos por cliente) -->
    <UCard v-if="porArquivos" v-show="passo === 1">
      <template #header><h2 class="font-semibold">1. Template e arquivos</h2></template>
      <div class="space-y-5">
        <!-- a) o e-mail que cada cliente recebe -->
        <div class="rounded-lg border border-default p-4">
          <p class="mb-1 text-sm font-semibold">a) Template do e-mail</p>
          <p class="mb-3 text-xs text-muted">
            É o e-mail que cada cliente recebe, com o botão que leva ao arquivo dele. Você pode ajustar o texto no passo 3.
          </p>
          <USelect
            :model-value="templateId ?? undefined"
            :items="opcoesTemplates"
            placeholder="Escolha o template…"
            class="w-full"
            @update:model-value="aplicarTemplate($event as number)"
          />
          <p v-if="templateEscolhido" class="mt-2 text-xs text-muted">
            Assunto: <span class="font-medium text-default">{{ assunto }}</span>
          </p>
          <p v-else-if="!opcoesTemplates.length" class="mt-2 text-xs text-warning">
            Nenhum template cadastrado — crie um em Templates.
          </p>
        </div>

        <p class="text-sm font-semibold">b) Nome do lote e arquivos</p>
        <UFormField
          label="Nome do lote"
          required
          help="É como o envio aparece no relatório e na página do cliente. Ex.: Relatório do Imobilizado — 08/2026."
        >
          <UInput
            v-model="nomeLote"
            placeholder="Ex.: Relatório do Imobilizado — 08/2026"
            class="w-full"
            @update:model-value="nomeEditado = true"
          />
        </UFormField>
        <LoteArquivos
          v-model="linhasArquivos"
          :bloqueado="templateId ? null : 'Escolha o template do e-mail acima para liberar o envio do ZIP.'"
          @primeiro-arquivo="sugerirNomeLote"
        />
      </div>
    </UCard>

    <!-- PASSO 2 (arquivos por cliente): o que o cliente preenche antes de baixar -->
    <UCard v-if="porArquivos" v-show="passo === 2">
      <template #header><h2 class="font-semibold">2. Página de download</h2></template>
      <div class="space-y-5">
        <p class="text-sm text-muted">
          Não é o e-mail: é a página que abre quando o cliente clica no botão do e-mail. Nela ele confirma a leitura e
          baixa o arquivo dele — com abertura, confirmação e download registrados.
        </p>
        <p class="text-sm text-muted">
          Se precisar que ele informe algo antes de baixar, adicione campos abaixo (opcional). Os <b>obrigatórios</b>
          precisam ser preenchidos para liberar o download. Sem campos, a página só pede a confirmação de leitura.
        </p>
        <EditorItensSolic v-model="camposPagina" sem-documento />
        <UAlert v-if="erroCampos" color="error" variant="subtle" icon="i-lucide-circle-alert" :description="erroCampos" />
      </div>
    </UCard>

    <!-- PASSO 1 -->
    <UCard v-if="!porArquivos" v-show="passo === 1">
      <template #header><h2 class="font-semibold">1. Lista de destinatários</h2></template>

      <div class="space-y-5">
        <SeletorDestinatarios
          v-model="carrinho"
          :origens="['arquivo', 'empresa', 'lista', 'banco', 'manual', 'sistema']"
          rotulo="lote"
          extras
          :formatar="d => ({ nome: listaFormatada.get(d.email)?.nome ?? d.nome, empresa: listaFormatada.get(d.email)?.empresa ?? d.empresa })"
          :lista-inicial="listaInicial"
        >
          <template #antes-da-tabela="{ total }">
            <!-- Padronizacao: vale para a lista inteira, e nome e empresa sao independentes -->
            <div v-if="total" class="rounded-lg border border-default bg-elevated/40 p-3">
              <p class="text-sm font-medium">Como escrever os nomes</p>
              <p class="mb-3 text-xs text-muted">
                Cada campo tem a sua escolha, e vale para a lista inteira. O e-mail é sempre gravado em minúsculas.
              </p>

              <div class="grid gap-4 lg:grid-cols-2">
                <div>
                  <p class="mb-2 text-xs font-semibold uppercase text-muted">Nome da pessoa</p>
                  <div class="space-y-2">
                    <button
                      v-for="f in FORMATOS_NOME"
                      :key="f.valor"
                      class="w-full rounded-lg border p-2.5 text-left transition"
                      :class="formatoNome === f.valor ? 'border-primary ring-1 ring-primary' : 'border-default hover:border-primary/40'"
                      @click="formatoNome = f.valor"
                    >
                      <p class="text-sm font-medium">{{ f.titulo }}</p>
                      <p class="truncate text-xs text-muted">{{ exemploNome(f.valor) }}</p>
                    </button>
                  </div>

                  <UCheckbox
                    v-model="abreviar"
                    class="mt-2"
                    label="Abreviar o nome"
                    help="Primeiro nome e último sobrenome por extenso, os do meio viram inicial."
                  />
                </div>

                <div>
                  <p class="mb-2 text-xs font-semibold uppercase text-muted">Empresa</p>
                  <div class="space-y-2">
                    <button
                      v-for="f in FORMATOS_NOME"
                      :key="f.valor"
                      class="w-full rounded-lg border p-2.5 text-left transition"
                      :class="formatoEmpresa === f.valor ? 'border-primary ring-1 ring-primary' : 'border-default hover:border-primary/40'"
                      @click="formatoEmpresa = f.valor"
                    >
                      <p class="text-sm font-medium">{{ f.titulo }}</p>
                      <p class="truncate text-xs text-muted">{{ exemploEmpresa(f.valor) }}</p>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </SeletorDestinatarios>
      </div>
    </UCard>

    <!-- PASSO 2 -->
    <UCard v-if="!porArquivos" v-show="passo === 2">
      <template #header><h2 class="font-semibold">2. Anexo</h2></template>

      <div class="space-y-5">
        <!-- como vai o anexo -->
        <div class="grid gap-3 md:grid-cols-3">
          <button
            v-for="m in MODOS_ANEXO"
            :key="m.valor"
            type="button"
            class="flex items-start gap-3 rounded-lg border p-3 text-left transition"
            :class="modoAnexo === m.valor ? 'border-primary ring-1 ring-primary' : 'border-default hover:border-primary/40'"
            @click="escolherModoAnexo(m.valor)"
          >
            <UIcon :name="m.icone" class="mt-0.5 size-5 shrink-0" :class="modoAnexo === m.valor ? 'text-primary' : 'text-muted'" />
            <span>
              <span class="block text-sm font-medium">{{ m.titulo }}</span>
              <span class="block text-xs text-muted">{{ m.texto }}</span>
            </span>
          </button>
        </div>

        <UAlert
          v-if="modoAnexo !== 'nenhum'"
          color="info"
          variant="subtle"
          icon="i-lucide-info"
          title="O arquivo não vai anexado no e-mail"
          description="Ele fica em área privada e só é entregue pela página com token — é assim que conseguimos registrar quem baixou."
        />

        <AnexoIndividual
          v-if="modoAnexo === 'individual'"
          v-model:arquivos="arquivosIndividuais"
          v-model:manuais="ligacoesManuais"
          v-model:enviar-sem-arquivo="enviarSemArquivo"
          :destinatarios="listaProcessada.validos"
          :casamento="casamento"
        />

        <template v-if="modoAnexo === 'unico'">
        <div class="rounded-lg border border-dashed border-default p-6 text-center">
          <UIcon name="i-lucide-file-up" class="mx-auto size-10 text-muted" />
          <p class="mt-2 text-sm font-medium">Envie o arquivo deste lote</p>
          <p class="text-xs text-muted">{{ FORMATOS_ANEXO }} — até 25 MB.</p>
          <label class="mt-3 inline-block">
            <input type="file" :accept="ACCEPT_ANEXO" class="hidden" @change="subirAnexo" >
            <span class="inline-flex cursor-pointer items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-inverted">
              <UIcon :name="enviandoArquivo ? 'i-lucide-loader-circle' : 'i-lucide-upload'" :class="enviandoArquivo && 'animate-spin'" />
              {{ enviandoArquivo ? 'Enviando...' : 'Escolher arquivo' }}
            </span>
          </label>
        </div>

        <template v-if="arquivos?.arquivos.length">
          <USeparator label="ou reutilize um arquivo já enviado" />
          <div class="grid gap-2">
            <button
              v-for="a in arquivos.arquivos"
              :key="a.nome"
              class="flex items-center gap-3 rounded-lg border p-3 text-left transition"
              :class="arquivoNome === a.nome ? 'border-primary ring-1 ring-primary' : 'border-default hover:border-primary/40'"
              @click="escolherExistente(a)"
            >
              <UIcon :name="iconeDoArquivo(a.nome)" class="size-6 shrink-0 text-muted" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium">{{ a.nome }}</p>
                <p class="text-xs text-muted">{{ tamanho(a.tamanho) }}</p>
              </div>
              <UIcon v-if="arquivoNome === a.nome" name="i-lucide-check-circle-2" class="size-5 text-primary" />
            </button>
          </div>
        </template>

        <UAlert
          v-if="!arquivoNome"
          color="warning"
          variant="subtle"
          icon="i-lucide-file-question"
          title="Escolha o arquivo"
          description="Envie um arquivo ou reutilize um já enviado. Para mandar só um aviso, escolha “Sem anexo”."
        />
        <div
          v-else
          class="flex items-center gap-3 rounded-lg border border-primary bg-elevated/50 p-3"
        >
          <UIcon :name="iconeDoArquivo(arquivoOriginal)" class="size-6 shrink-0 text-primary" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">{{ arquivoOriginal }}</p>
            <p class="text-xs text-muted">Anexo deste envio</p>
          </div>
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            label="Remover"
            @click="removerAnexo"
          />
        </div>
        </template>

        <UAlert
          v-if="modoAnexo === 'nenhum'"
          color="neutral"
          variant="subtle"
          icon="i-lucide-megaphone"
          title="Envio sem anexo (comunicado)"
          description="A página registra a ciência do destinatário, e o e-mail não precisa do botão de acesso — mas ele é recomendado: o “Confirmar recebimento” é a prova de que o cliente recebeu."
        />
      </div>
    </UCard>

    <!-- PASSO 3 -->
    <UCard v-show="passo === 3">
      <template #header>
        <h2 class="font-semibold">{{ porArquivos ? '3. Revisar o e-mail (template)' : '3. Conteúdo do e-mail' }}</h2>
      </template>

      <div class="space-y-4">
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Partir de um template">
            <USelect
              :model-value="templateId ?? undefined"
              :items="opcoesTemplates"
              class="w-full"
              @update:model-value="aplicarTemplate($event as number)"
            />
          </UFormField>
          <UFormField label="Assunto" help="O texto editado aqui vale só para este lote.">
            <UInput v-model="assunto" class="w-full" />
          </UFormField>
        </div>

        <EditorEmail
          v-model:formato="formatoEmail"
          v-model:blocos="blocosEmail"
          v-model:html="html"
          :assunto="assunto"
          :arquivos="arquivosBrand"
          :exige-botao="!!arquivoNome || porArquivos"
          @imagem-enviada="recarregarImagens"
        />
      </div>
    </UCard>

    <!-- PASSO 4 -->
    <UCard v-show="passo === 4">
      <template #header><h2 class="font-semibold">4. Revisão e disparo</h2></template>

      <div class="space-y-5">
        <AvisoDominios
          :emails="emailsDaLista"
          @corrigir="corrigirDominio"
          @remover="removerEmails"
          @problemas="n => (dominiosSemEmail = n)"
        />

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Nome do lote" help="Para você identificar no relatório." :required="porArquivos">
            <UInput v-model="nomeLote" class="w-full" @update:model-value="nomeEditado = true" />
          </UFormField>
          <UFormField label="Intervalo entre os envios" help="Intervalos maiores reduzem o risco de cair em spam.">
            <USelect v-model="intervaloSegundos" :items="OPCOES_INTERVALO" class="w-full" />
          </UFormField>
        </div>

        <!-- De qual canal sai o e-mail -->
        <UFormField
          label="Sai por (canal de saída)"
          :help="contaEscolhida
            ? `Os e-mails sairão de ${contaEscolhida.remetente}.`
            : 'Nenhum canal cadastrado: será usada a configuração do .env.'"
        >
          <div class="flex flex-wrap items-center gap-2">
            <USelect
              v-if="itensConta.length"
              v-model="contaId"
              :items="itensConta"
              class="min-w-64"
            />
            <UButton
              v-if="eAdmin"
              to="/admin/configuracoes"
              :label="itensConta.length ? 'Gerenciar canais' : 'Cadastrar um canal'"
              icon="i-lucide-settings"
              color="neutral"
              variant="outline"
              size="xs"
            />
          </div>
        </UFormField>

        <!-- Para onde vão as respostas: pode ser outro endereço que não o da saída -->
        <div class="grid gap-3 sm:grid-cols-2">
          <UFormField
            label="Respostas para"
            help="Quando o cliente clicar em Responder, a mensagem vai para este endereço."
          >
            <USelect v-model="respostaModo" :items="itensResposta" class="w-full" />
          </UFormField>
          <UFormField
            v-if="respostaModo === OUTRO"
            label="Endereço de resposta"
            :error="respostaOutro && respostaInvalida ? 'E-mail inválido' : undefined"
          >
            <UInput v-model="respostaOutro" type="email" placeholder="setor@contabilgaulke.com.br" class="w-full" />
          </UFormField>
        </div>

        <div class="space-y-3">
          <UCheckbox
            v-model="criarTickets"
            label="Abrir chamado no painel quando o cliente responder ou não confirmar a leitura"
            :help="`O chamado sai em seu nome.${contaEscolhida?.criarTickets ? ` Após ${contaEscolhida.diasSemConfirmacao} dia(s) sem confirmação, abre um chamado com quem falta.` : ''}`"
          />
          <UAlert
            v-if="criarTickets && caixaNaoMonitorada"
            color="warning"
            variant="subtle"
            icon="i-lucide-inbox"
            description="As respostas vão para uma caixa que o sistema não monitora: respostas de clientes não serão vistas nem viram chamado. Escolha em “Respostas para” uma caixa de canal com monitoramento ligado."
          />
          <UCheckbox
            v-model="exigirConfirmacao"
            label="Exigir confirmação de leitura antes de liberar o download"
            help="Recomendado: garante a prova de ciência antes da entrega do arquivo."
          />
          <UCheckbox
            v-model="pedirRecibo"
            label="Pedir confirmação de leitura ao cliente de e-mail do destinatário"
            help="A maioria dos clientes ignora o pedido, e os que respeitam mostram um aviso que a pessoa pode recusar. Use só quando o atrito valer a pena."
          />
          <div class="rounded-lg border border-default p-3">
            <UCheckbox
              v-model="lembreteLigado"
              :disabled="!temBotaoDeAcesso"
              label="Lembrar automaticamente quem não confirmar"
              :help="temBotaoDeAcesso
                ? 'O mesmo e-mail sai de novo, com “Lembrete:” no assunto e o mesmo link. Só em dia útil, das 8h às 18h.'
                : 'O e-mail está sem o botão de acesso: sem ele não há como confirmar, então não há o que lembrar.'"
            />
            <div v-if="lembreteLigado && temBotaoDeAcesso" class="mt-3 flex flex-wrap items-center gap-2 pl-6 text-sm">
              <span class="text-muted">A cada</span>
              <UInput v-model.number="lembreteDias" type="number" min="1" max="30" class="w-16" />
              <span class="text-muted">dia(s), no máximo</span>
              <UInput v-model.number="lembreteMax" type="number" min="1" max="5" class="w-14" />
              <span class="text-muted">lembrete(s) por pessoa.</span>
            </div>
          </div>
        </div>

        <div class="grid gap-3 sm:grid-cols-4">
          <div class="rounded-lg border border-default p-3">
            <p class="text-xs text-muted">Destinatários</p>
            <p class="text-xl font-semibold">{{ listaProcessada.validos.length }}</p>
          </div>
          <div class="rounded-lg border border-default p-3">
            <p class="text-xs text-muted">Intervalo</p>
            <p class="text-xl font-semibold">{{ intervaloSegundos }}s</p>
          </div>
          <div class="rounded-lg border border-default p-3">
            <p class="text-xs text-muted">Duração estimada</p>
            <p class="text-xl font-semibold">{{ tempoEstimado }}</p>
          </div>
          <div class="rounded-lg border border-default p-3">
            <p class="text-xs text-muted">Documento</p>
            <p class="truncate text-sm font-medium">
              {{ porArquivos ? `${new Set(destinatariosArquivos.map(d => d.arquivoNome)).size} arquivo(s), um por cliente` : arquivoOriginal || 'nenhum' }}
            </p>
          </div>
        </div>

        <p class="text-xs text-muted">
          Formatação gravada: <span class="font-medium text-default">{{ rotuloFormatoNome }}</span>.
        </p>

        <USeparator />

        <!-- Quando disparar -->
        <div class="space-y-3">
          <p class="text-sm font-medium">Quando disparar</p>

          <div class="grid gap-3 sm:grid-cols-2">
            <button
              class="flex items-start gap-3 rounded-lg border p-3 text-left transition"
              :class="quandoDisparar === 'depois' ? 'border-primary ring-1 ring-primary' : 'border-default hover:border-primary/40'"
              @click="quandoDisparar = 'depois'"
            >
              <UIcon name="i-lucide-hand" class="mt-0.5 size-5 shrink-0" :class="quandoDisparar === 'depois' ? 'text-primary' : 'text-muted'" />
              <div>
                <p class="text-sm font-medium">Deixar como rascunho</p>
                <p class="text-xs text-muted">Você inicia o disparo na tela seguinte, quando quiser.</p>
              </div>
            </button>

            <button
              class="flex items-start gap-3 rounded-lg border p-3 text-left transition"
              :class="quandoDisparar === 'agendar' ? 'border-primary ring-1 ring-primary' : 'border-default hover:border-primary/40'"
              @click="quandoDisparar = 'agendar'"
            >
              <UIcon name="i-lucide-calendar-clock" class="mt-0.5 size-5 shrink-0" :class="quandoDisparar === 'agendar' ? 'text-primary' : 'text-muted'" />
              <div>
                <p class="text-sm font-medium">Agendar</p>
                <p class="text-xs text-muted">O sistema dispara sozinho na data e hora marcadas.</p>
              </div>
            </button>
          </div>

          <template v-if="quandoDisparar === 'agendar'">
            <UFormField label="Data e hora" help="Horário de Brasília (São Paulo).">
              <UInput v-model="dataAgendada" type="datetime-local" class="w-full sm:w-72" />
            </UFormField>

            <UAlert
              v-if="!agendamentoValido"
              color="warning"
              variant="subtle"
              icon="i-lucide-triangle-alert"
              title="Escolha uma data futura"
              description="O horário informado já passou."
            />
            <UAlert
              v-else
              color="info"
              variant="subtle"
              icon="i-lucide-calendar-check"
              :title="`Disparo em ${formatarDataHora(agendadoParaISO)} (horário de Brasília)`"
              description="Se o sistema estiver fora do ar na hora marcada, ele dispara ao voltar — desde que o atraso seja pequeno. Passando disso, o lote fica pausado esperando você confirmar."
            />
          </template>
        </div>

        <UAlert
          v-if="quandoDisparar === 'depois'"
          color="neutral"
          variant="subtle"
          icon="i-lucide-shield-check"
          title="O lote será criado como rascunho"
          description="Nada é enviado agora. Na tela seguinte você inicia o disparo e acompanha em tempo real."
        />
      </div>
    </UCard>

    <!-- Navegação -->
    <div class="flex items-center justify-between gap-3">
      <UButton
        label="Voltar"
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="outline"
        :disabled="passo === 1"
        @click="passo--"
      />
      <UButton
        v-if="passo < 4"
        label="Continuar"
        trailing-icon="i-lucide-arrow-right"
        :disabled="!podeAvancar"
        @click="passo++"
      />
      <UButton
        v-else
        :label="quandoDisparar === 'agendar' ? 'Agendar lote' : 'Criar lote'"
        :icon="quandoDisparar === 'agendar' ? 'i-lucide-calendar-clock' : 'i-lucide-rocket'"
        :loading="criando"
        :disabled="!listaProcessada.validos.length || !agendamentoValido || respostaInvalida || (porArquivos && !nomeLote.trim())"
        @click="confirmando = true"
      />
    </div>

    <ModalConfirmarEnvio v-model:open="confirmando" :resumo="resumoEnvio" :carregando="criando" @confirmar="criarLote" />
  </div>
</template>
