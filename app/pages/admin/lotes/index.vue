<script setup lang="ts">
import { dataHora, CORES_STATUS } from '~/utils/formato'

definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: 'Lotes — Gaulke Envios' })

const toast = useToast()

/** O USelect (Reka UI) reserva a string vazia, então "todos" precisa de valor. */
const TODOS = 'todos'

const filtros = reactive({
  busca: '',
  status: TODOS,
  ordem: 'recentes',
  de: '',
  ate: '',
  pagina: 1,
  porPagina: 20
})

const consulta = computed(() => ({
  busca: filtros.busca || undefined,
  status: filtros.status === TODOS ? undefined : filtros.status,
  ordem: filtros.ordem,
  de: filtros.de || undefined,
  ate: filtros.ate || undefined,
  pagina: filtros.pagina,
  porPagina: filtros.porPagina
}))

const { data, refresh, status } = await useFetch<RespostaLotes>(api('/api/admin/batches'), {
  query: consulta,
  watch: [consulta]
})

// mudou o filtro, volta para a primeira página — senão a pessoa fica numa
// página que deixou de existir e a tela aparece vazia sem explicação
watch(
  () => [filtros.busca, filtros.status, filtros.ordem, filtros.de, filtros.ate],
  () => { filtros.pagina = 1 }
)

const OPCOES_STATUS = [
  { label: 'Todos os status', value: TODOS },
  { label: 'Rascunho', value: 'rascunho' },
  { label: 'Agendado', value: 'agendado' },
  { label: 'Enviando', value: 'enviando' },
  { label: 'Pausado', value: 'pausado' },
  { label: 'Concluído', value: 'concluido' },
  { label: 'Erro', value: 'erro' }
]

const OPCOES_ORDEM = [
  { label: 'Mais recentes', value: 'recentes' },
  { label: 'Mais antigos', value: 'antigos' },
  { label: 'Último disparo', value: 'disparo' },
  { label: 'Última conclusão', value: 'conclusao' },
  { label: 'Mais enviados', value: 'enviados' },
  { label: 'Mais falhas', value: 'falhas' },
  { label: 'Mais destinatários', value: 'destinatarios' },
  { label: 'Nome (A–Z)', value: 'nome' }
]

/** Atalhos com a contagem real, para não clicar num filtro que não traz nada. */
const atalhos = computed(() => {
  const c = data.value?.contagemPorStatus || {}
  return (['enviando', 'agendado', 'pausado', 'erro'] as const)
    .filter(s => (c[s] || 0) > 0)
    .map(s => ({ status: s, n: c[s]! }))
})

const totalPaginas = computed(() =>
  Math.max(1, Math.ceil((data.value?.total || 0) / filtros.porPagina))
)

const filtrando = computed(
  () => !!filtros.busca || filtros.status !== TODOS || !!filtros.de || !!filtros.ate
)

function limpar() {
  Object.assign(filtros, { busca: '', status: TODOS, de: '', ate: '', pagina: 1 })
}

// enquanto houver lote rodando, atualiza a lista sozinha
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => {
    if (data.value?.lotes.some(l => l.status === 'enviando' || l.status === 'agendado')) refresh()
  }, 5000)
})
onUnmounted(() => clearInterval(timer))

async function excluir(id: number, nome: string) {
  if (!confirm(`Excluir o lote "${nome}"? Os destinatários e todo o histórico de eventos serão apagados.`)) return
  await $fetch(api(`/api/admin/batches/${id}`), { method: 'DELETE' })
  toast.add({ title: 'Lote excluído', color: 'success' })
  refresh()
}

function progresso(l: any) {
  if (!l.total) return 0
  return Math.round(((l.enviados + l.falhas) / l.total) * 100)
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">Lotes de envio</h1>
        <p class="text-sm text-muted">Acompanhe os disparos e o andamento de cada lote.</p>
      </div>
      <div class="flex gap-2">
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="outline"
          label="Atualizar"
          :loading="status === 'pending'"
          @click="refresh()"
        />
        <UButton to="/admin/lotes/novo" icon="i-lucide-plus" label="Novo envio" />
      </div>
    </div>

    <!-- Filtros -->
    <UCard>
      <div class="space-y-3">
        <div class="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
          <UFormField label="Buscar" class="lg:col-span-2">
            <UInput
              v-model="filtros.busca"
              icon="i-lucide-search"
              placeholder="Nome do lote, assunto ou arquivo"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Status">
            <USelect v-model="filtros.status" :items="OPCOES_STATUS" class="w-full" />
          </UFormField>
          <UFormField label="Ordenar por">
            <USelect v-model="filtros.ordem" :items="OPCOES_ORDEM" class="w-full" />
          </UFormField>
          <UFormField label="&nbsp;">
            <UButton
              label="Limpar filtros"
              color="neutral"
              variant="outline"
              block
              :disabled="!filtrando"
              @click="limpar"
            />
          </UFormField>
        </div>

        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <UFormField label="Criado de">
            <UInput v-model="filtros.de" type="date" class="w-full" />
          </UFormField>
          <UFormField label="Criado até">
            <UInput v-model="filtros.ate" type="date" class="w-full" />
          </UFormField>
        </div>

        <!-- Atalhos: só aparecem quando existe algo naquele status -->
        <div v-if="atalhos.length" class="flex flex-wrap items-center gap-2 border-t border-default pt-3">
          <span class="text-xs text-muted">Atalhos:</span>
          <UButton
            v-for="a in atalhos"
            :key="a.status"
            size="xs"
            :color="filtros.status === a.status ? 'primary' : 'neutral'"
            :variant="filtros.status === a.status ? 'soft' : 'outline'"
            :label="`${a.status} (${a.n})`"
            @click="filtros.status = filtros.status === a.status ? TODOS : a.status"
          />
        </div>
      </div>
    </UCard>

    <!-- Nunca criou nada -->
    <UCard v-if="!data?.total && !filtrando">
      <div class="space-y-3 py-10 text-center">
        <UIcon name="i-lucide-inbox" class="size-12 text-muted" />
        <p class="font-medium">Nenhum lote criado ainda</p>
        <p class="text-sm text-muted">Comece importando a lista de destinatários.</p>
        <UButton to="/admin/lotes/novo" icon="i-lucide-plus" label="Criar primeiro envio" class="mt-2" />
      </div>
    </UCard>

    <!-- Existe lote, mas não com esses filtros: mensagem diferente de propósito -->
    <UCard v-else-if="!data?.lotes.length">
      <div class="space-y-3 py-10 text-center">
        <UIcon name="i-lucide-search-x" class="size-12 text-muted" />
        <p class="font-medium">Nenhum lote encontrado com esses filtros</p>
        <UButton label="Limpar filtros" color="neutral" variant="outline" class="mt-2" @click="limpar" />
      </div>
    </UCard>

    <div v-else class="grid gap-4">
      <UCard v-for="l in data.lotes" :key="l.id" class="transition hover:border-primary/40">
        <div class="flex flex-wrap items-start gap-4">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <NuxtLink :to="`/admin/lotes/${l.id}`" class="truncate font-semibold hover:text-primary">
                {{ l.nome }}
              </NuxtLink>
              <UBadge :color="(CORES_STATUS[l.status] as any) || 'neutral'" variant="subtle" :label="l.status" />
              <UBadge
                v-if="l.workerAtivo"
                color="info"
                variant="subtle"
                icon="i-lucide-loader-circle"
                label="disparando"
              />
            </div>
            <p class="mt-1 truncate text-sm text-muted">{{ l.assuntoSnapshot }}</p>
            <p class="mt-1 text-xs text-muted">
              Criado em {{ dataHora(l.createdAt) }}
              <template v-if="l.criadoPorNome"> por {{ l.criadoPorNome }}</template>
              · intervalo de {{ l.intervaloMs / 1000 }}s
              <template v-if="l.arquivoNome"> · {{ l.arquivoNome }}</template>
            </p>
            <p
              v-if="l.agendadoPara && l.status === 'agendado'"
              class="mt-1 flex items-center gap-1.5 text-xs text-info"
            >
              <UIcon name="i-lucide-calendar-clock" class="size-3.5" />
              Disparo agendado para {{ dataHora(l.agendadoPara) }}
            </p>

            <div class="mt-3 max-w-md">
              <UProgress :model-value="progresso(l)" :max="100" size="sm" />
              <div class="mt-1 flex gap-4 text-xs text-muted">
                <span>{{ l.enviados }} enviados</span>
                <span v-if="l.falhas" class="text-error">{{ l.falhas }} falhas</span>
                <span>{{ l.total }} no total</span>
              </div>
            </div>
          </div>

          <div class="flex gap-2">
            <UButton
              :to="`/admin/lotes/${l.id}`"
              icon="i-lucide-arrow-right"
              color="neutral"
              variant="soft"
              label="Abrir"
            />
            <UButton
              :to="`/admin/relatorio?batchId=${l.id}`"
              icon="i-lucide-chart-no-axes-column"
              color="neutral"
              variant="ghost"
            />
            <UButton
              icon="i-lucide-trash-2"
              color="error"
              variant="ghost"
              :disabled="l.status === 'enviando'"
              @click="excluir(l.id, l.nome)"
            />
          </div>
        </div>
      </UCard>

      <div
        v-if="data.total > data.porPagina"
        class="flex flex-wrap items-center justify-between gap-3 px-1 text-sm"
      >
        <span class="text-muted">
          {{ (filtros.pagina - 1) * filtros.porPagina + 1 }}–{{
            Math.min(filtros.pagina * filtros.porPagina, data.total)
          }}
          de {{ data.total }} lote(s)
        </span>
        <div class="flex items-center gap-2">
          <UButton
            icon="i-lucide-chevron-left"
            size="xs"
            color="neutral"
            variant="outline"
            :disabled="filtros.pagina <= 1"
            @click="filtros.pagina--"
          />
          <span class="text-xs text-muted">{{ filtros.pagina }} / {{ totalPaginas }}</span>
          <UButton
            icon="i-lucide-chevron-right"
            size="xs"
            color="neutral"
            variant="outline"
            :disabled="filtros.pagina >= totalPaginas"
            @click="filtros.pagina++"
          />
        </div>
      </div>

      <p v-else-if="data.total" class="px-1 text-sm text-muted">
        {{ data.total }} lote(s)
      </p>
    </div>
  </div>
</template>
