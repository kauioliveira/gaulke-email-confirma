<script setup lang="ts">
definePageMeta({ layout: 'admin' })
useHead({ title: 'Nova solicitação — Gaulke Comunica' })

/**
 * Pedido de documentos em quatro passos: o que pedir (modelo de checklist ou
 * em branco), os documentos, para quem, e a mensagem com prazo e canal. Cada
 * cliente vira uma solicitação própria, com link próprio.
 */
const toast = useToast()
const { sessao } = usePapel()
const setores = useDepartamentos()

type Destinatario = { nome: string; email: string; documento: string; empresa: string }

const PASSOS = [
  { titulo: 'O que pedir', icone: 'i-lucide-list-checks' },
  { titulo: 'Documentos', icone: 'i-lucide-files' },
  { titulo: 'Para quem', icone: 'i-lucide-users' },
  { titulo: 'Mensagem e envio', icone: 'i-lucide-send' }
]
const passo = ref(0)

/* ---------- 1. modelo ---------- */
const { data: modelos } = await useFetch<ModeloChecklist[]>(api('/api/admin/checklists'), { default: () => [] })
const checklistId = ref<number | null>(null)
const itens = ref<ItemModeloChecklist[]>([])
const titulo = ref('')

const porSetor = computed(() => {
  const g = new Map<string, ModeloChecklist[]>()
  for (const m of modelos.value) {
    const k = m.setor || 'Todos os setores'
    g.set(k, [...(g.get(k) ?? []), m])
  }
  return [...g]
})

function escolherModelo(m: ModeloChecklist | null) {
  checklistId.value = m?.id ?? null
  itens.value = m ? m.itens.map(i => ({ ...i, tipos: [...i.tipos] })) : []
  if (m && (!titulo.value || modelos.value.some(x => x.nome === titulo.value))) titulo.value = m.nome
  passo.value = 1
}

/* ---------- 2. documentos ---------- */
const itensValidos = computed(() => itens.value.length > 0 && itens.value.every(i => i.titulo.trim()))
const salvandoModelo = ref(false)
const modalModelo = ref(false)
const novoModelo = reactive({ nome: '', setor: '' })
// o seletor abre no setor de quem cria
watch(modalModelo, aberto => { if (aberto && !novoModelo.setor) novoModelo.setor = setores.padrao.value })
async function salvarComoModelo() {
  salvandoModelo.value = true
  try {
    const r = await $fetch<{ id: number }>(api('/api/admin/checklists'), {
      method: 'POST',
      body: { nome: novoModelo.nome, departamentoId: setores.paraId(novoModelo.setor || setores.padrao.value), itens: itens.value }
    })
    checklistId.value = r.id
    modalModelo.value = false
    toast.add({ title: 'Modelo salvo', description: 'Ele aparece no primeiro passo das próximas solicitações.', color: 'success' })
  } catch (e: any) {
    toast.add({ title: 'Não foi possível salvar', description: e?.data?.statusMessage || e?.statusMessage, color: 'error' })
  } finally {
    salvandoModelo.value = false
  }
}

/* ---------- 3. clientes ---------- */
const destinatarios = ref<Destinatario[]>([{ nome: '', email: '', documento: '', empresa: '' }])
const RE_EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/
const emailValido = (e: string) => RE_EMAIL.test(e.trim())
const docValido = (d: string) => {
  const n = d.replace(/\D/g, '').length
  return n === 0 || n === 11 || n === 14
}
const destinatariosValidos = computed(() =>
  destinatarios.value.filter(d => emailValido(d.email) && docValido(d.documento))
)
const destinatariosComErro = computed(() =>
  destinatarios.value.filter(d => (d.email.trim() || d.nome.trim()) && (!emailValido(d.email) || !docValido(d.documento))).length
)

function adicionarLinha(d?: Partial<Destinatario>) {
  const novo = { nome: '', email: '', documento: '', empresa: '', ...d }
  // aproveita a linha vazia do fim em vez de acumular linhas em branco
  const vazia = destinatarios.value.findIndex(x => !x.email.trim() && !x.nome.trim())
  if (d && vazia >= 0) destinatarios.value[vazia] = novo
  else destinatarios.value.push(novo)
}
function removerLinha(i: number) {
  destinatarios.value.splice(i, 1)
  if (!destinatarios.value.length) adicionarLinha()
}

// busca nos contatos que já receberam algo
const busca = ref('')
// a busca só sai quando a pessoa para de digitar
const buscaAtrasada = ref('')
let atraso: ReturnType<typeof setTimeout> | undefined
watch(busca, v => {
  clearTimeout(atraso)
  atraso = setTimeout(() => (buscaAtrasada.value = v.trim().length >= 2 ? v.trim() : ''), 300)
})
const { data: achados, status: statusBusca, execute: buscarContatos } = await useFetch<{ contatos: { email: string; nome: string | null; empresa: string | null; documento: string | null }[] }>(
  api('/api/admin/contatos'),
  {
    query: computed(() => ({ busca: buscaAtrasada.value, limite: 8 })),
    immediate: false,
    watch: false,
    server: false
  }
)
watch(buscaAtrasada, v => { if (v) buscarContatos() })
function adicionarContato(c: { email: string; nome: string | null; empresa: string | null; documento: string | null }) {
  if (destinatarios.value.some(d => d.email.trim().toLowerCase() === c.email)) {
    toast.add({ title: `${c.email} já está na lista`, color: 'neutral' })
    return
  }
  adicionarLinha({ email: c.email, nome: c.nome ?? '', empresa: c.empresa ?? '', documento: c.documento ?? '' })
  busca.value = ''
}

// lista salva: acrescenta os contatos dela (quem ja esta fica como esta)
const { data: listasSalvas } = await useFetch<ResumoLista[]>(api('/api/admin/listas'), { default: () => [], server: false })
const carregandoLista = ref(false)
async function usarLista(idLista: number) {
  carregandoLista.value = true
  try {
    const l = await $fetch<DetalheLista>(api(`/api/admin/listas/${idLista}`))
    let n = 0
    for (const m of l.membros) {
      if (m.suprimido || destinatarios.value.some(d => d.email.trim().toLowerCase() === m.email)) continue
      adicionarLinha({ email: m.email, nome: m.nome ?? '', empresa: m.empresa ?? '', documento: m.documento ?? '' })
      n++
    }
    const fora = l.membros.filter(m => m.suprimido).length
    toast.add({
      title: `${n} cliente(s) da lista "${l.nome}"`,
      description: fora ? `${fora} ficaram de fora: o e-mail já devolveu antes.` : undefined,
      color: n ? 'success' : 'warning'
    })
  } catch (e: any) {
    toast.add({ title: 'Não foi possível abrir a lista', description: e?.data?.statusMessage || e?.statusMessage, color: 'error' })
  } finally {
    carregandoLista.value = false
  }
}

// colar da planilha: uma linha por cliente, colunas em qualquer ordem
const modalColar = ref(false)
const textoColado = ref('')
function importarColado() {
  let n = 0
  for (const linha of textoColado.value.split(/\r?\n/)) {
    const cols = linha.split(/\t|;/).map(c => c.trim()).filter(Boolean)
    const email = cols.find(c => emailValido(c))
    if (!email) continue
    const documento = cols.find(c => [11, 14].includes(c.replace(/\D/g, '').length) && !/[a-z]/i.test(c)) ?? ''
    const textos = cols.filter(c => c !== email && c !== documento)
    if (destinatarios.value.some(d => d.email.trim().toLowerCase() === email.toLowerCase())) continue
    adicionarLinha({ email: email.toLowerCase(), documento, nome: textos[0] ?? '', empresa: textos[1] ?? '' })
    n++
  }
  modalColar.value = false
  textoColado.value = ''
  toast.add({ title: n ? `${n} cliente(s) adicionado(s)` : 'Nenhuma linha com e-mail encontrada', color: n ? 'success' : 'warning' })
}

/* ---------- 4. mensagem e envio ---------- */
const mensagem = ref('')
const prazo = ref('')
const lembretes = ref(true)
const avisarConclusao = ref(true)

const { data: contasData } = await useFetch<RespostaContas>(api('/api/admin/contas'), { lazy: true, server: false })
const contasAtivas = computed(() => (contasData.value?.contas ?? []).filter(c => c.ativa))
const contaId = ref<number>(0)
watch(contasAtivas, cs => {
  if (!contaId.value) contaId.value = cs.find(c => c.padrao)?.id ?? cs[0]?.id ?? 0
}, { immediate: true })
const contaEscolhida = computed(() => contasAtivas.value.find(c => c.id === contaId.value) || null)
const itensConta = computed(() => contasAtivas.value.map(c => ({ label: c.padrao ? `${c.nome} (padrão)` : c.nome, value: c.id })))

/**
 * Respostas para: numa solicitação o cliente costuma responder com dúvida
 * sobre um documento — faz sentido cair com quem pediu. Por isso o padrão é o
 * e-mail da própria pessoa, quando o painel o informa.
 */
const meuEmail = computed(() => sessao.value?.usuario?.email ?? null)
const respostaModo = ref<'meu' | 'canal' | 'outro'>('canal')
watch(meuEmail, e => { if (e) respostaModo.value = 'meu' }, { immediate: true })
const respostaOutro = ref('')
const itensResposta = computed(() => [
  ...(meuEmail.value ? [{ label: `Para mim — ${meuEmail.value}`, value: 'meu' }] : []),
  {
    label: contaEscolhida.value
      ? `O do canal — ${contaEscolhida.value.responderPara || contaEscolhida.value.remetente}`
      : 'O do canal',
    value: 'canal'
  },
  { label: 'Outro endereço…', value: 'outro' }
])
const responderPara = computed(() =>
  respostaModo.value === 'meu' ? meuEmail.value : respostaModo.value === 'outro' ? respostaOutro.value.trim() || null : null
)
const respostaInvalida = computed(() => respostaModo.value === 'outro' && !emailValido(respostaOutro.value))

const hoje = dataSP()
const prazoInvalido = computed(() => !!prazo.value && prazo.value < hoje)
const envioValido = computed(() => titulo.value.trim().length >= 3 && !respostaInvalida.value && !prazoInvalido.value)

/* ---------- navegação ---------- */
const podeAvancar = computed(() => [true, itensValidos.value, destinatariosValidos.value.length > 0 && !destinatariosComErro.value, envioValido.value][passo.value])
const alcancavel = (n: number) => n === 0 || (n <= 1 ? true : n === 2 ? itensValidos.value : itensValidos.value && destinatariosValidos.value.length > 0)

/* ---------- prévia e confirmação ---------- */
const previa = ref<{ assunto: string; html: string } | null>(null)
const carregandoPrevia = ref(false)
async function verPrevia() {
  carregandoPrevia.value = true
  try {
    const d = destinatariosValidos.value[0]
    previa.value = await $fetch(api('/api/admin/solicitacoes/previa'), {
      method: 'POST',
      body: {
        titulo: titulo.value,
        mensagem: mensagem.value || null,
        prazo: prazo.value || null,
        itens: itens.value,
        destinatario: d ? { nome: d.nome || null, email: d.email, empresa: d.empresa || null } : null
      }
    })
  } catch (e: any) {
    toast.add({ title: 'Não foi possível montar a prévia', description: e?.data?.statusMessage, color: 'error' })
  } finally {
    carregandoPrevia.value = false
  }
}

const confirmando = ref(false)
const conferi = ref(false)
const enviando = ref(false)
function revisar() {
  conferi.value = false
  confirmando.value = true
}
const obrigatorios = computed(() => itens.value.filter(i => i.obrigatorio).length)

async function enviar() {
  enviando.value = true
  try {
    const r = await $fetch<{ ids: number[] }>(api('/api/admin/solicitacoes'), {
      method: 'POST',
      body: {
        titulo: titulo.value,
        mensagem: mensagem.value || null,
        checklistId: checklistId.value,
        prazo: prazo.value || null,
        lembretes: lembretes.value,
        avisarConclusao: avisarConclusao.value,
        contaId: contaId.value || null,
        responderPara: responderPara.value,
        itens: itens.value,
        destinatarios: destinatariosValidos.value.map(d => ({
          nome: d.nome.trim() || null,
          email: d.email.trim(),
          documento: d.documento || null,
          empresa: d.empresa.trim() || null
        }))
      }
    })
    toast.add({
      title: r.ids.length === 1 ? 'Solicitação enviada' : `${r.ids.length} solicitações criadas`,
      description: r.ids.length === 1 ? 'O cliente recebe o e-mail em instantes.' : 'Os e-mails saem um a um, em segundo plano.',
      color: 'success',
      icon: 'i-lucide-send'
    })
    await navigateTo(r.ids.length === 1 ? `/admin/solicitacoes/${r.ids[0]}` : '/admin/solicitacoes')
  } catch (e: any) {
    toast.add({ title: 'Não foi possível enviar', description: e?.data?.statusMessage || e?.statusMessage, color: 'error' })
  } finally {
    enviando.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-5xl space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">Nova solicitação de documentos</h1>
        <p class="text-sm text-muted">O cliente recebe um link, envia cada documento e você analisa aqui.</p>
      </div>
      <UButton to="/admin/solicitacoes" label="Voltar" icon="i-lucide-arrow-left" color="neutral" variant="ghost" />
    </div>

    <!-- passos -->
    <ol class="grid grid-cols-4 gap-2">
      <li v-for="(p, n) in PASSOS" :key="p.titulo">
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-50"
          :class="n === passo ? 'border-primary bg-primary/10 text-primary' : 'border-default bg-default hover:bg-elevated'"
          :disabled="!alcancavel(n)"
          @click="passo = n"
        >
          <UIcon :name="n < passo ? 'i-lucide-circle-check' : p.icone" class="size-4 shrink-0" />
          <span class="hidden truncate sm:inline">{{ p.titulo }}</span>
          <span class="sm:hidden">{{ n + 1 }}</span>
        </button>
      </li>
    </ol>

    <!-- 1. o que pedir -->
    <section v-if="passo === 0" class="space-y-5">
      <p class="text-sm text-muted">Comece de um modelo pronto ou monte a lista do zero. Os itens podem ser ajustados no próximo passo.</p>
      <button
        type="button"
        class="flex w-full items-center gap-3 rounded-lg border border-dashed border-default bg-default p-4 text-left transition hover:border-primary hover:bg-elevated"
        @click="escolherModelo(null)"
      >
        <UIcon name="i-lucide-file-plus-2" class="size-6 text-muted" />
        <div>
          <p class="font-medium">Em branco</p>
          <p class="text-sm text-muted">Monte a lista de documentos do zero.</p>
        </div>
      </button>
      <div v-for="[setor, lista] in porSetor" :key="setor" class="space-y-2">
        <h2 class="text-xs font-semibold uppercase tracking-wide text-muted">{{ setor }}</h2>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <button
            v-for="m in lista"
            :key="m.id"
            type="button"
            class="flex flex-col gap-1 rounded-lg border bg-default p-4 text-left transition hover:border-primary hover:bg-elevated"
            :class="checklistId === m.id ? 'border-primary' : 'border-default'"
            @click="escolherModelo(m)"
          >
            <p class="font-medium">{{ m.nome }}</p>
            <p v-if="m.descricao" class="line-clamp-2 text-sm text-muted">{{ m.descricao }}</p>
            <p class="mt-1 text-xs text-muted">
              {{ m.itens.length }} documento(s) · {{ m.itens.filter(i => i.obrigatorio).length }} obrigatório(s)
            </p>
          </button>
        </div>
      </div>
      <p class="text-xs text-muted">
        Os modelos são mantidos em
        <NuxtLink to="/admin/solicitacoes/modelos" class="text-primary hover:underline">Modelos de checklist</NuxtLink>.
      </p>
    </section>

    <!-- 2. documentos -->
    <section v-else-if="passo === 1" class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-sm text-muted">
          {{ itens.length }} documento(s) · {{ obrigatorios }} obrigatório(s). Abra os detalhes de um item para mudar formatos, quantidade e instrução.
        </p>
        <UButton
          label="Salvar como modelo"
          icon="i-lucide-bookmark-plus"
          color="neutral"
          variant="outline"
          size="sm"
          :disabled="!itensValidos"
          @click="novoModelo.nome = titulo; modalModelo = true"
        />
      </div>
      <EditorItensSolic v-model="itens" />
    </section>

    <!-- 3. para quem -->
    <section v-else-if="passo === 2" class="space-y-4">
      <div class="flex flex-wrap items-end gap-2">
        <UFormField label="Buscar nos contatos" class="min-w-64 flex-1" help="Quem já recebeu algum envio por aqui.">
          <UInput v-model="busca" icon="i-lucide-search" placeholder="Nome, e-mail ou empresa" class="w-full" />
        </UFormField>
        <UButton label="Colar da planilha" icon="i-lucide-clipboard-paste" color="neutral" variant="outline" @click="modalColar = true" />
        <UDropdownMenu
          :items="listasSalvas.length
            ? listasSalvas.map(l => ({ label: `${l.nome} (${l.total})`, icon: 'i-lucide-list', onSelect: () => usarLista(l.id) }))
            : [{ label: 'Nenhuma lista salva', disabled: true }]"
        >
          <UButton label="Lista salva" icon="i-lucide-list" trailing-icon="i-lucide-chevron-down" color="neutral" variant="outline" :loading="carregandoLista" />
        </UDropdownMenu>
      </div>
      <div v-if="busca.trim().length >= 2" class="rounded-lg border border-default bg-default">
        <p v-if="statusBusca === 'pending'" class="p-3 text-sm text-muted">Buscando…</p>
        <p v-else-if="!achados?.contatos.length" class="p-3 text-sm text-muted">Nenhum contato encontrado. Digite os dados na lista abaixo.</p>
        <button
          v-for="c in achados?.contatos"
          v-else
          :key="c.email"
          type="button"
          class="flex w-full items-center gap-3 border-b border-default px-3 py-2 text-left text-sm last:border-0 hover:bg-elevated"
          @click="adicionarContato(c)"
        >
          <UIcon name="i-lucide-user-plus" class="size-4 text-primary" />
          <span class="min-w-0 flex-1 truncate">{{ c.nome || c.email }} <span class="text-muted">· {{ c.email }}</span></span>
          <span v-if="c.empresa" class="hidden truncate text-xs text-muted sm:inline">{{ c.empresa }}</span>
        </button>
      </div>

      <UCard :ui="{ body: 'p-0 sm:p-0' }">
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-elevated/50 text-left text-xs uppercase text-muted">
              <tr>
                <th class="px-3 py-2">E-mail *</th>
                <th class="px-3 py-2">Nome</th>
                <th class="px-3 py-2">CPF/CNPJ</th>
                <th class="px-3 py-2">Empresa</th>
                <th class="w-10" />
              </tr>
            </thead>
            <tbody>
              <tr v-for="(d, i) in destinatarios" :key="i" class="border-t border-default">
                <td class="min-w-56 px-2 py-1.5">
                  <UInput v-model="d.email" type="email" placeholder="cliente@empresa.com.br" class="w-full" :color="d.email && !emailValido(d.email) ? 'error' : undefined" :highlight="!!d.email && !emailValido(d.email)" />
                </td>
                <td class="min-w-44 px-2 py-1.5"><UInput v-model="d.nome" placeholder="Nome" class="w-full" /></td>
                <td class="min-w-40 px-2 py-1.5">
                  <UInput v-model="d.documento" placeholder="Só números" class="w-full" :color="!docValido(d.documento) ? 'error' : undefined" :highlight="!docValido(d.documento)" />
                </td>
                <td class="min-w-44 px-2 py-1.5"><UInput v-model="d.empresa" placeholder="Empresa" class="w-full" /></td>
                <td class="px-2 py-1.5">
                  <UButton icon="i-lucide-x" color="neutral" variant="ghost" size="sm" aria-label="Tirar da lista" @click="removerLinha(i)" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <template #footer>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <UButton label="Adicionar cliente" icon="i-lucide-plus" color="neutral" variant="ghost" size="sm" @click="adicionarLinha()" />
            <p class="text-xs text-muted">
              {{ destinatariosValidos.length }} cliente(s) pronto(s)
              <span v-if="destinatariosComErro" class="text-error"> · {{ destinatariosComErro }} com e-mail ou CPF/CNPJ inválido</span>
            </p>
          </div>
        </template>
      </UCard>
      <p class="text-xs text-muted">
        O CPF/CNPJ organiza a pasta do cliente (clientes/&lt;CPF-ou-CNPJ&gt;_&lt;nome&gt;/…). Sem ele, a pasta sai do e-mail.
        Cada cliente recebe uma solicitação própria, com link próprio.
      </p>
    </section>

    <!-- 4. mensagem e envio -->
    <section v-else class="grid gap-6 lg:grid-cols-5">
      <div class="space-y-4 lg:col-span-3">
        <UFormField label="Título" required help="Aparece no assunto do e-mail e no topo da página do cliente.">
          <UInput v-model="titulo" placeholder="Ex.: Documentos para a abertura da empresa" class="w-full" />
        </UFormField>
        <UFormField label="Mensagem (opcional)" help="Vazio usa um texto padrão. A lista de documentos entra sozinha logo abaixo.">
          <UTextarea v-model="mensagem" :rows="4" autoresize class="w-full" :placeholder="`A Contábil Gaulke precisa de alguns documentos para dar andamento a: ${titulo || '…'}.`" />
        </UFormField>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Prazo (opcional)" :error="prazoInvalido ? 'O prazo não pode estar no passado' : undefined">
            <UInput v-model="prazo" type="date" :min="hoje" class="w-full" />
          </UFormField>
          <div class="space-y-3 pt-1">
            <USwitch v-model="lembretes" label="Lembretes automáticos" description="A cada 3 dias sem entrega, até 3 vezes, em dia útil." />
            <USwitch v-model="avisarConclusao" label="Avisar o cliente ao concluir" description="“Recebemos tudo, obrigado.”" />
          </div>
        </div>
      </div>
      <div class="space-y-4 lg:col-span-2">
        <UFormField label="Sai por (canal)" :help="contaEscolhida ? `De ${contaEscolhida.remetente}` : 'Nenhum canal: usa o SMTP do .env.'">
          <USelect v-if="itensConta.length" v-model="contaId" :items="itensConta" class="w-full" />
        </UFormField>
        <UFormField label="Respostas para">
          <USelect v-model="respostaModo" :items="itensResposta" class="w-full" />
        </UFormField>
        <UInput
          v-if="respostaModo === 'outro'"
          v-model="respostaOutro"
          type="email"
          placeholder="setor@contabilgaulke.com.br"
          class="w-full"
          :color="respostaInvalida && respostaOutro ? 'error' : undefined"
        />
        <UButton label="Ver o e-mail" icon="i-lucide-eye" color="neutral" variant="outline" block :loading="carregandoPrevia" @click="verPrevia" />
      </div>
    </section>

    <!-- rodapé do passo -->
    <div v-if="passo > 0" class="flex items-center justify-between border-t border-default pt-4">
      <UButton label="Voltar" icon="i-lucide-arrow-left" color="neutral" variant="ghost" @click="passo--" />
      <UButton v-if="passo < 3" label="Continuar" trailing-icon="i-lucide-arrow-right" :disabled="!podeAvancar" @click="passo++" />
      <UButton v-else label="Revisar e enviar" icon="i-lucide-send" :disabled="!podeAvancar" @click="revisar" />
    </div>

    <!-- salvar como modelo -->
    <UModal v-model:open="modalModelo" title="Salvar como modelo de checklist" description="Fica disponível no primeiro passo para o setor escolhido.">
      <template #body>
        <div class="space-y-4">
          <UFormField label="Nome do modelo" required>
            <UInput v-model="novoModelo.nome" class="w-full" />
          </UFormField>
          <UFormField label="Setor">
            <USelect v-model="novoModelo.setor" :items="setores.opcoes.value" class="w-full" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Cancelar" color="neutral" variant="ghost" @click="modalModelo = false" />
          <UButton label="Salvar modelo" icon="i-lucide-bookmark-plus" :loading="salvandoModelo" :disabled="novoModelo.nome.trim().length < 3" @click="salvarComoModelo" />
        </div>
      </template>
    </UModal>

    <!-- colar da planilha -->
    <UModal v-model:open="modalColar" title="Colar da planilha" description="Uma linha por cliente. As colunas podem vir em qualquer ordem: o e-mail e o CPF/CNPJ são reconhecidos sozinhos; o primeiro texto vira o nome e o segundo, a empresa.">
      <template #body>
        <UTextarea v-model="textoColado" :rows="10" class="w-full font-mono text-xs" placeholder="Maria Souza	maria@empresa.com.br	12345678000190	Empresa X" />
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Cancelar" color="neutral" variant="ghost" @click="modalColar = false" />
          <UButton label="Adicionar" icon="i-lucide-user-plus" :disabled="!textoColado.trim()" @click="importarColado" />
        </div>
      </template>
    </UModal>

    <!-- prévia do e-mail -->
    <UModal :open="!!previa" :title="previa?.assunto" description="Prévia com o primeiro cliente da lista." :ui="{ content: 'sm:max-w-3xl' }" @update:open="v => { if (!v) previa = null }">
      <template #body>
        <iframe v-if="previa" :srcdoc="previa.html" sandbox="" class="h-[70vh] w-full rounded-lg border border-default bg-white" title="Prévia do e-mail" />
      </template>
    </UModal>

    <!-- confirmação -->
    <UModal v-model:open="confirmando" title="Conferir antes de enviar" :ui="{ content: 'sm:max-w-2xl' }">
      <template #body>
        <dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
          <dt class="text-muted">Título</dt>
          <dd class="font-medium">{{ titulo }}</dd>
          <dt class="text-muted">Clientes</dt>
          <dd>
            {{ destinatariosValidos.length }}
            <span class="text-muted">— {{ destinatariosValidos.slice(0, 4).map(d => d.nome || d.email).join(', ') }}{{ destinatariosValidos.length > 4 ? '…' : '' }}</span>
          </dd>
          <dt class="text-muted">Documentos</dt>
          <dd>{{ itens.length }} ({{ obrigatorios }} obrigatório(s), {{ itens.length - obrigatorios }} opcional(is))</dd>
          <dt class="text-muted">Prazo</dt>
          <dd>{{ prazo ? formatarPrazo(prazo) : 'sem prazo' }}</dd>
          <dt class="text-muted">Sai por</dt>
          <dd>{{ contaEscolhida ? `${contaEscolhida.nome} (${contaEscolhida.remetente})` : 'SMTP do .env' }}</dd>
          <dt class="text-muted">Respostas para</dt>
          <dd>{{ responderPara || contaEscolhida?.responderPara || contaEscolhida?.remetente || '—' }}</dd>
          <dt class="text-muted">Lembretes</dt>
          <dd>{{ lembretes ? 'sim, a cada 3 dias (até 3)' : 'não' }}</dd>
        </dl>
        <UCheckbox v-model="conferi" class="mt-6" label="Conferi os documentos, os clientes e os e-mails." />
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Voltar" color="neutral" variant="ghost" @click="confirmando = false" />
          <UButton
            :label="destinatariosValidos.length === 1 ? 'Enviar pedido' : `Enviar para ${destinatariosValidos.length} clientes`"
            icon="i-lucide-send"
            :disabled="!conferi"
            :loading="enviando"
            @click="enviar"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
