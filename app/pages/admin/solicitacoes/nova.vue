<script setup lang="ts">
definePageMeta({ layout: 'admin' })
useHead({ title: 'Nova solicitação — Gaulke Comunica' })

/**
 * Pedido de documentos em quatro passos: o que pedir (modelo de checklist ou
 * em branco), os itens (documentos e perguntas), para quem, e a mensagem com prazo e canal. Cada
 * cliente vira uma solicitação própria, com link próprio.
 */
const toast = useToast()
const { sessao } = usePapel()
const setores = useDepartamentos()

const PASSOS = [
  { titulo: 'O que pedir', icone: 'i-lucide-list-checks' },
  { titulo: 'Itens', icone: 'i-lucide-files' },
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
  itens.value = m ? copiarItens(m.itens) : []
  if (m && (!titulo.value || modelos.value.some(x => x.nome === titulo.value))) titulo.value = m.nome
  passo.value = 1
}

/* ---------- 2. itens ---------- */
const itensValidos = computed(() => itens.value.length > 0 && itens.value.every(itemCompleto))
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
// o mesmo seletor do lote: empresa (com os e-mails ja usados), planilha,
// lista salva, envios anteriores, colar e o cadastro do sistema
const carrinho = ref<Record<string, ItemDestinatario>>({})
const destinatariosValidos = computed(() => Object.values(carrinho.value))
const destinatariosComErro = computed(() => destinatariosValidos.value.filter(d => d.documento && d.documento.length !== 11 && d.documento.length !== 14).length)

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
const emailValido = (e: string) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(e.trim())
const respostaInvalida = computed(() => respostaModo.value === 'outro' && !emailValido(respostaOutro.value))

const hoje = dataSP()
const prazoInvalido = computed(() => !!prazo.value && prazo.value < hoje)
const envioValido = computed(() => titulo.value.trim().length >= 3 && !respostaInvalida.value && !prazoInvalido.value)

/* ---------- navegação ---------- */
const podeAvancar = computed(() => [true, itensValidos.value, destinatariosValidos.value.length > 0 && !destinatariosComErro.value, envioValido.value][passo.value])
const alcancavel = (n: number) => n === 0 || (n <= 1 ? true : n === 2 ? itensValidos.value : itensValidos.value && destinatariosValidos.value.length > 0)

/* ---------- envio de teste ---------- */
// vai para quem esta montando, por padrao; da para trocar
const emailTeste = ref('')
watch(meuEmail, v => { if (!emailTeste.value && v) emailTeste.value = v }, { immediate: true })
const enviandoTeste = ref(false)
async function enviarTeste() {
  enviandoTeste.value = true
  try {
    const d = destinatariosValidos.value[0]
    await $fetch(api('/api/admin/solicitacoes/teste'), {
      method: 'POST',
      body: {
        para: emailTeste.value,
        titulo: titulo.value,
        mensagem: mensagem.value || null,
        prazo: prazo.value || null,
        contaId: contaId.value || null,
        responderPara: responderPara.value,
        itens: itens.value,
        destinatario: d ? { nome: d.nome || null, empresa: d.empresa || null } : null
      }
    })
    toast.add({ title: `Teste enviado para ${emailTeste.value}`, description: 'Confira a caixa de entrada (e o spam). O link do teste não abre nenhuma solicitação.', color: 'success', icon: 'i-lucide-mail-check' })
  } catch (e: any) {
    toast.add({ title: 'Não foi possível enviar o teste', description: e?.data?.statusMessage || e?.statusMessage, color: 'error' })
  } finally {
    enviandoTeste.value = false
  }
}

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
          email: d.email,
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
        <h1 class="text-2xl font-semibold">Nova solicitação</h1>
        <p class="text-sm text-muted">O cliente recebe um link, envia os documentos e responde as perguntas, e você analisa aqui.</p>
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
          <p class="text-sm text-muted">Monte a lista de itens do zero.</p>
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
              {{ m.itens.length }} item(ns) · {{ m.itens.filter(i => i.obrigatorio).length }} obrigatório(s)
            </p>
          </button>
        </div>
      </div>
      <p class="text-xs text-muted">
        Os modelos são mantidos em
        <NuxtLink to="/admin/solicitacoes/modelos" class="text-primary hover:underline">Modelos de checklist</NuxtLink>.
      </p>
    </section>

    <!-- 2. itens -->
    <section v-else-if="passo === 1" class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-sm text-muted">
          {{ itens.length }} item(ns) · {{ obrigatorios }} obrigatório(s). Escolha o tipo em “Adicionar item” e abra os detalhes para configurar.
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
      <UCard>
        <SeletorDestinatarios
          v-model="carrinho"
          :origens="['empresa', 'banco', 'lista', 'manual', 'arquivo', 'sistema']"
          rotulo="pedido"
          :limite="500"
          editavel
        />
      </UCard>
      <p class="text-xs text-muted">
        O CPF/CNPJ organiza a pasta do cliente (clientes/&lt;CPF-ou-CNPJ&gt;_&lt;nome&gt;/…) e ensina ao sistema qual e-mail recebe por aquela empresa.
        Cada cliente recebe uma solicitação própria, com link próprio.
        <span v-if="destinatariosComErro" class="text-error"> · {{ destinatariosComErro }} com CPF/CNPJ incompleto.</span>
      </p>
    </section>

    <!-- 4. mensagem e envio -->
    <section v-else class="grid gap-6 lg:grid-cols-5">
      <div class="space-y-4 lg:col-span-3">
        <UFormField label="Título" required help="Aparece no assunto do e-mail e no topo da página do cliente.">
          <UInput v-model="titulo" placeholder="Ex.: Documentos para a abertura da empresa" class="w-full" />
        </UFormField>
        <UFormField label="Mensagem (opcional)" help="Vazio usa um texto padrão. A lista de itens entra sozinha logo abaixo.">
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
        <UFormField label="Enviar um teste" help="Chega como o cliente vai receber, com [TESTE] no assunto, pelo canal escolhido acima.">
          <div class="flex gap-2">
            <UInput
              v-model="emailTeste"
              type="email"
              icon="i-lucide-at-sign"
              placeholder="seu@contabilgaulke.com.br"
              class="min-w-0 flex-1"
              :color="emailTeste && !emailValido(emailTeste) ? 'error' : undefined"
              @keydown.enter.prevent="emailValido(emailTeste) && enviarTeste()"
            />
            <UButton label="Enviar teste" icon="i-lucide-send" color="neutral" variant="outline" :loading="enviandoTeste" :disabled="!emailValido(emailTeste)" @click="enviarTeste" />
          </div>
        </UFormField>
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
        <UCheckbox v-model="conferi" class="mt-6" label="Conferi os itens, os clientes e os e-mails." />
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
