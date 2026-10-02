<script setup lang="ts">
definePageMeta({ layout: 'admin' })
useHead({ title: 'Solicitações — Gaulke Comunica' })

/**
 * Solicitações de documentos. A aba padrão é "Em andamento"; "Para analisar"
 * é o que depende da Gaulke agora, "Atrasadas" o que depende do cliente e já
 * passou do prazo.
 */
type Resposta = {
  solicitacoes: ResumoSolicitacao[]
  total: number
  pagina: number
  porPagina: number
  contadores: { aberta: number; em_analise: number; atrasada: number; analisar: number }
}

const route = useRoute()
const router = useRouter()
const aba = ref(String(route.query.status || ''))
const minhas = ref(route.query.minhas === '1')
const busca = ref(String(route.query.busca || ''))
const pagina = ref(1)

const buscaAtrasada = ref(busca.value)
let atraso: ReturnType<typeof setTimeout> | undefined
watch(busca, v => {
  clearTimeout(atraso)
  atraso = setTimeout(() => (buscaAtrasada.value = v.trim()), 300)
})

const query = computed(() => ({
  status: aba.value || undefined,
  minhas: minhas.value ? '1' : undefined,
  busca: buscaAtrasada.value || undefined,
  pagina: pagina.value
}))
watch([aba, minhas, buscaAtrasada], () => {
  pagina.value = 1
  router.replace({ query: { ...query.value, pagina: undefined } })
})

const { data, status, refresh } = await useFetch<Resposta>(api('/api/admin/solicitacoes'), { query })

const ABAS = computed(() => [
  { valor: '', rotulo: 'Em andamento', n: data.value ? data.value.contadores.aberta + data.value.contadores.em_analise : null },
  { valor: 'analisar', rotulo: 'Para analisar', n: data.value?.contadores.analisar ?? null, destaque: true },
  { valor: 'atrasada', rotulo: 'Atrasadas', n: data.value?.contadores.atrasada ?? null },
  { valor: 'concluida', rotulo: 'Concluídas', n: null },
  { valor: 'cancelada', rotulo: 'Canceladas', n: null }
])

/* excluir de vez, direto da lista (o modal confere o que o cliente ja entregou) */
const { sessao, pode } = usePapel()
const podeExcluir = (s: ResumoSolicitacao) => pode('supervisor') || (!!sessao.value?.usuario?.id && s.criadoPorUserId === sessao.value.usuario.id)
const excluindo = ref<ResumoSolicitacao | null>(null)
const modalExcluir = ref(false)
function abrirExclusao(s: ResumoSolicitacao) {
  excluindo.value = s
  modalExcluir.value = true
}

const pct = (s: ResumoSolicitacao) => (s.obrigatorios ? Math.round((s.obrigatoriosEntregues / s.obrigatorios) * 100) : 0)
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">Solicitações de documentos</h1>
        <p class="text-sm text-muted">O cliente envia cada documento por um link; os arquivos ficam na pasta dele, aqui no sistema.</p>
      </div>
      <div class="flex gap-2">
        <UButton to="/admin/solicitacoes/modelos" label="Modelos de checklist" icon="i-lucide-list-checks" color="neutral" variant="outline" />
        <UButton to="/admin/solicitacoes/nova" label="Nova solicitação" icon="i-lucide-plus" />
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-3">
      <div class="flex flex-wrap gap-1">
        <UButton
          v-for="a in ABAS"
          :key="a.valor"
          :color="aba === a.valor ? 'primary' : 'neutral'"
          :variant="aba === a.valor ? 'soft' : 'ghost'"
          size="sm"
          @click="aba = a.valor"
        >
          {{ a.rotulo }}
          <UBadge v-if="a.n" :color="a.destaque ? 'info' : 'neutral'" variant="subtle" size="sm">{{ a.n }}</UBadge>
        </UButton>
      </div>
      <USwitch v-model="minhas" label="Só as que eu pedi" class="ml-auto" />
      <UInput v-model="busca" icon="i-lucide-search" placeholder="Cliente, CPF/CNPJ, título ou SOL-26-X7K2P9" class="w-full sm:w-80" />
    </div>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-elevated/50 text-left text-xs uppercase text-muted">
            <tr>
              <th class="px-3 py-2">Cliente</th>
              <th class="px-3 py-2">Solicitação</th>
              <th class="px-3 py-2">Entregue</th>
              <th class="px-3 py-2">Prazo</th>
              <th class="px-3 py-2">Situação</th>
              <th class="px-3 py-2">Pedido por</th>
              <th class="w-10 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="s in data?.solicitacoes"
              :key="s.id"
              class="cursor-pointer border-t border-default hover:bg-elevated/50"
              @click="navigateTo(`/admin/solicitacoes/${s.id}`)"
            >
              <td class="max-w-[260px] px-3 py-2">
                <p class="truncate font-medium">{{ s.empresa || s.destinatarioNome || s.destinatarioEmail }}</p>
                <p class="truncate text-xs text-muted">{{ s.empresa ? (s.destinatarioNome || s.destinatarioEmail) : s.destinatarioEmail }}</p>
              </td>
              <td class="max-w-[280px] px-3 py-2">
                <NuxtLink :to="`/admin/solicitacoes/${s.id}`" class="block truncate hover:text-primary" @click.stop>{{ s.titulo }}</NuxtLink>
                <p class="text-xs text-muted">
                  <span class="font-mono">{{ s.codigo }}</span> · {{ formatarData(s.createdAt) }}
                  <span v-if="s.envioErro" class="text-error"> · e-mail não saiu</span>
                  <span v-else-if="!s.enviadoEm && s.status !== 'cancelada'"> · enviando…</span>
                  <span v-else-if="!s.primeiroAcessoEm && s.status === 'aberta'"> · link ainda não aberto</span>
                </p>
              </td>
              <td class="px-3 py-2">
                <div class="flex items-center gap-2">
                  <div class="h-1.5 w-20 overflow-hidden rounded-full bg-elevated">
                    <div class="h-full rounded-full bg-primary" :style="{ width: `${pct(s)}%` }" />
                  </div>
                  <span class="tabular-nums">{{ s.obrigatoriosEntregues }}/{{ s.obrigatorios }}</span>
                </div>
                <p class="mt-0.5 text-xs text-muted">
                  <span v-if="s.paraAnalisar" class="font-medium text-info">{{ s.paraAnalisar }} para analisar</span>
                  <span v-if="s.paraAnalisar && s.recusados"> · </span>
                  <span v-if="s.recusados" class="text-error">{{ s.recusados }} recusado(s)</span>
                </p>
              </td>
              <td class="whitespace-nowrap px-3 py-2" :class="{ 'font-medium text-error': solicitacaoAtrasada(s) }">
                <UIcon v-if="solicitacaoAtrasada(s)" name="i-lucide-alarm-clock" class="mr-1 size-3.5 align-[-2px]" />
                {{ formatarPrazo(s.prazo) }}
              </td>
              <td class="px-3 py-2">
                <UBadge :color="COR_STATUS_SOLIC[s.status]" variant="subtle">{{ ROTULO_STATUS_SOLIC[s.status] }}</UBadge>
              </td>
              <td class="max-w-[160px] truncate px-3 py-2 text-muted">{{ s.criadoPorNome || '—' }}</td>
              <td class="px-2 py-2 text-right" @click.stop>
                <UTooltip :text="podeExcluir(s) ? 'Excluir definitivamente' : `Só quem pediu (${s.criadoPorNome || '—'}), supervisores e administradores excluem`">
                  <span class="inline-flex">
                    <UButton icon="i-lucide-trash-2" color="error" variant="ghost" size="xs" :disabled="!podeExcluir(s)" :aria-label="`Excluir ${s.codigo}`" @click="abrirExclusao(s)" />
                  </span>
                </UTooltip>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="!data?.solicitacoes.length" class="space-y-3 py-12 text-center">
          <UIcon name="i-lucide-folder-open" class="size-10 text-muted" />
          <p class="text-sm text-muted">{{ status === 'pending' ? 'Carregando…' : 'Nenhuma solicitação aqui.' }}</p>
          <UButton v-if="status !== 'pending' && !aba && !busca" to="/admin/solicitacoes/nova" label="Pedir documentos a um cliente" icon="i-lucide-plus" variant="soft" />
        </div>
      </div>
      <template v-if="data && data.total > data.porPagina" #footer>
        <div class="flex justify-end">
          <UPagination v-model:page="pagina" :total="data.total" :items-per-page="data.porPagina" />
        </div>
      </template>
    </UCard>

    <ModalExcluirSolicitacao
      v-model:open="modalExcluir"
      :solicitacao="excluindo"
      @excluida="refresh()"
      @cancelar="excluindo && navigateTo(`/admin/solicitacoes/${excluindo.id}`)"
    />
  </div>
</template>
