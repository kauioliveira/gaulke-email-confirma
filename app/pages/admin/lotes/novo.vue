<script setup lang="ts">
import { tamanho, duracao } from '~/utils/formato'

definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: 'Novo envio — Gaulke Envios' })

const toast = useToast()
const passo = ref(1)
const PASSOS = [
  { n: 1, titulo: 'Lista', icone: 'i-lucide-users' },
  { n: 2, titulo: 'Arquivo', icone: 'i-lucide-file-text' },
  { n: 3, titulo: 'E-mail', icone: 'i-lucide-mail' },
  { n: 4, titulo: 'Revisão', icone: 'i-lucide-rocket' }
]

/* ---------- Passo 1: lista ---------- */
type Origem = 'arquivo' | 'banco' | 'manual' | 'sistema'
const origem = ref<Origem>('arquivo')

const ORIGENS = [
  { valor: 'arquivo' as Origem, titulo: 'Importar arquivo', icone: 'i-lucide-file-spreadsheet', desc: 'CSV ou XLSX' },
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
const mapa = reactive({ email: SEM_COLUNA, nome: SEM_COLUNA, empresa: SEM_COLUNA })
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
    colunasExtras.value = []
    toast.add({ title: `${r.total} linha(s) lidas de ${r.arquivo}`, color: 'success' })
  } catch (err: any) {
    toast.add({ title: 'Falha ao ler o arquivo', description: err?.statusMessage, color: 'error' })
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
const escolhidos = ref<Record<string, { email: string; nome: string; empresa: string }>>({})
const selecionados = computed(() => Object.keys(escolhidos.value))

function alternarContato(c: Contato) {
  if (escolhidos.value[c.email]) {
    const { [c.email]: _removido, ...resto } = escolhidos.value
    escolhidos.value = resto
    return
  }
  escolhidos.value = {
    ...escolhidos.value,
    [c.email]: { email: c.email, nome: c.nome || '', empresa: c.empresa || '' }
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
    adicionados[c.email] = { email: c.email, nome: c.nome || '', empresa: c.empresa || '' }
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
  const saida: { nome: string; email: string; empresa: string; extras: Record<string, string> }[] = []

  for (const linha of texto.split(/[\r\n]+/)) {
    const bruta = linha.trim()
    if (!bruta || bruta.startsWith('#')) continue

    const comAngulo = bruta.match(/^(.*?)<([^>]+)>\s*$/)
    if (comAngulo) {
      saida.push({
        nome: comAngulo[1]!.trim().replace(/^["']|["']$/g, ''),
        email: comAngulo[2]!.trim(),
        empresa: '',
        extras: {}
      })
      continue
    }

    const partes = bruta.split(/[;,\t]/).map(p => p.trim())
    if (partes.length > 1) {
      const idx = partes.findIndex(p => p.includes('@'))
      const email = idx >= 0 ? partes[idx]! : partes[1]!
      const resto = partes.filter((_, i) => i !== (idx >= 0 ? idx : 1))
      saida.push({ nome: resto[0] || '', email, empresa: resto[1] || '', extras: {} })
      continue
    }

    saida.push({ nome: '', email: bruta, empresa: '', extras: {} })
  }

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
  origem: string
  extras: Record<string, string>
}

/**
 * Indexado por e-mail em minúsculas: a deduplicação acontece por construção,
 * não por uma checagem que alguém pode esquecer de rodar. Duas origens
 * diferentes trazendo a mesma pessoa resultam em UM destinatário.
 */
const carrinho = ref<Record<string, Item>>({})

const listaProcessada = computed(() => ({
  validos: Object.values(carrinho.value),
  rejeitados: [] as { linha: number; email: string; motivo: string }[]
}))

const totalCarrinho = computed(() => Object.keys(carrinho.value).length)

/** Resultado da última inclusão, mostrado logo abaixo do botão. */
const ultimaInclusao = ref<{ adicionados: number; repetidos: number; invalidos: string[] } | null>(null)

function adicionar(linhas: { email: string; nome?: string; empresa?: string; extras?: Record<string, string> }[], origem: string) {
  const novos = { ...carrinho.value }
  let adicionados = 0
  let repetidos = 0
  const invalidos: string[] = []

  for (const l of linhas) {
    const email = String(l.email || '').trim().toLowerCase()
    if (!email) continue
    if (!RE_EMAIL.test(email)) {
      if (invalidos.length < 5) invalidos.push(email)
      continue
    }
    if (novos[email]) {
      repetidos++
      continue
    }
    novos[email] = {
      email,
      nome: l.nome || '',
      empresa: l.empresa || '',
      origem,
      extras: l.extras || {}
    }
    adicionados++
  }

  carrinho.value = novos
  ultimaInclusao.value = { adicionados, repetidos, invalidos }

  toast.add({
    title: adicionados
      ? `${adicionados} destinatário(s) acrescentado(s)`
      : 'Nada foi acrescentado',
    description: [
      repetidos ? `${repetidos} já estavam na lista` : '',
      invalidos.length ? `${invalidos.length} com e-mail inválido` : ''
    ].filter(Boolean).join(' · ') || undefined,
    color: adicionados ? 'success' : 'warning'
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
  const linhas = importado.value.linhas.map((l: any) => {
    const extras: Record<string, string> = {}
    for (const c of colunasExtras.value) if (l[c]) extras[c] = String(l[c])
    return {
      email: String(l[mapa.email] || ''),
      nome: mapa.nome === SEM_COLUNA ? '' : String(l[mapa.nome] || ''),
      empresa: mapa.empresa === SEM_COLUNA ? '' : String(l[mapa.empresa] || ''),
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
  adicionar([{ email: p.email, nome: p.nome, empresa: p.detalhe || '' }],
    p.origem === 'equipe' ? 'equipe' : 'cliente')
}

function adicionarTodasPessoas() {
  adicionar(
    pessoas.value.map(p => ({ email: p.email, nome: p.nome, empresa: p.detalhe || '' })),
    'sistema'
  )
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

async function subirPdf(e: Event) {
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
    toast.add({ title: 'PDF enviado', description: r.nomeOriginal, color: 'success' })
  } catch (err: any) {
    toast.add({ title: 'Falha no upload', description: err?.statusMessage, color: 'error' })
  } finally {
    enviandoArquivo.value = false
    input.value = ''
  }
}

function escolherExistente(a: any) {
  arquivoNome.value = a.nome
  arquivoOriginal.value = a.nome
}

/* ---------- Passo 3: e-mail ---------- */
const { data: templatesData } = await useFetch<RespostaTemplates>(api('/api/admin/templates'))
const templateId = ref<number | null>(null)
const assunto = ref('')
const html = ref('')
const formatoEmail = ref<FormatoTemplate>('html')
const blocosEmail = ref<Bloco[]>([])

// imagens de public/brand, para o bloco de imagem do editor visual
const { data: brand } = await useFetch<{ arquivos: { nome: string }[] }>(api('/api/admin/brand'), {
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
  (templatesData.value?.templates || []).map(t => ({ label: t.nome, value: t.id }))
)

/* ---------- Passo 4: revisão ---------- */
const nomeLote = ref(`Envio ${new Date().toLocaleDateString('pt-BR')}`)
const intervaloSegundos = ref(10)
const exigirConfirmacao = ref(true)
const pedirRecibo = ref(false)
const criando = ref(false)

/* ---------- agendamento ---------- */
const quandoDisparar = ref<'depois' | 'agendar'>('depois')
const dataAgendada = ref('')

/** Sugere daqui a 1h, arredondado — evita cair numa data invalida. */
function sugerirHorario() {
  const d = new Date(Date.now() + 60 * 60 * 1000)
  d.setMinutes(0, 0, 0)
  // datetime-local espera "YYYY-MM-DDTHH:mm" em hora LOCAL, sem fuso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

watch(quandoDisparar, v => {
  if (v === 'agendar' && !dataAgendada.value) dataAgendada.value = sugerirHorario()
})

/**
 * O input datetime-local devolve hora LOCAL sem fuso ("2026-08-27T08:00").
 * `new Date(...)` interpreta no fuso do navegador e o toISOString converte
 * para UTC, que e o que o banco guarda. Mandar a string crua faria 8h de
 * Brasilia virar 8h UTC — o comunicado sairia 3h antes.
 */
const agendadoParaISO = computed(() => {
  if (quandoDisparar.value !== 'agendar' || !dataAgendada.value) return null
  const d = new Date(dataAgendada.value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
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

const contaEscolhida = computed(() => contasAtivas.value.find(c => c.id === contaId.value) || null)

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
        exigirConfirmacao: exigirConfirmacao.value,
        pedirRecibo: pedirRecibo.value,
        agendadoPara: agendadoParaISO.value,
        destinatarios: listaProcessada.value.validos
      }
    })
    toast.add({
      title: agendadoParaISO.value
        ? `Lote agendado para ${new Date(agendadoParaISO.value).toLocaleString('pt-BR')}`
        : `Lote criado com ${r.destinatarios} destinatários`,
      color: 'success'
    })
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
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
          <div class="grid gap-4 sm:grid-cols-3">
            <UFormField label="Coluna de e-mail" required>
              <USelect v-model="mapa.email" :items="opcoesColunas" class="w-full" />
            </UFormField>
            <UFormField label="Coluna de nome">
              <USelect v-model="mapa.nome" :items="opcoesColunas" class="w-full" />
            </UFormField>
            <UFormField label="Coluna de empresa">
              <USelect v-model="mapa.empresa" :items="opcoesColunas" class="w-full" />
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
          <UButton
            v-if="totalCarrinho"
            icon="i-lucide-trash-2"
            label="Limpar lista"
            size="xs"
            color="error"
            variant="ghost"
            @click="limparCarrinho"
          />
        </div>

        <UAlert
          v-if="ultimaInclusao && (ultimaInclusao.repetidos || ultimaInclusao.invalidos.length)"
          color="warning"
          variant="subtle"
          icon="i-lucide-info"
          title="Nem tudo entrou"
          :description="[
            ultimaInclusao.repetidos ? `${ultimaInclusao.repetidos} já estavam na lista` : '',
            ultimaInclusao.invalidos.length ? `e-mail inválido: ${ultimaInclusao.invalidos.join(', ')}` : ''
          ].filter(Boolean).join(' · ')"
        />

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
      <template #header><h2 class="font-semibold">2. Documento PDF</h2></template>

      <div class="space-y-5">
        <UAlert
          color="info"
          variant="subtle"
          icon="i-lucide-info"
          title="O PDF não vai anexado no e-mail"
          description="Ele fica em área privada e só é entregue pela página com token — é assim que conseguimos registrar quem baixou."
        />

        <div class="rounded-lg border border-dashed border-default p-6 text-center">
          <UIcon name="i-lucide-file-up" class="mx-auto size-10 text-muted" />
          <p class="mt-2 text-sm font-medium">Envie o PDF deste lote</p>
          <p class="text-xs text-muted">Até 25 MB.</p>
          <label class="mt-3 inline-block">
            <input type="file" accept="application/pdf,.pdf" class="hidden" @change="subirPdf" >
            <span class="inline-flex cursor-pointer items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-inverted">
              <UIcon :name="enviandoArquivo ? 'i-lucide-loader-circle' : 'i-lucide-upload'" :class="enviandoArquivo && 'animate-spin'" />
              {{ enviandoArquivo ? 'Enviando...' : 'Escolher PDF' }}
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
              <UIcon name="i-lucide-file-text" class="size-6 shrink-0 text-error" />
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
          icon="i-lucide-triangle-alert"
          title="Nenhum arquivo selecionado"
          description="Você pode seguir sem PDF — a página mostrará apenas a confirmação de leitura."
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
        />
      </div>
    </UCard>

    <!-- PASSO 4 -->
    <UCard v-show="passo === 4">
      <template #header><h2 class="font-semibold">4. Revisão e disparo</h2></template>

      <div class="space-y-5">
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Nome do lote" help="Para você identificar no relatório.">
            <UInput v-model="nomeLote" class="w-full" />
          </UFormField>
          <UFormField label="Intervalo entre os envios" help="Intervalos maiores reduzem o risco de cair em spam.">
            <USelect v-model="intervaloSegundos" :items="OPCOES_INTERVALO" class="w-full" />
          </UFormField>
        </div>

        <!-- De qual conta sai o e-mail -->
        <UFormField
          label="Conta de envio"
          :help="contaEscolhida
            ? `Os e-mails sairão de ${contaEscolhida.remetente}.`
            : 'Nenhuma conta cadastrada: será usada a configuração do .env.'"
        >
          <div class="flex flex-wrap items-center gap-2">
            <USelect
              v-if="itensConta.length"
              v-model="contaId"
              :items="itensConta"
              class="min-w-64"
            />
            <UButton
              to="/admin/configuracoes"
              :label="itensConta.length ? 'Gerenciar contas' : 'Cadastrar uma conta'"
              icon="i-lucide-settings"
              color="neutral"
              variant="outline"
              size="xs"
            />
          </div>
        </UFormField>

        <div class="space-y-3">
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
            <UFormField label="Data e hora" help="No seu fuso horário.">
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
              :title="`Disparo em ${new Date(agendadoParaISO!).toLocaleString('pt-BR')}`"
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
        :disabled="!listaProcessada.validos.length || !agendamentoValido"
        @click="criarLote"
      />
    </div>
  </div>
</template>
