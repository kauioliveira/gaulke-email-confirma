<script setup lang="ts">
definePageMeta({ layout: 'admin' })
useHead({ title: 'Modelos de checklist — Gaulke Comunica' })

/**
 * Modelos de checklist: a lista de itens (documentos e perguntas) pronta para "Abertura de
 * empresa", "Admissão", "IRPF"... Editar um modelo não muda as solicitações
 * já enviadas: cada uma guardou a sua cópia.
 *
 * Cada modelo é de um setor (ou de todos); fora o admin, aparecem só os do
 * próprio setor e os de todos.
 */
const toast = useToast()
const { pode } = usePapel()
const setores = useDepartamentos()
const mostrarArquivados = ref(false)
const { data: modelos, refresh } = await useFetch<ModeloChecklist[]>(api('/api/admin/checklists'), {
  query: computed(() => ({ todos: mostrarArquivados.value ? '1' : undefined })),
  default: () => []
})

const porSetor = computed(() => {
  const g = new Map<string, ModeloChecklist[]>()
  for (const m of modelos.value) g.set(m.setor || 'Todos os setores', [...(g.get(m.setor || 'Todos os setores') ?? []), m])
  return [...g]
})

const editando = ref<{ id: number | null; nome: string; descricao: string; setor: string; itens: ItemModeloChecklist[] } | null>(null)
const salvando = ref(false)

/**
 * Alteracao nao salva: o painel nao fecha sem perguntar (clique fora, Esc,
 * Cancelar, sair da pagina). Compara com uma foto tirada ao abrir.
 */
const original = ref('')
const alterado = computed(() => !!editando.value && JSON.stringify(editando.value) !== original.value)
const perguntaDescartar = ref(false)

function abrir(dados: NonNullable<typeof editando.value>) {
  editando.value = dados
  original.value = JSON.stringify(dados)
}
function novo() {
  abrir({ id: null, nome: '', descricao: '', setor: setores.padrao.value, itens: [] })
}
function editar(m: ModeloChecklist) {
  abrir({
    id: m.id,
    nome: m.nome,
    descricao: m.descricao ?? '',
    setor: setores.paraValor(m.departamentoId),
    itens: copiarItens(m.itens)
  })
}
function fechar() {
  if (alterado.value) perguntaDescartar.value = true
  else editando.value = null
}
function descartar() {
  perguntaDescartar.value = false
  editando.value = null
}
async function salvarEFechar() {
  perguntaDescartar.value = false
  await salvar()
}

// fechar a aba ou recarregar com alteracao pendente: o navegador pergunta
function avisoAoSair(e: BeforeUnloadEvent) {
  if (!alterado.value) return
  e.preventDefault()
  e.returnValue = ''
}
onMounted(() => window.addEventListener('beforeunload', avisoAoSair))
onBeforeUnmount(() => window.removeEventListener('beforeunload', avisoAoSair))
// navegar para outra tela do painel
onBeforeRouteLeave(() => {
  if (!alterado.value) return true
  return confirm('O modelo tem alterações não salvas. Sair e perder as alterações?')
})
const valido = computed(
  () => !!editando.value && editando.value.nome.trim().length >= 3 && editando.value.itens.length > 0 && editando.value.itens.every(itemCompleto)
)

async function salvar() {
  const e = editando.value
  if (!e) return
  salvando.value = true
  try {
    const body = { nome: e.nome, descricao: e.descricao || null, departamentoId: setores.paraId(e.setor), itens: e.itens }
    if (e.id) await $fetch(api(`/api/admin/checklists/${e.id}`), { method: 'PUT', body })
    else await $fetch(api('/api/admin/checklists'), { method: 'POST', body })
    toast.add({ title: 'Modelo salvo', color: 'success' })
    editando.value = null
    await refresh()
  } catch (err: any) {
    toast.add({ title: 'Não foi possível salvar', description: err?.data?.statusMessage || err?.statusMessage, color: 'error' })
  } finally {
    salvando.value = false
  }
}

async function arquivar(m: ModeloChecklist, restaurar = false) {
  try {
    await $fetch(api(`/api/admin/checklists/${m.id}${restaurar ? '?restaurar=1' : ''}`), { method: 'DELETE' })
    toast.add({ title: restaurar ? 'Modelo restaurado' : 'Modelo arquivado', color: 'success' })
    await refresh()
  } catch (err: any) {
    toast.add({ title: 'Não foi possível', description: err?.data?.statusMessage || err?.statusMessage, color: 'error' })
  }
}
</script>

<template>
  <div class="mx-auto max-w-5xl space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <NuxtLink to="/admin/solicitacoes" class="text-sm text-muted hover:text-primary">
          <UIcon name="i-lucide-arrow-left" class="mr-1 size-3.5 align-[-2px]" />Solicitações
        </NuxtLink>
        <h1 class="mt-1 text-2xl font-semibold">Modelos de checklist</h1>
        <p class="text-sm text-muted">Listas prontas de documentos e perguntas, para não montar do zero a cada pedido.</p>
      </div>
      <div class="flex items-center gap-3">
        <USwitch v-model="mostrarArquivados" label="Mostrar arquivados" />
        <UButton label="Novo modelo" icon="i-lucide-plus" @click="novo" />
      </div>
    </div>

    <div v-for="[setor, lista] in porSetor" :key="setor" class="space-y-2">
      <h2 class="text-xs font-semibold uppercase tracking-wide text-muted">{{ setor }}</h2>
      <UCard v-for="m in lista" :key="m.id" :class="{ 'opacity-60': !m.ativo }">
        <div class="flex flex-wrap items-start gap-3">
          <div class="min-w-0 flex-1">
            <p class="font-medium">
              {{ m.nome }}
              <UBadge v-if="!m.ativo" color="neutral" variant="subtle" size="sm" class="ml-1">arquivado</UBadge>
            </p>
            <p v-if="m.descricao" class="text-sm text-muted">{{ m.descricao }}</p>
            <p class="mt-2 text-xs text-muted">
              {{ m.itens.filter(i => i.tipo !== 'informativo').map(i => i.titulo + (i.obrigatorio ? '' : ' (opcional)')).join(' · ') }}
            </p>
            <p class="mt-1 text-xs text-muted">
              Usado em {{ m.usos }} solicitação(ões) · atualizado por {{ m.atualizadoPorNome || '—' }} em {{ formatarData(m.updatedAt) }}
            </p>
          </div>
          <div class="flex gap-1">
            <UButton v-if="m.ativo" label="Editar" icon="i-lucide-pencil" color="neutral" variant="ghost" size="sm" @click="editar(m)" />
            <UTooltip
              v-if="m.ativo"
              :text="m.usos > 0 && !pode('supervisor') ? 'Já usado: só supervisores e administradores arquivam' : 'Sai da lista de escolha; nada é apagado'"
            >
              <UButton label="Arquivar" icon="i-lucide-archive" color="neutral" variant="ghost" size="sm" :disabled="m.usos > 0 && !pode('supervisor')" @click="arquivar(m)" />
            </UTooltip>
            <UButton v-else label="Restaurar" icon="i-lucide-archive-restore" color="neutral" variant="ghost" size="sm" @click="arquivar(m, true)" />
          </div>
        </div>
      </UCard>
    </div>
    <p v-if="!modelos.length" class="py-10 text-center text-sm text-muted">Nenhum modelo ainda.</p>

    <USlideover
      :open="!!editando"
      :title="editando?.id ? 'Editar modelo' : 'Novo modelo'"
      description="As solicitações já enviadas não mudam: cada uma guardou a sua cópia."
      :ui="{ content: 'sm:max-w-2xl' }"
      :dismissible="!alterado"
      @update:open="v => { if (!v) fechar() }"
      @close:prevent="fechar"
    >
      <template #body>
        <div v-if="editando" class="space-y-4">
          <div class="grid gap-4 sm:grid-cols-3">
            <UFormField label="Nome" required class="sm:col-span-2">
              <UInput v-model="editando.nome" class="w-full" placeholder="Ex.: Abertura de empresa" />
            </UFormField>
            <UFormField label="Setor">
              <USelect v-model="editando.setor" :items="setores.opcoes.value" class="w-full" />
            </UFormField>
          </div>
          <UFormField label="Descrição">
            <UInput v-model="editando.descricao" class="w-full" placeholder="Quando usar este modelo" />
          </UFormField>
          <EditorItensSolic v-model="editando.itens" />
        </div>
      </template>
      <template #footer>
        <div class="flex w-full items-center justify-end gap-2">
          <span v-if="alterado" class="mr-auto flex items-center gap-1.5 text-xs text-warning">
            <span class="size-2 rounded-full bg-warning" />Alterações não salvas
          </span>
          <UButton label="Cancelar" color="neutral" variant="ghost" @click="fechar" />
          <UButton label="Salvar modelo" icon="i-lucide-save" :disabled="!valido" :loading="salvando" @click="salvar" />
        </div>
      </template>
    </USlideover>

    <UModal
      v-model:open="perguntaDescartar"
      title="Você tem alterações não salvas"
      :description="editando?.id ? `As mudanças no modelo “${editando.nome}” serão perdidas se você sair agora.` : 'O modelo novo será perdido se você sair agora.'"
    >
      <template #body>
        <p v-if="!valido" class="text-sm text-warning">
          <UIcon name="i-lucide-triangle-alert" class="mr-1 align-[-2px]" />Para salvar, o modelo precisa de nome (3+ letras) e de itens completos.
        </p>
      </template>
      <template #footer>
        <div class="flex w-full flex-wrap justify-end gap-2">
          <UButton label="Continuar editando" color="neutral" variant="ghost" @click="perguntaDescartar = false" />
          <UButton label="Descartar" icon="i-lucide-trash-2" color="error" variant="soft" @click="descartar" />
          <UButton label="Salvar e fechar" icon="i-lucide-save" :disabled="!valido" :loading="salvando" @click="salvarEFechar" />
        </div>
      </template>
    </UModal>
  </div>
</template>
