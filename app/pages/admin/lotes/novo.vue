<script setup lang="ts">
import {
  TIPOS_ANEXO,
  acceptDe,
  familiasDe,
  iconeDoArquivo as iconePorExtensao
} from '~~/shared/types/tipos-arquivo'
import { tamanho, duracao } from '~/utils/formato'
import {
  FORMATOS_NOME,
  AMOSTRA_NOME,
  AMOSTRA_EMPRESA,
  abreviarNome,
  formatarNome,
  formatarDestinatario,
  type FormatoNome
} from '~/utils/nomes'

definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: 'Novo envio — Gaulke Comunica' })

const toast = useToast()
// canais de saida sao geridos so por admin; os demais apenas escolhem
const { eAdmin } = usePapel()
const passo = ref(1)
const PASSOS = [
  { n: 1, titulo: 'Lista', icone: 'i-lucide-users' },
  { n: 2, titulo: 'Arquivo', icone: 'i-lucide-file-text' },
  { n: 3, titulo: 'E-mail', icone: 'i-lucide-mail' },
  { n: 4, titulo: 'Revisão', icone: 'i-lucide-rocket' }
]

/* ---------- Passo 1: lista ---------- */
type Origem = 'arquivo' | 'lista' | 'banco' | 'manual' | 'sistema'
const origem = ref<Origem>('arquivo')

const ORIGENS = [
  { valor: 'arquivo' as Origem, titulo: 'Importar arquivo', icone: 'i-lucide-file-spreadsheet', desc: 'CSV ou XLSX' },
  { valor: 'lista' as Origem, titulo: 'Lista salva', icone: 'i-lucide-list', desc: 'listas de contatos' },
  { valor: 'banco' as Origem, titulo: 'Do banco', icone: 'i-lucide-database', desc: 'quem já recebeu antes' },
  { valor: 'manual' as Origem, titulo: 'Digitar', icone: 'i-lucide-keyboard', desc: 'colar ou digitar' },
  { valor: 'sistema' as Origem, titulo: 'Do sistema', icone: 'i-lucide-users-round', desc: 'equipe e clientes' }
]

// o modelo mostrado na tela e o do download saem da MESMA fonte no servidor
const COLUNAS_MODELO = ['Nome', 'E-mail', 'Empresa']
const LINHAS_MODELO = [
  ['Maria Oliveira', 'maria.oliveira@empresa.com.br', 'Empresa Exemplo LTDA'],
  ['Joao Souza', 'joao.souza@outraempresa.com.br', 'Outra Empresa ME'],
  ['', 'contato@terceiraempresa.com.br', 'Terceira Empresa SA']
]

/**
 * O USelect (Reka UI) reserva a string vazia para "sem selecao", entao a
 * opcao "nenhuma coluna" precisa de um valor proprio.
 */
const SEM_COLUNA = '__sem_coluna__'

const importando = ref(false)
const importado = ref<any>(null)

/**
 * Erro da ULTIMA leitura de arquivo. Fica na tela ate a proxima tentativa —
 * um toast some antes de a pessoa conseguir ler o que precisa corrigir.
 */
const erroImportacao = ref<{ arquivo: string; motivo: string; dica: string } | null>(null)

/** Traduz a falha em algo acionavel: o que houve e o que fazer com o arquivo. */
function dicaDoErro(mensagem: string, arquivo: string) {
  const m = (mensagem || '').toLowerCase()
  if (m.includes('10 mb') || m.includes('maior')) {
    return 'O limite é 10 MB por arquivo. Apague colunas e abas que não serão usadas, ou divida a lista em partes e importe uma de cada vez — elas somam no mesmo lote.'
  }
  if (m.includes('csv ou xlsx')) {
    return `"${arquivo}" não é um formato que o leitor entende. Abra no Excel ou no Google Planilhas e salve como CSV ou XLSX.`
  }
  if (m.includes('limite de')) {
    return 'Divida a planilha em arquivos menores e importe um de cada vez — cada importação soma no mesmo lote.'
  }
  if (m.includes('vazia') || m.includes('colunas')) {
    return 'O arquivo foi lido mas nenhuma coluna foi encontrada. Confira se a PRIMEIRA linha da primeira aba tem os nomes das colunas (Nome, E-mail, Empresa) e se não há linhas em branco antes dela.'
  }
  return 'Confira se o arquivo abre normalmente no Excel e se a primeira linha tem os nomes das colunas. Se ele veio de outro sistema, tente salvar de novo como CSV.'
}
const mapa = reactive({ email: SEM_COLUNA, nome: SEM_COLUNA, empresa: SEM_COLUNA, documento: SEM_COLUNA })
const colunasExtras = ref<string[]>([])

async function importar(e: Event) {
  const input = e.target as HTMLInputElement
  const arquivo = input.files?.[0]
  if (!arquivo) return
  importando.value = true
  try {
    const fd = new FormData()
    fd.append('arquivo', arquivo)
    const r = await $fetch<RespostaImportacao>(api('/api/admin/importar'), { method: 'POST', body: fd })
    importado.value = r
    mapa.email = r.sugestao.email || SEM_COLUNA
    mapa.nome = r.sugestao.nome || SEM_COLUNA
    mapa.empresa = r.sugestao.empresa || SEM_COLUNA
    mapa.documento = r.sugestao.documento || SEM_COLUNA
    colunasExtras.value = []
    erroImportacao.value = null
    toast.add({ title: `${r.total} linha(s) lidas de ${r.arquivo}`, color: 'success' })
  } catch (err: any) {
    const corpo = err?.data
    const motivo =
      err?.statusMessage || corpo?.statusMessage || corpo?.message || err?.message || 'Erro desconhecido ao ler o arquivo'
    // o servidor manda dica e id quando a falha foi inesperada (500)
    const detalhe = corpo?.data
    erroImportacao.value = {
      arquivo: arquivo.name,
      motivo: `${err?.statusCode ? `HTTP ${err.statusCode} — ` : ''}${motivo}`,
      dica: detalhe?.dica
        ? `${detalhe.dica} (id do erro: ${detalhe.id} — procure por ele no log do servidor)`
        : dicaDoErro(motivo, arquivo.name)
    }
    importado.value = null
    toast.add({ title: 'Falha ao ler o arquivo', description: motivo, color: 'error' })
  } finally {
    importando.value = false
    input.value = ''
  }
}

const opcoesColunas = computed(() =>
  [
    { label: '— nenhuma —', value: SEM_COLUNA },
    ...(importado.value?.colunas || []).map((c: string) => ({ label: c, value: c }))
  ]
)

/* ---------- Passo 1b: contatos que já estão no banco ---------- */
const CONTATOS_MARCOS = [
  { label: 'Todos os contatos', value: 'todos' },
  { label: 'Não confirmaram a leitura', value: 'nao-confirmou' },
  { label: 'Não acessaram a página', value: 'nao-acessou' },
  { label: 'Não baixaram o arquivo', value: 'nao-baixou' },
  { label: 'Confirmaram a leitura', value: 'confirmou' },
  { label: 'Tiveram erro no envio', value: 'erro' }
]

const filtroContatos = reactive({ busca: '', marco: 'todos', batchId: 0 })

/**
 * A seleção guarda o CONTATO INTEIRO, indexado por e-mail — e não só os
 * e-mails visíveis na tela. Se guardasse apenas os e-mails, trocar o filtro
 * removeria da lista quem já tinha sido marcado, e a pessoa sairia do envio
 * sem ninguém perceber.
 */
const escolhidos = ref<Record<string, { email: string; nome: string; empresa: string; documento: string }>>({})
const selecionados = computed(() => Object.keys(escolhidos.value))

function alternarContato(c: Contato) {
  if (escolhidos.value[c.email]) {
    const { [c.email]: _removido, ...resto } = escolhidos.value
    escolhidos.value = resto
    return
  }
  escolhidos.value = {
    ...escolhidos.value,
    [c.email]: { email: c.email, nome: c.nome || '', empresa: c.empresa || '', documento: c.documento || '' }
  }
}

const consultaContatos = computed(() => ({
  busca: filtroContatos.busca || undefined,
  marco: filtroContatos.marco === 'todos' ? undefined : filtroContatos.marco,
  batchId: filtroContatos.batchId || undefined
}))

const { data: contatosData, status: carregandoContatos } = await useFetch<RespostaContatos>(
  api('/api/admin/contatos'),
  { query: consultaContatos, watch: [consultaContatos], lazy: true, server: false }
)

const contatos = computed(() => contatosData.value?.contatos || [])

// "todos" se refere ao que está VISÍVEL agora, não ao banco inteiro
const todosMarcados = computed(
  () => contatos.value.length > 0 && contatos.value.every(c => !!escolhidos.value[c.email])
)

function alternarTodos() {
  if (todosMarcados.value) {
    const resto = { ...escolhidos.value }
    for (const c of contatos.value) delete resto[c.email]
    escolhidos.value = resto
    return
  }
  const adicionados = { ...escolhidos.value }
  for (const c of contatos.value) {
    adicionados[c.email] = { email: c.email, nome: c.nome || '', empresa: c.empresa || '', documento: c.documento || '' }
  }
  escolhidos.value = adicionados
}

// lotes anteriores, só para filtrar a origem dos contatos.
// Lista enxuta: a principal é paginada e cortaria os lotes antigos do combo.
const { data: lotesData } = await useFetch<RespostaLotesOpcoes>(api('/api/admin/batches/opcoes'), {
  lazy: true,
  server: false
})

const opcoesLotesOrigem = computed(() => [
  { label: 'Qualquer lote', value: 0 },
  ...(lotesData.value?.lotes || []).map(l => ({ label: l.nome, value: l.id }))
])

/* ---------- Passo 1c: digitação manual ---------- */
const textoManual = ref('')

/**
 * Aceita os formatos que a pessoa naturalmente digita ou cola:
 *   email@x.com | Nome <email@x.com> | Nome; email@x.com; Empresa
 * A validação e a deduplicação acontecem depois, no mesmo caminho da planilha.
 */
function lerListaDigitada(texto: string) {
  const saida: { nome: string; email: string; empresa: string; extras: Record<string, string>; linha: number }[] = []

  // \n sem +: a numeracao precisa acompanhar o que a pessoa ve no campo
  texto.split(/\r?\n/).forEach((linha, i) => {
    const bruta = linha.trim()
    const numero = i + 1
    if (!bruta || bruta.startsWith('#')) return

    const comAngulo = bruta.match(/^(.*?)<([^>]+)>\s*$/)
    if (comAngulo) {
      saida.push({
        nome: comAngulo[1]!.trim().replace(/^["']|["']$/g, ''),
        email: comAngulo[2]!.trim(),
        empresa: '',
        extras: {},
        linha: numero
      })
      return
    }

    const partes = bruta.split(/[;,\t]/).map(p => p.trim())
    if (partes.length > 1) {
      const idx = partes.findIndex(p => p.includes('@'))
      const email = idx >= 0 ? partes[idx]! : partes[1]!
      const resto = partes.filter((_, i) => i !== (idx >= 0 ? idx : 1))
      saida.push({ nome: resto[0] || '', email, empresa: resto[1] || '', extras: {}, linha: numero })
      return
    }

    saida.push({ nome: '', email: bruta, empresa: '', extras: {}, linha: numero })
  })

  return saida
}

/* ---------- Passo 1d: pessoas do sistema da empresa ---------- */
const buscaPessoas = ref('')
const origemPessoas = ref<'todas' | 'equipe' | 'cliente'>('todas')

const consultaPessoas = computed(() => ({
  busca: buscaPessoas.value || undefined,
  origem: origemPessoas.value
}))

const { data: pessoasData, status: carregandoPessoas } = await useFetch<RespostaPessoas>(
  api('/api/admin/pessoas'),
  { query: consultaPessoas, watch: [consultaPessoas], lazy: true, server: false }
)

const pessoas = computed(() => pessoasData.value?.pessoas || [])

const ORIGENS_PESSOA = [
  { label: 'Equipe e clientes', value: 'todas' },
  { label: 'Somente equipe', value: 'equipe' },
  { label: 'Somente clientes', value: 'cliente' }
]

/* ---------- O carrinho: todas as origens somam no mesmo lote ---------- */
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

type Item = {
  email: string
  nome: string
  empresa: string
  /** CPF/CNPJ: casa o arquivo individual com a pessoa */
  documento: string
  origem: string
  extras: Record<string, string>
}

/**
 * Indexado por e-mail em minúsculas: a deduplicação acontece por construção,
 * não por uma checagem que alguém pode esquecer de rodar. Duas origens
 * diferentes trazendo a mesma pessoa resultam em UM destinatário.
 */
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
  validos: Object.values(carrinho.value).map(d =>
    formatarDestinatario(d, {
      nome: formatoNome.value,
      empresa: formatoEmpresa.value,
      abreviarNome: abreviar.value
    })
  ),
  rejeitados: [] as { linha: number; email: string; motivo: string }[]
}))

const totalCarrinho = computed(() => Object.keys(carrinho.value).length)

/**
 * Resultado da ultima inclusao. Guardamos a linha REJEITADA inteira, e nao so
 * uma contagem: quem monta a lista precisa saber qual registro ficou de fora e
 * por que, para conseguir corrigir a planilha — um "3 nao entraram" nao diz
 * onde olhar.
 */
type Rejeitada = {
  linha: number | null
  valor: string
  nome: string
  motivo: string
  detalhe: string
}

const ultimaInclusao = ref<{
  origem: string
  lidas: number
  adicionados: number
  rejeitadas: Rejeitada[]
} | null>(null)

/** Agrupa as rejeicoes por motivo, para o resumo de uma linha. */
const resumoRejeicoes = computed(() => {
  const r = ultimaInclusao.value
  if (!r) return [] as { motivo: string; total: number }[]
  const contas = new Map<string, number>()
  for (const x of r.rejeitadas) contas.set(x.motivo, (contas.get(x.motivo) || 0) + 1)
  return [...contas].map(([motivo, total]) => ({ motivo, total })).sort((a, b) => b.total - a.total)
})

const verTodasRejeicoes = ref(false)
const LIMITE_REJEICOES = 8

const rejeicoesVisiveis = computed(() => {
  const todas = ultimaInclusao.value?.rejeitadas || []
  return verTodasRejeicoes.value ? todas : todas.slice(0, LIMITE_REJEICOES)
})

type LinhaEntrada = {
  email: string
  nome?: string
  empresa?: string
  documento?: string | null
  extras?: Record<string, string>
  /** numero da linha na planilha ou no texto colado, quando a origem sabe */
  linha?: number
}

function adicionar(linhas: LinhaEntrada[], origem: string) {
  const novos = { ...carrinho.value }
  const rejeitadas: Rejeitada[] = []
  // separa "ja estava no lote" de "repetido dentro do proprio arquivo": sao
  // problemas diferentes e se corrigem em lugares diferentes
  const nesteLote = new Set(Object.keys(carrinho.value))
  const nestaImportacao = new Set<string>()
  let adicionados = 0

  linhas.forEach((l, i) => {
    const numero = l.linha ?? null
    const bruto = String(l.email || '').trim()
    const email = bruto.toLowerCase()
    const rotulo = [l.nome, l.empresa].filter(Boolean).join(' · ')

    const recusar = (motivo: string, detalhe: string) =>
      rejeitadas.push({ linha: numero, valor: bruto, nome: rotulo, motivo, detalhe })

    if (!email) {
      return recusar(
        'Sem e-mail',
        rotulo
          ? `A linha tem dados (${rotulo}) mas a coluna de e-mail está vazia — sem endereço não há para onde enviar.`
          : 'A linha está sem endereço de e-mail. Confira se a coluna de e-mail foi apontada corretamente.'
      )
    }
    if (!RE_EMAIL.test(email)) {
      const dica = !bruto.includes('@')
        ? 'falta o @ — pode ser que a coluna apontada não seja a do e-mail'
        : bruto.includes(' ')
          ? 'há espaço no meio do endereço'
          : !/\.[^\s@]{2,}$/.test(bruto)
            ? 'falta o domínio depois do ponto final (.com, .com.br)'
            : 'o endereço não está num formato válido'
      return recusar('E-mail inválido', `"${bruto}" — ${dica}.`)
    }
    if (nestaImportacao.has(email)) {
      return recusar('Repetido na origem', `"${email}" aparece mais de uma vez nesta mesma ${origem === 'arquivo' ? 'planilha' : 'inclusão'} — só a primeira ocorrência entrou.`)
    }
    if (nesteLote.has(email)) {
      const jaTem = carrinho.value[email]
      return recusar('Já estava no lote', `"${email}" já tinha entrado pela origem "${jaTem?.origem}" — cada pessoa recebe uma vez só.`)
    }

    nestaImportacao.add(email)
    novos[email] = {
      email,
      nome: l.nome || '',
      empresa: l.empresa || '',
      documento: l.documento || '',
      origem,
      extras: l.extras || {}
    }
    adicionados++
  })

  carrinho.value = novos
  ultimaInclusao.value = { origem, lidas: linhas.length, adicionados, rejeitadas }
  verTodasRejeicoes.value = false

  toast.add({
    title: adicionados
      ? `${adicionados} destinatário(s) acrescentado(s)`
      : 'Nada foi acrescentado',
    description: rejeitadas.length
      ? `${rejeitadas.length} de ${linhas.length} ficaram de fora — o motivo de cada uma está listado abaixo.`
      : undefined,
    color: adicionados ? (rejeitadas.length ? 'warning' : 'success') : 'error'
  })
}

function removerDoCarrinho(email: string) {
  const { [email]: _fora, ...resto } = carrinho.value
  carrinho.value = resto
}

function limparCarrinho() {
  if (!confirm(`Remover os ${totalCarrinho.value} destinatários do lote?`)) return
  carrinho.value = {}
  ultimaInclusao.value = null
}

/* ---------- cada origem monta suas linhas e chama adicionar() ---------- */

function adicionarDoArquivo() {
  if (!importado.value || mapa.email === SEM_COLUNA) return
  const linhas = importado.value.linhas.map((l: any, i: number) => {
    const extras: Record<string, string> = {}
    for (const c of colunasExtras.value) if (l[c]) extras[c] = String(l[c])
    return {
      // +2: a planilha comeca na linha 1 com o cabecalho
      linha: i + 2,
      email: String(l[mapa.email] || ''),
      nome: mapa.nome === SEM_COLUNA ? '' : String(l[mapa.nome] || ''),
      empresa: mapa.empresa === SEM_COLUNA ? '' : String(l[mapa.empresa] || ''),
      documento: mapa.documento === SEM_COLUNA ? '' : String(l[mapa.documento] || ''),
      extras
    }
  })
  adicionar(linhas, 'arquivo')
}

function adicionarDoBanco() {
  adicionar(Object.values(escolhidos.value), 'envio anterior')
}

function adicionarDigitados() {
  adicionar(lerListaDigitada(textoManual.value), 'digitado')
  textoManual.value = ''
}

function adicionarPessoa(p: Pessoa) {
  adicionar([{ email: p.email, nome: p.nome, empresa: p.detalhe || '', documento: p.documento }],
    p.origem === 'equipe' ? 'equipe' : 'cliente')
}

function adicionarTodasPessoas() {
  adicionar(
    pessoas.value.map(p => ({ email: p.email, nome: p.nome, empresa: p.detalhe || '', documento: p.documento })),
    'sistema'
  )
}

/* ---------- origem: lista salva ---------- */
const route = useRoute()
const { data: listasSalvas, execute: carregarListas } = await useFetch<ResumoLista[]>(api('/api/admin/listas'), {
  default: () => [],
  immediate: false,
  server: false
})
watch(origem, o => { if (o === 'lista' && !listasSalvas.value.length) carregarListas() })
const listaEscolhida = ref<number | undefined>(undefined)
const carregandoLista = ref(false)
async function adicionarDaLista(idLista = listaEscolhida.value) {
  if (!idLista) return
  carregandoLista.value = true
  try {
    const l = await $fetch<DetalheLista>(api(`/api/admin/listas/${idLista}`))
    adicionar(
      l.membros.map(m => ({ email: m.email, nome: m.nome ?? '', empresa: m.empresa ?? '', documento: m.documento, extras: m.extras ?? {} })),
      `lista: ${l.nome}`
    )
  } catch (e: any) {
    toast.add({ title: 'Não foi possível abrir a lista', description: e?.data?.statusMessage || e?.statusMessage, color: 'error' })
  } finally {
    carregandoLista.value = false
  }
}
// "Usar num envio", da tela da lista: /admin/lotes/novo?lista=12
onMounted(() => {
  const q = Number(route.query.lista)
  if (!q) return
  origem.value = 'lista'
  listaEscolhida.value = q
  adicionarDaLista(q)
})

/* salvar o que foi montado aqui como lista, para a proxima vez */
const modalSalvarLista = ref(false)
const novaLista = reactive({ nome: '', descricao: '' })
const salvandoLista = ref(false)
async function salvarComoLista() {
  salvandoLista.value = true
  try {
    const r = await $fetch<{ id: number; adicionados: number }>(api('/api/admin/listas'), {
      method: 'POST',
      body: {
        nome: novaLista.nome,
        descricao: novaLista.descricao || null,
        membros: Object.values(carrinho.value).map(i => ({
          email: i.email,
          nome: i.nome || null,
          empresa: i.empresa || null,
          documento: i.documento || null,
          extras: i.extras
        }))
      }
    })
    toast.add({ title: `Lista "${novaLista.nome}" salva com ${r.adicionados} contato(s)`, color: 'success' })
    modalSalvarLista.value = false
    novaLista.nome = ''
    novaLista.descricao = ''
  } catch (e: any) {
    toast.add({ title: 'Não foi possível salvar a lista', description: e?.data?.statusMessage || e?.statusMessage, color: 'error' })
  } finally {
    salvandoLista.value = false
  }
}

const CORES_ORIGEM: Record<string, string> = {
  arquivo: 'neutral',
  'envio anterior': 'info',
  digitado: 'neutral',
  equipe: 'primary',
  cliente: 'success',
  sistema: 'primary'
}

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
const modoAnexo = ref<ModoAnexo>('nenhum')
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
if (templatesData.value?.templates.length) aplicarTemplate(templatesData.value.templates[0]!.id)

const opcoesTemplates = computed(() =>
  (templatesData.value?.templates || []).map(t => ({
    label: `${t.nome}${t.categoria ? ` · ${t.categoria}` : ''}${t.tipo === 'comunicado' ? ' (comunicado)' : ''}`,
    value: t.id
  }))
)

/* ---------- Passo 4: revisão ---------- */
const nomeLote = ref(`Envio ${formatarData(new Date())}`)
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
  if (passo.value === 1) return totalCarrinho.value > 0
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
  anexo:
    modoAnexo.value === 'individual'
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
        enviarSemArquivo: enviarSemArquivo.value,
        // no individual, cada destinatário leva o arquivo dele
        destinatarios: listaProcessada.value.validos.map(d => {
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
      <h1 class="text-2xl font-semibold">Novo envio</h1>
      <p class="text-sm text-muted">Importe a lista, escolha o documento e revise o e-mail antes de disparar.</p>
    </div>

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

    <!-- PASSO 1 -->
    <UCard v-show="passo === 1">
      <template #header><h2 class="font-semibold">1. Lista de destinatários</h2></template>

      <div class="space-y-5">
        <!-- Escolha da origem -->
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <button
            v-for="o in ORIGENS"
            :key="o.valor"
            class="flex items-center gap-3 rounded-lg border p-3 text-left transition"
            :class="origem === o.valor ? 'border-primary ring-1 ring-primary' : 'border-default hover:border-primary/40'"
            @click="origem = o.valor"
          >
            <UIcon :name="o.icone" class="size-6 shrink-0" :class="origem === o.valor ? 'text-primary' : 'text-muted'" />
            <div class="min-w-0">
              <p class="text-sm font-medium">{{ o.titulo }}</p>
              <p class="truncate text-xs text-muted">{{ o.desc }}</p>
            </div>
          </button>
        </div>

        <!-- ORIGEM: ARQUIVO -->
        <template v-if="origem === 'arquivo'">
          <!-- Formato esperado: documentado na tela, não só no README -->
          <div class="rounded-lg border border-default bg-elevated/40 p-4">
            <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p class="text-sm font-medium">Como o arquivo deve estar</p>
              <UButton
                :to="api('/api/admin/modelo-lista')"
                external
                icon="i-lucide-download"
                label="Baixar modelo CSV"
                size="xs"
                color="neutral"
                variant="outline"
              />
            </div>

            <div class="overflow-x-auto rounded border border-default bg-default">
              <table class="w-full text-xs">
                <thead class="bg-elevated/60 text-left">
                  <tr>
                    <th v-for="c in COLUNAS_MODELO" :key="c" class="border-r border-default px-3 py-2 font-semibold last:border-0">
                      {{ c }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(l, i) in LINHAS_MODELO" :key="i" class="border-t border-default">
                    <td v-for="(v, j) in l" :key="j" class="border-r border-default px-3 py-1.5 last:border-0">
                      {{ v || '—' }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <ul class="mt-3 space-y-1 text-xs text-muted">
              <li>· <strong>E-mail</strong> é a única coluna obrigatória. Nome e Empresa são opcionais.</li>
              <li>· Os nomes das colunas não precisam ser exatos — na etapa seguinte você confere o que o sistema detectou.</li>
              <li>· Colunas a mais podem ser guardadas como variáveis e usadas no HTML do e-mail.</li>
              <li>· CSV separado por <code>;</code> ou <code>,</code> (detectado automaticamente) ou XLSX. Até 20.000 linhas.</li>
              <li>· E-mails repetidos e inválidos são descartados, e a tela mostra quais.</li>
            </ul>
          </div>

          <UAlert
            v-if="erroImportacao"
            color="error"
            variant="subtle"
            icon="i-lucide-file-x"
            :title="`Não deu para ler \u201c${erroImportacao.arquivo}\u201d: ${erroImportacao.motivo}`"
            :description="erroImportacao.dica"
            :close="{ color: 'error', variant: 'link' }"
            @update:open="erroImportacao = null"
          />

          <div class="rounded-lg border border-dashed border-default p-6 text-center">
            <UIcon name="i-lucide-file-spreadsheet" class="mx-auto size-10 text-muted" />
            <p class="mt-2 text-sm font-medium">Importe um arquivo CSV ou XLSX</p>
            <p class="text-xs text-muted">A primeira linha deve conter os nomes das colunas.</p>
            <label class="mt-3 inline-block">
              <input type="file" accept=".csv,.txt,.xlsx,.xls" class="hidden" @change="importar" >
              <span class="inline-flex cursor-pointer items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-inverted">
                <UIcon :name="importando ? 'i-lucide-loader-circle' : 'i-lucide-upload'" :class="importando && 'animate-spin'" />
                {{ importando ? 'Lendo...' : 'Escolher arquivo' }}
              </span>
            </label>
          </div>

        <template v-if="importado">
          <USeparator label="Mapeamento de colunas" />

          <!-- Sem coluna de e-mail nada pode ser importado: diga isso antes do botao desabilitado -->
          <UAlert
            v-if="mapa.email === SEM_COLUNA"
            color="warning"
            variant="subtle"
            icon="i-lucide-mail-question"
            title="Nenhuma coluna de e-mail foi reconhecida"
            :description="`O arquivo tem ${importado.colunas.length} coluna(s): ${importado.colunas.join(', ')}. Escolha abaixo qual delas contém o endereço — sem isso não há para onde enviar e nada pode ser acrescentado.`"
          />
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <UFormField label="Coluna de e-mail" required>
              <USelect v-model="mapa.email" :items="opcoesColunas" class="w-full" />
            </UFormField>
            <UFormField label="Coluna de nome">
              <USelect v-model="mapa.nome" :items="opcoesColunas" class="w-full" />
            </UFormField>
            <UFormField label="Coluna de empresa">
              <USelect v-model="mapa.empresa" :items="opcoesColunas" class="w-full" />
            </UFormField>
            <UFormField label="Coluna de CPF/CNPJ" help="Casa cada cliente com o arquivo dele, no anexo individual.">
              <USelect v-model="mapa.documento" :items="opcoesColunas" class="w-full" />
            </UFormField>
          </div>

          <UFormField
            label="Colunas extras"
            help="Ficam salvas junto ao destinatário e podem ser usadas como variáveis no HTML."
          >
            <USelectMenu
              v-model="colunasExtras"
              :items="importado.colunas"
              multiple
              placeholder="Nenhuma"
              class="w-full"
            />
          </UFormField>

          <UButton
            icon="i-lucide-plus"
            :label="`Acrescentar ${importado.total} linha(s) ao lote`"
            :disabled="mapa.email === SEM_COLUNA"
            @click="adicionarDoArquivo"
          />
        </template>
        </template>

        <!-- ORIGEM: LISTA SALVA -->
        <template v-if="origem === 'lista'">
          <div class="flex flex-wrap items-end gap-3">
            <UFormField label="Lista" class="w-full sm:w-96">
              <USelect
                v-model="listaEscolhida"
                :items="listasSalvas.map(l => ({ label: `${l.nome} (${l.total})`, value: l.id }))"
                placeholder="Escolha uma lista"
                class="w-full"
              />
            </UFormField>
            <UButton
              label="Acrescentar os contatos da lista"
              icon="i-lucide-plus"
              :loading="carregandoLista"
              :disabled="!listaEscolhida"
              @click="adicionarDaLista()"
            />
            <UButton to="/admin/listas" label="Gerenciar listas" icon="i-lucide-external-link" color="neutral" variant="ghost" size="sm" />
          </div>
          <p v-if="!listasSalvas.length" class="text-sm text-muted">
            Nenhuma lista salva ainda. Monte os destinatários por outra origem e use “Salvar como lista”, ou crie em Listas.
          </p>
        </template>

        <!-- ORIGEM: BANCO -->
        <template v-else-if="origem === 'banco'">
          <UAlert
            color="info"
            variant="subtle"
            icon="i-lucide-info"
            title="Contatos de envios anteriores"
            description="Cada pessoa aparece uma vez, com o nome e a empresa do envio mais recente dela. Útil para reenviar só para quem não confirmou a leitura."
          />

          <div class="grid gap-3 sm:grid-cols-3">
            <UFormField label="Buscar">
              <UInput v-model="filtroContatos.busca" icon="i-lucide-search" placeholder="Nome, e-mail ou empresa" class="w-full" />
            </UFormField>
            <UFormField label="Comportamento">
              <USelect v-model="filtroContatos.marco" :items="CONTATOS_MARCOS" class="w-full" />
            </UFormField>
            <UFormField label="Lote de origem">
              <USelect v-model="filtroContatos.batchId" :items="opcoesLotesOrigem" class="w-full" />
            </UFormField>
          </div>

          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="text-sm text-muted">
              {{ contatos.length }} contato(s) encontrados
              <span v-if="contatosData"> de {{ contatosData.totalGeral }} no banco</span>
            </p>
            <div class="flex gap-2">
              <UButton
                :label="todosMarcados ? 'Desmarcar todos' : 'Marcar todos'"
                :icon="todosMarcados ? 'i-lucide-square' : 'i-lucide-check-square'"
                size="xs"
                color="neutral"
                variant="outline"
                :disabled="!contatos.length"
                @click="alternarTodos"
              />
              <UBadge v-if="selecionados.length" color="primary" variant="subtle" :label="`${selecionados.length} selecionado(s)`" />
              <UButton
                icon="i-lucide-plus"
                size="xs"
                label="Acrescentar ao lote"
                :disabled="!selecionados.length"
                @click="adicionarDoBanco"
              />
            </div>
          </div>

          <div class="max-h-96 overflow-y-auto rounded-lg border border-default">
            <p v-if="carregandoContatos === 'pending'" class="py-8 text-center text-sm text-muted">Carregando…</p>
            <p v-else-if="!contatos.length" class="py-8 text-center text-sm text-muted">
              Nenhum contato encontrado com esses filtros.
            </p>
            <table v-else class="w-full text-sm">
              <thead class="sticky top-0 bg-default text-left text-xs uppercase text-muted">
                <tr>
                  <th class="w-10 px-3 py-2" />
                  <th class="px-3 py-2">Contato</th>
                  <th class="px-3 py-2">Último lote</th>
                  <th class="px-3 py-2">Situação</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="c in contatos"
                  :key="c.email"
                  class="cursor-pointer border-t border-default hover:bg-elevated/30"
                  @click="alternarContato(c)"
                >
                  <td class="px-3 py-2">
                    <UCheckbox :model-value="!!escolhidos[c.email]" @click.stop="alternarContato(c)" />
                  </td>
                  <td class="max-w-[260px] px-3 py-2">
                    <p class="truncate font-medium">{{ c.nome || '—' }}</p>
                    <p class="truncate text-xs text-muted">{{ c.email }}</p>
                    <p v-if="c.empresa" class="truncate text-xs text-muted">{{ c.empresa }}</p>
                  </td>
                  <td class="max-w-[160px] truncate px-3 py-2 text-xs text-muted">{{ c.loteNome }}</td>
                  <td class="px-3 py-2">
                    <UBadge v-if="c.confirmedAt" color="success" variant="subtle" size="xs" label="confirmou" />
                    <UBadge v-else-if="c.status === 'erro'" color="error" variant="subtle" size="xs" label="falhou" />
                    <UBadge v-else-if="c.sentAt" color="neutral" variant="subtle" size="xs" label="não confirmou" />
                    <UBadge v-else color="neutral" variant="subtle" size="xs" label="não enviado" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>

        <!-- ORIGEM: MANUAL -->
        <template v-else>
          <UFormField label="Um destinatário por linha">
            <UTextarea
              v-model="textoManual"
              :rows="10"
              class="w-full"
              :ui="{ base: 'font-mono text-xs' }"
              placeholder="maria.oliveira@empresa.com.br&#10;Joao Souza <joao.souza@empresa.com.br>&#10;Ana Lima; ana.lima@empresa.com.br; Empresa Exemplo LTDA"
              spellcheck="false"
            />
          </UFormField>

          <div class="rounded-lg border border-default bg-elevated/40 p-4">
            <p class="mb-2 text-xs font-medium text-muted">Formatos aceitos (pode misturar)</p>
            <ul class="space-y-1 font-mono text-xs">
              <li>maria.oliveira@empresa.com.br</li>
              <li>Joao Souza &lt;joao.souza@empresa.com.br&gt;</li>
              <li>Ana Lima; ana.lima@empresa.com.br; Empresa Exemplo LTDA</li>
              <li>Ana Lima, ana.lima@empresa.com.br, Empresa Exemplo LTDA</li>
            </ul>
            <p class="mt-2 text-xs text-muted">Linhas começando com <code>#</code> são ignoradas.</p>
          </div>

          <UButton
            icon="i-lucide-plus"
            label="Acrescentar ao lote"
            :disabled="!textoManual.trim()"
            @click="adicionarDigitados"
          />
        </template>

        <!-- ORIGEM: SISTEMA (users e client) -->
        <template v-if="origem === 'sistema'">
          <UAlert
            color="info"
            variant="subtle"
            icon="i-lucide-info"
            title="Pessoas cadastradas no sistema da empresa"
            description="Colaboradores e clientes pessoa física. As empresas não aparecem aqui porque a tabela delas não tem e-mail cadastrado — não haveria para onde enviar."
          />

          <div class="grid gap-3 sm:grid-cols-3">
            <UFormField label="Buscar" class="sm:col-span-2">
              <UInput
                v-model="buscaPessoas"
                icon="i-lucide-search"
                placeholder="Nome, e-mail, setor, CPF/CNPJ ou código"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Mostrar">
              <USelect v-model="origemPessoas" :items="ORIGENS_PESSOA" class="w-full" />
            </UFormField>
          </div>

          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="text-sm text-muted">
              {{ pessoas.length }} encontrado(s)
              <span v-if="pessoasData">
                · {{ pessoasData.totais.equipe }} na equipe, {{ pessoasData.totais.cliente }} clientes
              </span>
            </p>
            <UButton
              icon="i-lucide-plus"
              size="xs"
              color="neutral"
              variant="outline"
              :label="`Acrescentar os ${pessoas.length} da busca`"
              :disabled="!pessoas.length"
              @click="adicionarTodasPessoas"
            />
          </div>

          <div class="max-h-96 overflow-y-auto rounded-lg border border-default">
            <p v-if="carregandoPessoas === 'pending'" class="py-8 text-center text-sm text-muted">
              Carregando…
            </p>
            <p v-else-if="!pessoas.length" class="py-8 text-center text-sm text-muted">
              Ninguém encontrado com essa busca.
            </p>
            <table v-else class="w-full text-sm">
              <thead class="sticky top-0 bg-default text-left text-xs uppercase text-muted">
                <tr>
                  <th class="px-3 py-2">Pessoa</th>
                  <th class="px-3 py-2">Origem</th>
                  <th class="w-24 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                <tr v-for="pe in pessoas" :key="pe.chave" class="border-t border-default hover:bg-elevated/30">
                  <td class="max-w-[320px] px-3 py-2">
                    <p class="truncate font-medium">{{ pe.nome }}</p>
                    <p class="truncate text-xs text-muted">{{ pe.email }}</p>
                    <p v-if="pe.detalhe" class="truncate text-xs text-muted">{{ pe.detalhe }}</p>
                  </td>
                  <td class="px-3 py-2">
                    <UBadge
                      size="xs"
                      variant="subtle"
                      :color="pe.origem === 'equipe' ? 'primary' : 'success'"
                      :label="pe.origem === 'equipe' ? 'equipe' : 'cliente'"
                    />
                  </td>
                  <td class="px-3 py-2 text-right">
                    <UButton
                      v-if="carrinho[pe.email]"
                      icon="i-lucide-check"
                      size="xs"
                      color="success"
                      variant="soft"
                      label="no lote"
                      disabled
                    />
                    <UButton
                      v-else
                      icon="i-lucide-plus"
                      size="xs"
                      color="neutral"
                      variant="outline"
                      label="Acrescentar"
                      @click="adicionarPessoa(pe)"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>

        <!-- O LOTE: soma de todas as origens -->
        <USeparator />

        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p class="font-medium">
              Destinatários do lote
              <UBadge v-if="totalCarrinho" color="primary" variant="subtle" class="ml-2" :label="String(totalCarrinho)" />
            </p>
            <p class="text-xs text-muted">
              Pode misturar origens — e-mails repetidos entram uma vez só.
            </p>
          </div>
          <div v-if="totalCarrinho" class="flex gap-1">
            <UButton
              icon="i-lucide-list-plus"
              label="Salvar como lista"
              size="xs"
              color="neutral"
              variant="ghost"
              @click="modalSalvarLista = true"
            />
            <UButton
              icon="i-lucide-trash-2"
              label="Limpar lista"
              size="xs"
              color="error"
              variant="ghost"
              @click="limparCarrinho"
            />
          </div>
        </div>

        <UModal v-model:open="modalSalvarLista" title="Salvar como lista">
          <template #body>
            <form class="space-y-4" @submit.prevent="salvarComoLista">
              <p class="text-sm text-muted">Os {{ totalCarrinho }} destinatários ficam salvos para os próximos envios e solicitações.</p>
              <UFormField label="Nome da lista" required>
                <UInput v-model="novaLista.nome" placeholder="Clientes do Simples Nacional" class="w-full" autofocus />
              </UFormField>
              <UFormField label="Descrição" hint="opcional">
                <UInput v-model="novaLista.descricao" class="w-full" />
              </UFormField>
              <div class="flex justify-end gap-2">
                <UButton label="Cancelar" color="neutral" variant="ghost" @click="modalSalvarLista = false" />
                <UButton type="submit" label="Salvar lista" :loading="salvandoLista" :disabled="novaLista.nome.trim().length < 2" />
              </div>
            </form>
          </template>
        </UModal>

        <!-- Padronizacao: vale para a lista inteira, e nome e empresa sao independentes -->
        <div v-if="totalCarrinho" class="rounded-lg border border-default bg-elevated/40 p-3">
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

        <!-- Por que cada linha ficou de fora: sem isso a pessoa nao tem como corrigir a lista -->
        <div
          v-if="ultimaInclusao && ultimaInclusao.rejeitadas.length"
          class="overflow-hidden rounded-lg border border-warning/40 bg-warning/5"
        >
          <div class="flex flex-wrap items-start gap-3 p-3">
            <UIcon name="i-lucide-triangle-alert" class="mt-0.5 size-5 shrink-0 text-warning" />
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium">
                {{ ultimaInclusao.rejeitadas.length }} de {{ ultimaInclusao.lidas }} linha(s) não entraram
              </p>
              <p class="text-xs text-muted">
                {{ ultimaInclusao.adicionados }} acrescentada(s) ao lote. Nada foi perdido do arquivo original —
                corrija e importe de novo, que só as novas entram.
              </p>
              <div class="mt-2 flex flex-wrap gap-1.5">
                <UBadge
                  v-for="r in resumoRejeicoes"
                  :key="r.motivo"
                  size="xs"
                  color="warning"
                  variant="subtle"
                  :label="`${r.total} · ${r.motivo}`"
                />
              </div>
            </div>
          </div>

          <div class="max-h-64 overflow-y-auto border-t border-warning/30 bg-default">
            <table class="w-full text-left text-xs">
              <thead class="sticky top-0 bg-elevated/80 uppercase text-muted">
                <tr>
                  <th class="w-16 px-3 py-1.5">Linha</th>
                  <th class="px-3 py-1.5">Motivo</th>
                  <th class="px-3 py-1.5">O que aconteceu</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(r, i) in rejeicoesVisiveis" :key="i" class="border-t border-default align-top">
                  <td class="px-3 py-1.5 font-mono text-muted">{{ r.linha ?? '—' }}</td>
                  <td class="px-3 py-1.5 whitespace-nowrap font-medium">{{ r.motivo }}</td>
                  <td class="px-3 py-1.5 text-muted">
                    {{ r.detalhe }}
                    <span v-if="r.nome" class="block text-[11px] opacity-70">Linha: {{ r.nome }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div v-if="ultimaInclusao.rejeitadas.length > rejeicoesVisiveis.length || verTodasRejeicoes" class="border-t border-default bg-default px-3 py-2">
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              :icon="verTodasRejeicoes ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
              :label="verTodasRejeicoes
                ? 'Mostrar menos'
                : `Ver as outras ${ultimaInclusao.rejeitadas.length - rejeicoesVisiveis.length}`"
              @click="verTodasRejeicoes = !verTodasRejeicoes"
            />
          </div>
        </div>

        <div v-if="!totalCarrinho" class="rounded-lg border border-dashed border-default py-8 text-center">
          <UIcon name="i-lucide-inbox" class="size-8 text-muted" />
          <p class="mt-2 text-sm text-muted">
            Nenhum destinatário ainda. Escolha uma origem acima e acrescente.
          </p>
        </div>

        <div v-else class="max-h-80 overflow-y-auto rounded-lg border border-default">
          <table class="w-full text-sm">
            <thead class="sticky top-0 bg-default text-left text-xs uppercase text-muted">
              <tr>
                <th class="px-3 py-2">Nome</th>
                <th class="px-3 py-2">E-mail</th>
                <th class="px-3 py-2">Empresa</th>
                <th class="px-3 py-2">Veio de</th>
                <th class="w-10 px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              <tr v-for="d in listaProcessada.validos" :key="d.email" class="border-t border-default">
                <td class="max-w-[200px] truncate px-3 py-2">{{ d.nome || '—' }}</td>
                <td class="px-3 py-2 font-mono text-xs">{{ d.email }}</td>
                <td class="max-w-[180px] truncate px-3 py-2">{{ d.empresa || '—' }}</td>
                <td class="px-3 py-2">
                  <UBadge
                    size="xs"
                    variant="subtle"
                    :color="(CORES_ORIGEM[d.origem] as any) || 'neutral'"
                    :label="d.origem"
                  />
                </td>
                <td class="px-3 py-2">
                  <UButton
                    icon="i-lucide-x"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    @click="removerDoCarrinho(d.email)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </UCard>

    <!-- PASSO 2 -->
    <UCard v-show="passo === 2">
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
      <template #header><h2 class="font-semibold">3. Conteúdo do e-mail</h2></template>

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
          :exige-botao="!!arquivoNome"
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
          <UFormField label="Nome do lote" help="Para você identificar no relatório.">
            <UInput v-model="nomeLote" class="w-full" />
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
            <p class="truncate text-sm font-medium">{{ arquivoOriginal || 'nenhum' }}</p>
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
        :disabled="!listaProcessada.validos.length || !agendamentoValido || respostaInvalida"
        @click="confirmando = true"
      />
    </div>

    <ModalConfirmarEnvio v-model:open="confirmando" :resumo="resumoEnvio" :carregando="criando" @confirmar="criarLote" />
  </div>
</template>
