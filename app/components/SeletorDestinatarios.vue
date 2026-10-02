<script setup lang="ts">
import { lerListaColada } from '~~/shared/utils/lista-colada'
import { mascaraDocumento, soDigitosDoc } from '~~/shared/utils/documento'

/**
 * Montagem da lista de destinatários, igual no lote e na solicitação: várias
 * origens (empresa, planilha, lista salva, envios anteriores, digitar/colar,
 * equipe e clientes do sistema) somam no mesmo carrinho.
 *
 * O carrinho é indexado pelo e-mail em minúsculas: a deduplicação acontece
 * por construção. Cada inclusão mostra o que ficou de fora e por quê.
 */
const props = withDefaults(
  defineProps<{
    origens?: OrigemDestinatario[]
    /** "lote" ou "solicitação": só muda os textos */
    rotulo?: string
    /** colunas extras da planilha viram variáveis (lote) */
    extras?: boolean
    /** mais que isso não entra */
    limite?: number
    /** nome, CPF/CNPJ e empresa editáveis na tabela */
    editavel?: boolean
    /** como mostrar nome e empresa na tabela (padronização do lote) */
    formatar?: (i: ItemDestinatario) => { nome: string; empresa: string }
    /** abre já com esta lista salva (/admin/lotes/novo?lista=12) */
    listaInicial?: number
  }>(),
  { origens: () => ['empresa', 'arquivo', 'lista', 'banco', 'manual', 'sistema'], rotulo: 'lote', extras: false, limite: 20000, editavel: false }
)
const carrinho = defineModel<Record<string, ItemDestinatario>>({ required: true })
const toast = useToast()

const TODAS = {
  empresa: { titulo: 'Empresa', icone: 'i-lucide-building-2', desc: 'busca no cadastro' },
  arquivo: { titulo: 'Importar arquivo', icone: 'i-lucide-file-spreadsheet', desc: 'CSV ou XLSX' },
  lista: { titulo: 'Lista salva', icone: 'i-lucide-list', desc: 'listas de contatos' },
  banco: { titulo: 'Envios anteriores', icone: 'i-lucide-database', desc: 'quem já recebeu' },
  manual: { titulo: 'Digitar ou colar', icone: 'i-lucide-keyboard', desc: 'um por linha' },
  sistema: { titulo: 'Do sistema', icone: 'i-lucide-users-round', desc: 'equipe e clientes' }
} satisfies Record<OrigemDestinatario, { titulo: string; icone: string; desc: string }>
const ORIGENS = computed(() => props.origens.map(v => ({ valor: v, ...TODAS[v] })))
const origem = ref<OrigemDestinatario>(props.origens[0] ?? 'manual')

const CORES_ORIGEM: Record<string, string> = {
  empresa: 'warning',
  arquivo: 'neutral',
  'envio anterior': 'info',
  digitado: 'neutral',
  equipe: 'primary',
  cliente: 'success',
  sistema: 'primary'
}
const corDaOrigem = (o: string) => (CORES_ORIGEM[o] ?? (o.startsWith('lista') ? 'info' : 'neutral')) as any

/* ---------- carrinho ---------- */
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const total = computed(() => Object.keys(carrinho.value).length)

type LinhaEntrada = { email: string; nome?: string; empresa?: string; documento?: string | null; extras?: Record<string, string>; linha?: number }
type Rejeitada = { linha: number | null; valor: string; nome: string; motivo: string; detalhe: string }

const ultimaInclusao = ref<{ origem: string; lidas: number; adicionados: number; rejeitadas: Rejeitada[] } | null>(null)
const verTodasRejeicoes = ref(false)
const LIMITE_REJEICOES = 8
const resumoRejeicoes = computed(() => {
  const contas = new Map<string, number>()
  for (const x of ultimaInclusao.value?.rejeitadas ?? []) contas.set(x.motivo, (contas.get(x.motivo) || 0) + 1)
  return [...contas].map(([motivo, n]) => ({ motivo, total: n })).sort((a, b) => b.total - a.total)
})
const rejeicoesVisiveis = computed(() => {
  const todas = ultimaInclusao.value?.rejeitadas || []
  return verTodasRejeicoes.value ? todas : todas.slice(0, LIMITE_REJEICOES)
})

function adicionar(linhas: LinhaEntrada[], de: string, extraRejeitadas: Rejeitada[] = []) {
  const novos = { ...carrinho.value }
  const rejeitadas: Rejeitada[] = [...extraRejeitadas]
  // "ja estava" e "repetido na propria origem" se corrigem em lugares diferentes
  const jaNaLista = new Set(Object.keys(carrinho.value))
  const nestaInclusao = new Set<string>()
  let adicionados = 0

  for (const l of linhas) {
    const bruto = String(l.email || '').trim()
    const email = bruto.toLowerCase()
    const rotuloLinha = [l.nome, l.empresa].filter(Boolean).join(' · ')
    const recusar = (motivo: string, detalhe: string) => rejeitadas.push({ linha: l.linha ?? null, valor: bruto, nome: rotuloLinha, motivo, detalhe })

    if (!email) {
      recusar(
        'Sem e-mail',
        rotuloLinha
          ? `A linha tem dados (${rotuloLinha}) mas está sem e-mail — sem endereço não há para onde enviar.`
          : 'A linha está sem endereço de e-mail. Confira se a coluna de e-mail foi apontada corretamente.'
      )
      continue
    }
    if (!RE_EMAIL.test(email)) {
      const dica = !bruto.includes('@')
        ? 'falta o @ — pode ser que a coluna apontada não seja a do e-mail'
        : bruto.includes(' ')
          ? 'há espaço no meio do endereço'
          : !/\.[^\s@]{2,}$/.test(bruto)
            ? 'falta o domínio depois do ponto final (.com, .com.br)'
            : 'o endereço não está num formato válido'
      recusar('E-mail inválido', `"${bruto}" — ${dica}.`)
      continue
    }
    const doc = soDigitosDoc(l.documento)
    if (doc && doc.length !== 11 && doc.length !== 14) {
      recusar('CPF/CNPJ inválido', `"${l.documento}" — CPF tem 11 dígitos e CNPJ, 14.`)
      continue
    }
    if (nestaInclusao.has(email)) {
      recusar('Repetido na origem', `"${email}" aparece mais de uma vez nesta inclusão — só a primeira entrou.`)
      continue
    }
    if (jaNaLista.has(email)) {
      recusar(`Já estava no ${props.rotulo}`, `"${email}" já tinha entrado por "${carrinho.value[email]?.origem}" — cada pessoa recebe uma vez só.`)
      continue
    }
    if (Object.keys(novos).length >= props.limite) {
      recusar('Limite atingido', `O ${props.rotulo} aceita até ${props.limite} destinatários.`)
      continue
    }
    nestaInclusao.add(email)
    novos[email] = { email, nome: l.nome || '', empresa: l.empresa || '', documento: doc, origem: de, extras: l.extras || {} }
    adicionados++
  }

  carrinho.value = novos
  ultimaInclusao.value = { origem: de, lidas: linhas.length + extraRejeitadas.length, adicionados, rejeitadas }
  verTodasRejeicoes.value = false
  toast.add({
    title: adicionados ? `${adicionados} destinatário(s) acrescentado(s)` : 'Nada foi acrescentado',
    description: rejeitadas.length ? `${rejeitadas.length} ficaram de fora — o motivo de cada um está listado abaixo.` : undefined,
    color: adicionados ? (rejeitadas.length ? 'warning' : 'success') : 'error'
  })
}

function remover(email: string) {
  const { [email]: _fora, ...resto } = carrinho.value
  carrinho.value = resto
}
function limpar() {
  if (!confirm(`Remover os ${total.value} destinatários?`)) return
  carrinho.value = {}
  ultimaInclusao.value = null
}
function editar(email: string, campo: 'nome' | 'empresa' | 'documento', valor: string) {
  const item = carrinho.value[email]
  if (!item) return
  carrinho.value = { ...carrinho.value, [email]: { ...item, [campo]: campo === 'documento' ? soDigitosDoc(valor).slice(0, 14) : valor } }
}
const docInvalido = (d: string) => !!d && d.length !== 11 && d.length !== 14

const linhasTabela = computed(() =>
  Object.values(carrinho.value).map(i => ({ ...i, ...(props.formatar ? props.formatar(i) : {}) }))
)

defineExpose({ adicionar })

/* ---------- origem: empresa ---------- */
function adicionarDaEmpresa(linhas: LinhaEntrada[]) {
  adicionar(linhas, 'empresa')
}

/* ---------- origem: arquivo ---------- */
// o USelect reserva a string vazia para "sem selecao"
const SEM_COLUNA = '__sem_coluna__'
const importando = ref(false)
const importado = ref<RespostaImportacao | null>(null)
const erroImportacao = ref<{ arquivo: string; motivo: string; dica: string } | null>(null)
const mapa = reactive({ email: SEM_COLUNA, nome: SEM_COLUNA, empresa: SEM_COLUNA, documento: SEM_COLUNA })
const colunasExtras = ref<string[]>([])

function dicaDoErro(mensagem: string, arquivo: string) {
  const m = (mensagem || '').toLowerCase()
  if (m.includes('10 mb') || m.includes('maior')) {
    return 'O limite é 10 MB por arquivo. Apague colunas e abas que não serão usadas, ou divida a lista em partes e importe uma de cada vez — elas somam na mesma lista.'
  }
  if (m.includes('csv ou xlsx')) return `"${arquivo}" não é um formato que o leitor entende. Abra no Excel ou no Google Planilhas e salve como CSV ou XLSX.`
  if (m.includes('limite de')) return 'Divida a planilha em arquivos menores e importe um de cada vez — cada importação soma na mesma lista.'
  if (m.includes('vazia') || m.includes('colunas')) {
    return 'O arquivo foi lido mas nenhuma coluna foi encontrada. Confira se a PRIMEIRA linha da primeira aba tem os nomes das colunas (Nome, E-mail, Empresa) e se não há linhas em branco antes dela.'
  }
  return 'Confira se o arquivo abre normalmente no Excel e se a primeira linha tem os nomes das colunas. Se ele veio de outro sistema, tente salvar de novo como CSV.'
}

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
    const motivo = err?.statusMessage || corpo?.statusMessage || corpo?.message || err?.message || 'Erro desconhecido ao ler o arquivo'
    // o servidor manda dica e id quando a falha foi inesperada (500)
    const detalhe = corpo?.data
    erroImportacao.value = {
      arquivo: arquivo.name,
      motivo: `${err?.statusCode ? `HTTP ${err.statusCode} — ` : ''}${motivo}`,
      dica: detalhe?.dica ? `${detalhe.dica} (id do erro: ${detalhe.id} — procure por ele no log do servidor)` : dicaDoErro(motivo, arquivo.name)
    }
    importado.value = null
    toast.add({ title: 'Falha ao ler o arquivo', description: motivo, color: 'error' })
  } finally {
    importando.value = false
    input.value = ''
  }
}
const opcoesColunas = computed(() => [{ label: '— nenhuma —', value: SEM_COLUNA }, ...(importado.value?.colunas || []).map(c => ({ label: c, value: c }))])

function adicionarDoArquivo() {
  if (!importado.value || mapa.email === SEM_COLUNA) return
  const col = (l: Record<string, string>, c: string) => (c === SEM_COLUNA ? '' : String(l[c] || ''))
  adicionar(
    importado.value.linhas.map((l, i) => {
      const extras: Record<string, string> = {}
      for (const c of colunasExtras.value) if (l[c]) extras[c] = String(l[c])
      // +2: a planilha comeca na linha 1 com o cabecalho
      return { linha: i + 2, email: col(l, mapa.email), nome: col(l, mapa.nome), empresa: col(l, mapa.empresa), documento: col(l, mapa.documento), extras }
    }),
    'arquivo'
  )
}

// o modelo mostrado na tela e o do download saem da MESMA fonte no servidor
const COLUNAS_MODELO = ['Nome', 'E-mail', 'Empresa']
const LINHAS_MODELO = [
  ['Maria Oliveira', 'maria.oliveira@empresa.com.br', 'Empresa Exemplo LTDA'],
  ['Joao Souza', 'joao.souza@outraempresa.com.br', 'Outra Empresa ME'],
  ['', 'contato@terceiraempresa.com.br', 'Terceira Empresa SA']
]

/* ---------- origem: lista salva ---------- */
const { data: listasSalvas, execute: carregarListas } = await useFetch<ResumoLista[]>(api('/api/admin/listas'), {
  default: () => [],
  immediate: false,
  server: false
})
watch(origem, o => { if (o === 'lista' && !listasSalvas.value.length) carregarListas() }, { immediate: true })
const listaEscolhida = ref<number | undefined>(undefined)
const carregandoLista = ref(false)
async function adicionarDaLista(idLista = listaEscolhida.value) {
  if (!idLista) return
  carregandoLista.value = true
  try {
    const l = await $fetch<DetalheLista>(api(`/api/admin/listas/${idLista}`))
    // quem ja devolveu nao entra: o envio seria recusado de qualquer forma
    const devolvidos: Rejeitada[] = l.membros
      .filter(m => m.suprimido)
      .map(m => ({ linha: null, valor: m.email, nome: m.nome ?? '', motivo: 'E-mail devolveu antes', detalhe: `"${m.email}" está bloqueado: um envio anterior voltou como inexistente.` }))
    adicionar(
      l.membros.filter(m => !m.suprimido).map(m => ({ email: m.email, nome: m.nome ?? '', empresa: m.empresa ?? '', documento: m.documento, extras: m.extras ?? {} })),
      `lista: ${l.nome}`,
      devolvidos
    )
  } catch (e: any) {
    toast.add({ title: 'Não foi possível abrir a lista', description: e?.data?.statusMessage || e?.statusMessage, color: 'error' })
  } finally {
    carregandoLista.value = false
  }
}
onMounted(() => {
  if (!props.listaInicial) return
  origem.value = 'lista'
  listaEscolhida.value = props.listaInicial
  adicionarDaLista(props.listaInicial)
})

/* ---------- origem: envios anteriores ---------- */
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
 * A seleção guarda o CONTATO INTEIRO, indexado por e-mail: se guardasse só
 * os visíveis, trocar o filtro tiraria do envio quem já tinha sido marcado.
 */
const escolhidos = ref<Record<string, LinhaEntrada>>({})
const selecionados = computed(() => Object.keys(escolhidos.value))
function alternarContato(c: Contato) {
  if (escolhidos.value[c.email]) {
    const { [c.email]: _fora, ...resto } = escolhidos.value
    escolhidos.value = resto
    return
  }
  escolhidos.value = { ...escolhidos.value, [c.email]: { email: c.email, nome: c.nome || '', empresa: c.empresa || '', documento: c.documento || '' } }
}
const consultaContatos = computed(() => ({
  busca: filtroContatos.busca || undefined,
  marco: filtroContatos.marco === 'todos' ? undefined : filtroContatos.marco,
  batchId: filtroContatos.batchId || undefined
}))
const usaBanco = computed(() => props.origens.includes('banco'))
const { data: contatosData, status: carregandoContatos, execute: buscarContatos } = await useFetch<RespostaContatos>(api('/api/admin/contatos'), {
  query: consultaContatos,
  watch: [consultaContatos],
  lazy: true,
  server: false,
  immediate: false
})
const contatos = computed(() => contatosData.value?.contatos || [])
const todosMarcados = computed(() => contatos.value.length > 0 && contatos.value.every(c => !!escolhidos.value[c.email]))
function alternarTodos() {
  const novo = { ...escolhidos.value }
  if (todosMarcados.value) for (const c of contatos.value) delete novo[c.email]
  else for (const c of contatos.value) novo[c.email] = { email: c.email, nome: c.nome || '', empresa: c.empresa || '', documento: c.documento || '' }
  escolhidos.value = novo
}
const { data: lotesData, execute: buscarLotes } = await useFetch<RespostaLotesOpcoes>(api('/api/admin/batches/opcoes'), { lazy: true, server: false, immediate: false })
const opcoesLotesOrigem = computed(() => [{ label: 'Qualquer lote', value: 0 }, ...(lotesData.value?.lotes || []).map(l => ({ label: l.nome, value: l.id }))])
watch(
  origem,
  o => {
    if (o !== 'banco' || !usaBanco.value || contatosData.value) return
    buscarContatos()
    buscarLotes()
  },
  { immediate: true }
)
function adicionarDoBanco() {
  adicionar(Object.values(escolhidos.value), 'envio anterior')
  escolhidos.value = {}
}

/* ---------- origem: digitar ou colar ---------- */
const textoManual = ref('')
function adicionarDigitados() {
  adicionar(lerListaColada(textoManual.value), 'digitado')
  textoManual.value = ''
}

/* ---------- origem: pessoas do sistema ---------- */
const buscaPessoas = ref('')
const origemPessoas = ref<'todas' | 'equipe' | 'cliente'>('todas')
const ORIGENS_PESSOA = [
  { label: 'Equipe e clientes', value: 'todas' },
  { label: 'Somente equipe', value: 'equipe' },
  { label: 'Somente clientes', value: 'cliente' }
]
const consultaPessoas = computed(() => ({ busca: buscaPessoas.value || undefined, origem: origemPessoas.value }))
const { data: pessoasData, status: carregandoPessoas, execute: buscarPessoas } = await useFetch<RespostaPessoas>(api('/api/admin/pessoas'), {
  query: consultaPessoas,
  watch: [consultaPessoas],
  lazy: true,
  server: false,
  immediate: false
})
watch(origem, o => { if (o === 'sistema' && !pessoasData.value) buscarPessoas() }, { immediate: true })
const pessoas = computed(() => pessoasData.value?.pessoas || [])
// "detalhe" e setor · cargo (equipe) ou o codigo do cliente: nao e empresa
const linhaPessoa = (p: Pessoa) => ({ email: p.email, nome: p.nome, empresa: '', documento: p.documento })
function adicionarPessoa(p: Pessoa) {
  adicionar([linhaPessoa(p)], p.origem === 'equipe' ? 'equipe' : 'cliente')
}
function adicionarTodasPessoas() {
  adicionar(pessoas.value.map(linhaPessoa), 'sistema')
}

/* ---------- salvar como lista ---------- */
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
        membros: Object.values(carrinho.value).map(i => ({ email: i.email, nome: i.nome || null, empresa: i.empresa || null, documento: i.documento || null, extras: i.extras }))
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
</script>

<template>
  <div class="space-y-5">
    <!-- escolha da origem -->
    <div class="grid gap-3 sm:grid-cols-2" :class="ORIGENS.length > 4 ? 'lg:grid-cols-3 xl:grid-cols-6' : 'lg:grid-cols-4'">
      <button
        v-for="o in ORIGENS"
        :key="o.valor"
        type="button"
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

    <!-- EMPRESA -->
    <DestinatariosOrigemEmpresa v-if="origem === 'empresa'" @adicionar="adicionarDaEmpresa" />

    <!-- ARQUIVO -->
    <template v-else-if="origem === 'arquivo'">
      <div class="rounded-lg border border-default bg-elevated/40 p-4">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p class="text-sm font-medium">Como o arquivo deve estar</p>
          <UButton :to="api('/api/admin/modelo-lista')" external icon="i-lucide-download" label="Baixar modelo CSV" size="xs" color="neutral" variant="outline" />
        </div>
        <div class="overflow-x-auto rounded border border-default bg-default">
          <table class="w-full text-xs">
            <thead class="bg-elevated/60 text-left">
              <tr>
                <th v-for="c in COLUNAS_MODELO" :key="c" class="border-r border-default px-3 py-2 font-semibold last:border-0">{{ c }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(l, i) in LINHAS_MODELO" :key="i" class="border-t border-default">
                <td v-for="(v, j) in l" :key="j" class="border-r border-default px-3 py-1.5 last:border-0">{{ v || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <ul class="mt-3 space-y-1 text-xs text-muted">
          <li>· <strong>E-mail</strong> é a única coluna obrigatória. Nome, Empresa e CPF/CNPJ são opcionais.</li>
          <li>· Os nomes das colunas não precisam ser exatos — na etapa seguinte você confere o que o sistema detectou.</li>
          <li v-if="extras">· Colunas a mais podem ser guardadas como variáveis e usadas no HTML do e-mail.</li>
          <li>· CSV separado por <code>;</code> ou <code>,</code> (detectado automaticamente) ou XLSX. Até 20.000 linhas.</li>
          <li>· E-mails repetidos e inválidos são descartados, e a tela mostra quais.</li>
        </ul>
      </div>

      <UAlert
        v-if="erroImportacao"
        color="error"
        variant="subtle"
        icon="i-lucide-file-x"
        :title="`Não deu para ler “${erroImportacao.arquivo}”: ${erroImportacao.motivo}`"
        :description="erroImportacao.dica"
        :close="{ color: 'error', variant: 'link' }"
        @update:open="erroImportacao = null"
      />

      <div class="rounded-lg border border-dashed border-default p-6 text-center">
        <UIcon name="i-lucide-file-spreadsheet" class="mx-auto size-10 text-muted" />
        <p class="mt-2 text-sm font-medium">Importe um arquivo CSV ou XLSX</p>
        <p class="text-xs text-muted">A primeira linha deve conter os nomes das colunas.</p>
        <label class="mt-3 inline-block">
          <input type="file" accept=".csv,.txt,.xlsx,.xls" class="hidden" @change="importar" />
          <span class="inline-flex cursor-pointer items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-inverted">
            <UIcon :name="importando ? 'i-lucide-loader-circle' : 'i-lucide-upload'" :class="importando && 'animate-spin'" />
            {{ importando ? 'Lendo...' : 'Escolher arquivo' }}
          </span>
        </label>
      </div>

      <template v-if="importado">
        <USeparator label="Mapeamento de colunas" />
        <UAlert
          v-if="mapa.email === SEM_COLUNA"
          color="warning"
          variant="subtle"
          icon="i-lucide-mail-question"
          title="Nenhuma coluna de e-mail foi reconhecida"
          :description="`O arquivo tem ${importado.colunas.length} coluna(s): ${importado.colunas.join(', ')}. Escolha abaixo qual delas contém o endereço — sem isso não há para onde enviar.`"
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
          <UFormField label="Coluna de CPF/CNPJ" :help="extras ? 'Casa cada cliente com o arquivo dele, no anexo individual.' : 'Organiza a pasta de cada cliente.'">
            <USelect v-model="mapa.documento" :items="opcoesColunas" class="w-full" />
          </UFormField>
        </div>
        <UFormField v-if="extras" label="Colunas extras" help="Ficam salvas junto ao destinatário e podem ser usadas como variáveis no HTML.">
          <USelectMenu v-model="colunasExtras" :items="importado.colunas" multiple placeholder="Nenhuma" class="w-full" />
        </UFormField>
        <UButton icon="i-lucide-plus" :label="`Acrescentar ${importado.total} linha(s)`" :disabled="mapa.email === SEM_COLUNA" @click="adicionarDoArquivo" />
      </template>
    </template>

    <!-- LISTA SALVA -->
    <template v-else-if="origem === 'lista'">
      <div class="flex flex-wrap items-end gap-3">
        <UFormField label="Lista" class="w-full sm:w-96">
          <USelect
            v-model="listaEscolhida"
            :items="listasSalvas.map(l => ({ label: `${l.nome} (${l.total})`, value: l.id }))"
            placeholder="Escolha uma lista"
            class="w-full"
          />
        </UFormField>
        <UButton label="Acrescentar os contatos da lista" icon="i-lucide-plus" :loading="carregandoLista" :disabled="!listaEscolhida" @click="adicionarDaLista()" />
        <UButton to="/admin/listas" label="Gerenciar listas" icon="i-lucide-external-link" color="neutral" variant="ghost" size="sm" />
      </div>
      <p v-if="!listasSalvas.length" class="text-sm text-muted">
        Nenhuma lista salva ainda. Monte os destinatários por outra origem e use “Salvar como lista”, ou crie em Listas.
      </p>
    </template>

    <!-- ENVIOS ANTERIORES -->
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
          <UButton icon="i-lucide-plus" size="xs" label="Acrescentar" :disabled="!selecionados.length" @click="adicionarDoBanco" />
        </div>
      </div>
      <div class="max-h-96 overflow-y-auto rounded-lg border border-default">
        <p v-if="carregandoContatos === 'pending'" class="py-8 text-center text-sm text-muted">Carregando…</p>
        <p v-else-if="!contatos.length" class="py-8 text-center text-sm text-muted">Nenhum contato encontrado com esses filtros.</p>
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
            <tr v-for="c in contatos" :key="c.email" class="cursor-pointer border-t border-default hover:bg-elevated/30" @click="alternarContato(c)">
              <td class="px-3 py-2"><UCheckbox :model-value="!!escolhidos[c.email]" @click.stop="alternarContato(c)" /></td>
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

    <!-- DIGITAR OU COLAR -->
    <template v-else-if="origem === 'manual'">
      <UFormField label="Um destinatário por linha">
        <UTextarea
          v-model="textoManual"
          :rows="8"
          class="w-full"
          :ui="{ base: 'font-mono text-xs' }"
          placeholder="maria.oliveira@empresa.com.br&#10;Joao Souza <joao.souza@empresa.com.br>&#10;Ana Lima; ana.lima@empresa.com.br; Empresa Exemplo LTDA; 12.345.678/0001-95"
          spellcheck="false"
        />
      </UFormField>
      <div class="rounded-lg border border-default bg-elevated/40 p-4">
        <p class="mb-2 text-xs font-medium text-muted">Formatos aceitos (pode misturar e colar direto do Excel)</p>
        <ul class="space-y-1 font-mono text-xs">
          <li>maria.oliveira@empresa.com.br</li>
          <li>Joao Souza &lt;joao.souza@empresa.com.br&gt;</li>
          <li>Ana Lima; ana.lima@empresa.com.br; Empresa Exemplo LTDA</li>
          <li>12.345.678/0001-95 ⇥ Empresa Exemplo LTDA ⇥ ana.lima@empresa.com.br</li>
        </ul>
        <p class="mt-2 text-xs text-muted">O e-mail é achado pelo @ e o CPF/CNPJ pelos dígitos; o resto vira nome e empresa, nessa ordem. Linhas com <code>#</code> no começo são ignoradas.</p>
      </div>
      <UButton icon="i-lucide-plus" label="Acrescentar" :disabled="!textoManual.trim()" @click="adicionarDigitados" />
    </template>

    <!-- DO SISTEMA -->
    <template v-else-if="origem === 'sistema'">
      <UAlert
        color="info"
        variant="subtle"
        icon="i-lucide-info"
        title="Pessoas cadastradas no sistema da empresa"
        :description="
          origens.includes('empresa')
            ? 'Colaboradores e clientes pessoa física com e-mail cadastrado. Para empresas, use a origem “Empresa”: ela sugere os e-mails já usados para o CNPJ.'
            : 'Colaboradores e clientes pessoa física. As empresas não aparecem aqui porque a tabela delas não tem e-mail cadastrado.'
        "
      />
      <div class="grid gap-3 sm:grid-cols-3">
        <UFormField label="Buscar" class="sm:col-span-2">
          <UInput v-model="buscaPessoas" icon="i-lucide-search" placeholder="Nome, e-mail, setor, CPF/CNPJ ou código" class="w-full" />
        </UFormField>
        <UFormField label="Mostrar">
          <USelect v-model="origemPessoas" :items="ORIGENS_PESSOA" class="w-full" />
        </UFormField>
      </div>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-sm text-muted">
          {{ pessoas.length }} encontrado(s)
          <span v-if="pessoasData"> · {{ pessoasData.totais.equipe }} na equipe, {{ pessoasData.totais.cliente }} clientes</span>
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
        <p v-if="carregandoPessoas === 'pending'" class="py-8 text-center text-sm text-muted">Carregando…</p>
        <p v-else-if="!pessoas.length" class="py-8 text-center text-sm text-muted">Ninguém encontrado com essa busca.</p>
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
                <UBadge size="xs" variant="subtle" :color="pe.origem === 'equipe' ? 'primary' : 'success'" :label="pe.origem === 'equipe' ? 'equipe' : 'cliente'" />
              </td>
              <td class="px-3 py-2 text-right">
                <UButton v-if="carrinho[pe.email]" icon="i-lucide-check" size="xs" color="success" variant="soft" label="na lista" disabled />
                <UButton v-else icon="i-lucide-plus" size="xs" color="neutral" variant="outline" label="Acrescentar" @click="adicionarPessoa(pe)" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- O CARRINHO: soma de todas as origens -->
    <USeparator />

    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <p class="font-medium">
          Destinatários
          <UBadge v-if="total" color="primary" variant="subtle" class="ml-2" :label="String(total)" />
        </p>
        <p class="text-xs text-muted">Pode misturar origens — e-mails repetidos entram uma vez só.</p>
      </div>
      <div v-if="total" class="flex gap-1">
        <UButton icon="i-lucide-list-plus" label="Salvar como lista" size="xs" color="neutral" variant="ghost" @click="modalSalvarLista = true" />
        <UButton icon="i-lucide-trash-2" label="Limpar" size="xs" color="error" variant="ghost" @click="limpar" />
      </div>
    </div>

    <UModal v-model:open="modalSalvarLista" title="Salvar como lista">
      <template #body>
        <form class="space-y-4" @submit.prevent="salvarComoLista">
          <p class="text-sm text-muted">Os {{ total }} destinatários ficam salvos para os próximos envios e solicitações.</p>
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

    <slot name="antes-da-tabela" :total="total" />

    <!-- por que cada linha ficou de fora: sem isso nao ha como corrigir -->
    <div v-if="ultimaInclusao && ultimaInclusao.rejeitadas.length" class="overflow-hidden rounded-lg border border-warning/40 bg-warning/5">
      <div class="flex flex-wrap items-start gap-3 p-3">
        <UIcon name="i-lucide-triangle-alert" class="mt-0.5 size-5 shrink-0 text-warning" />
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium">{{ ultimaInclusao.rejeitadas.length }} de {{ ultimaInclusao.lidas }} linha(s) não entraram</p>
          <p class="text-xs text-muted">
            {{ ultimaInclusao.adicionados }} acrescentada(s). Nada foi perdido do original — corrija e inclua de novo, que só as novas entram.
          </p>
          <div class="mt-2 flex flex-wrap gap-1.5">
            <UBadge v-for="r in resumoRejeicoes" :key="r.motivo" size="xs" color="warning" variant="subtle" :label="`${r.total} · ${r.motivo}`" />
          </div>
        </div>
        <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" aria-label="Dispensar" @click="ultimaInclusao = null" />
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
              <td class="whitespace-nowrap px-3 py-1.5 font-medium">{{ r.motivo }}</td>
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
          :label="verTodasRejeicoes ? 'Mostrar menos' : `Ver as outras ${ultimaInclusao.rejeitadas.length - rejeicoesVisiveis.length}`"
          @click="verTodasRejeicoes = !verTodasRejeicoes"
        />
      </div>
    </div>

    <div v-if="!total" class="rounded-lg border border-dashed border-default py-8 text-center">
      <UIcon name="i-lucide-inbox" class="size-8 text-muted" />
      <p class="mt-2 text-sm text-muted">Nenhum destinatário ainda. Escolha uma origem acima e acrescente.</p>
    </div>

    <div v-else class="max-h-96 overflow-auto rounded-lg border border-default">
      <table class="w-full text-sm">
        <thead class="sticky top-0 z-10 bg-default text-left text-xs uppercase text-muted">
          <tr>
            <th class="px-3 py-2">E-mail</th>
            <th class="px-3 py-2">Nome</th>
            <th v-if="editavel" class="px-3 py-2">CPF/CNPJ</th>
            <th class="px-3 py-2">Empresa</th>
            <th class="px-3 py-2">Veio de</th>
            <th class="w-10 px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in linhasTabela" :key="d.email" class="border-t border-default">
            <td class="px-3 py-1.5 font-mono text-xs">{{ d.email }}</td>
            <template v-if="editavel">
              <td class="px-1.5 py-1">
                <UInput :model-value="d.nome" size="sm" variant="ghost" placeholder="—" class="min-w-36" @update:model-value="v => editar(d.email, 'nome', String(v))" />
              </td>
              <td class="px-1.5 py-1">
                <UInput
                  :model-value="mascaraDocumento(d.documento)"
                  size="sm"
                  variant="ghost"
                  placeholder="—"
                  inputmode="numeric"
                  class="w-44"
                  :color="docInvalido(d.documento) ? 'error' : undefined"
                  :highlight="docInvalido(d.documento)"
                  @update:model-value="v => editar(d.email, 'documento', String(v))"
                />
              </td>
              <td class="px-1.5 py-1">
                <UInput :model-value="d.empresa" size="sm" variant="ghost" placeholder="—" class="min-w-40" @update:model-value="v => editar(d.email, 'empresa', String(v))" />
              </td>
            </template>
            <template v-else>
              <td class="max-w-[200px] truncate px-3 py-2">{{ d.nome || '—' }}</td>
              <td class="max-w-[180px] truncate px-3 py-2">{{ d.empresa || '—' }}</td>
            </template>
            <td class="px-3 py-2">
              <UBadge size="xs" variant="subtle" :color="corDaOrigem(d.origem)" :label="d.origem" class="max-w-40 truncate" />
            </td>
            <td class="px-3 py-2">
              <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" :aria-label="`Remover ${d.email}`" @click="remover(d.email)" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
