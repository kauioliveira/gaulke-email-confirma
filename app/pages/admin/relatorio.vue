<script setup lang="ts">
import { dataHora, CORES_STATUS } from '~/utils/formato'

definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: 'Relatório — Gaulke Envios' })

const route = useRoute()
const router = useRouter()

/**
 * O Reka UI (por tras do USelect) reserva a string vazia para "sem selecao",
 * entao nenhuma opcao pode ter value: ''. Usamos sentinelas e traduzimos
 * para "sem filtro" na hora de montar a query.
 */
const TODOS = 'todos'
const TODOS_LOTES = 0

const filtros = reactive({
  batchId: route.query.batchId ? Number(route.query.batchId) : TODOS_LOTES,
  status: TODOS,
  marco: TODOS,
  busca: '',
  de: '',
  ate: '',
  pagina: 1,
  porPagina: 50
})

/** Filtros no formato que a API espera: sentinelas viram undefined. */
const consulta = computed(() => ({
  batchId: filtros.batchId || undefined,
  status: filtros.status === TODOS ? undefined : filtros.status,
  marco: filtros.marco === TODOS ? undefined : filtros.marco,
  busca: filtros.busca || undefined,
  de: filtros.de || undefined,
  ate: filtros.ate || undefined,
  pagina: filtros.pagina,
  porPagina: filtros.porPagina
}))

// combo usa a lista enxuta: a principal e paginada e cortaria os lotes antigos
const { data: lotesData } = await useFetch<RespostaLotesOpcoes>(api('/api/admin/batches/opcoes'))
const { data, refresh, status: carregando } = await useFetch<RespostaRelatorio>(api('/api/admin/relatorio'), {
  query: consulta,
  watch: [consulta]
})

// filtros novos sempre voltam para a primeira pagina
watch(
  () => [filtros.batchId, filtros.status, filtros.marco, filtros.busca, filtros.de, filtros.ate],
  () => { filtros.pagina = 1 }
)

const opcoesLotes = computed(() => [
  { label: 'Todos os lotes', value: TODOS_LOTES },
  ...(lotesData.value?.lotes || []).map(l => ({ label: l.nome, value: l.id }))
])

const OPCOES_STATUS = [
  { label: 'Qualquer status', value: TODOS },
  { label: 'Pendente', value: 'pendente' },
  { label: 'Enviado', value: 'enviado' },
  { label: 'Erro', value: 'erro' }
]

const OPCOES_MARCO = [
  { label: 'Todos', value: TODOS },
  { label: 'Provável leitura (pessoa abriu)', value: 'abriu-pessoa' },
  { label: 'Só carregamento automático', value: 'abriu-so-maquina' },
  { label: 'Teve qualquer abertura', value: 'abriu' },
  { label: 'Acessou a página', value: 'acessou' },
  { label: 'Confirmou a leitura', value: 'confirmou' },
  { label: 'Baixou o arquivo', value: 'baixou' },
  { label: 'NÃO acessou', value: 'nao-acessou' },
  { label: 'NÃO confirmou', value: 'nao-confirmou' },
  { label: 'NÃO baixou', value: 'nao-baixou' }
]

const totalPaginas = computed(() => Math.max(1, Math.ceil((data.value?.total || 0) / filtros.porPagina)))

function exportar() {
  // exporta exatamente o que esta filtrado na tela
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(consulta.value)) {
    if (v !== undefined && v !== '' && !['pagina', 'porPagina'].includes(k)) q.set(k, String(v))
  }
  window.location.href = api(`/api/admin/relatorio/export?${q.toString()}`)
}

function limpar() {
  Object.assign(filtros, {
    batchId: TODOS_LOTES, status: TODOS, marco: TODOS,
    busca: '', de: '', ate: '', pagina: 1
  })
  router.replace({ query: {} })
}

function pct(parte: number, total: number) {
  return total ? `${Math.round((parte / total) * 100)}%` : '0%'
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">Relatório de envios</h1>
        <p class="text-sm text-muted">Quem recebeu, acessou, confirmou a leitura e baixou o arquivo.</p>
      </div>
      <div class="flex gap-2">
        <UButton icon="i-lucide-refresh-cw" color="neutral" variant="outline" :loading="carregando === 'pending'" @click="refresh()" />
        <UButton icon="i-lucide-download" label="Exportar CSV" color="neutral" variant="outline" @click="exportar" />
      </div>
    </div>

    <!-- Resumo -->
    <div v-if="data?.resumo" class="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
      <UCard v-for="m in [
        { r: 'Destinatários', v: data.resumo.total, p: '' },
        { r: 'Enviados', v: data.resumo.enviados, p: pct(data.resumo.enviados, data.resumo.total) },
        { r: 'Falhas', v: data.resumo.erros, p: pct(data.resumo.erros, data.resumo.total) },
        { r: 'Prováveis leituras', v: data.resumo.aberturasPessoa, p: pct(data.resumo.aberturasPessoa, data.resumo.total) },
        { r: 'Só automático', v: data.resumo.aberturasMaquina, p: pct(data.resumo.aberturasMaquina, data.resumo.total) },
        { r: 'Acessos', v: data.resumo.acessos, p: pct(data.resumo.acessos, data.resumo.total) },
        { r: 'Confirmações', v: data.resumo.confirmacoes, p: pct(data.resumo.confirmacoes, data.resumo.total) },
        { r: 'Downloads', v: data.resumo.downloads, p: pct(data.resumo.downloads, data.resumo.total) }
      ]" :key="m.r" :ui="{ body: 'p-3 sm:p-3' }">
        <p class="text-xs text-muted">{{ m.r }}</p>
        <p class="text-2xl font-semibold">{{ m.v }}</p>
        <p v-if="m.p" class="text-xs text-muted">{{ m.p }}</p>
      </UCard>
    </div>
    <p class="-mt-3 text-xs text-muted">
      <strong>Prováveis leituras</strong> exclui o que identificamos como carregamento automático
      (Apple Mail, proxy do Gmail, antivírus corporativo, ou abertura em menos de 30s após o envio).
      Ainda assim é <strong>estimativa</strong>: quem bloqueia imagens lê sem aparecer aqui.
      A prova de leitura continua sendo a <strong>confirmação</strong> na página.
    </p>

    <!-- Filtros -->
    <UCard>
      <div class="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
        <UFormField label="Lote" class="lg:col-span-2">
          <USelect v-model="filtros.batchId" :items="opcoesLotes" class="w-full" />
        </UFormField>
        <UFormField label="Status do envio">
          <USelect v-model="filtros.status" :items="OPCOES_STATUS" class="w-full" />
        </UFormField>
        <UFormField label="Comportamento">
          <USelect v-model="filtros.marco" :items="OPCOES_MARCO" class="w-full" />
        </UFormField>
        <UFormField label="De">
          <UInput v-model="filtros.de" type="date" class="w-full" />
        </UFormField>
        <UFormField label="Até">
          <UInput v-model="filtros.ate" type="date" class="w-full" />
        </UFormField>
        <UFormField label="Buscar" class="md:col-span-2 lg:col-span-5">
          <UInput v-model="filtros.busca" icon="i-lucide-search" placeholder="Nome, e-mail, empresa ou código" class="w-full" />
        </UFormField>
        <UFormField label="&nbsp;">
          <UButton label="Limpar filtros" color="neutral" variant="outline" block @click="limpar" />
        </UFormField>
      </div>
    </UCard>

    <!-- Tabela -->
    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-elevated/50 text-left text-xs uppercase text-muted">
            <tr>
              <th class="px-3 py-3">Destinatário</th>
              <th class="px-3 py-3">Código</th>
              <th class="px-3 py-3">Lote</th>
              <th class="px-3 py-3">Status</th>
              <th class="px-3 py-3">Enviado</th>
              <th class="px-3 py-3">Abertura</th>
              <th class="px-3 py-3">Acessou</th>
              <th class="px-3 py-3">Confirmou</th>
              <th class="px-3 py-3">Baixou</th>
              <th class="px-3 py-3">Último IP</th>
              <th class="px-3 py-3" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in data?.linhas" :key="l.id" class="border-t border-default hover:bg-elevated/30">
              <td class="max-w-[220px] px-3 py-2">
                <p class="truncate font-medium">{{ l.nome || '—' }}</p>
                <p class="truncate text-xs text-muted">{{ l.email }}</p>
                <p v-if="l.empresa" class="truncate text-xs text-muted">{{ l.empresa }}</p>
              </td>
              <td class="px-3 py-2 font-mono text-xs">{{ l.codigo }}</td>
              <td class="max-w-[140px] truncate px-3 py-2 text-xs text-muted">
                {{ l.loteNome }}
                <!-- quem disparou fica junto do lote: e por lote, nao por pessoa -->
                <span v-if="l.loteDisparadoPor" class="block truncate opacity-70">
                  por {{ l.loteDisparadoPor }}
                </span>
              </td>
              <td class="px-3 py-2">
                <UBadge :color="(CORES_STATUS[l.status] as any) || 'neutral'" variant="subtle" size="xs" :label="l.status" />
                <UTooltip v-if="l.ultimoErro" :text="l.ultimoErro">
                  <UIcon name="i-lucide-circle-alert" class="ml-1 size-3.5 text-error" />
                </UTooltip>
              </td>
              <td class="px-3 py-2 text-xs">{{ dataHora(l.sentAt) }}</td>
              <td class="px-3 py-2 text-xs">
                <template v-if="l.firstHumanOpenAt">
                  <span class="text-info">{{ dataHora(l.firstHumanOpenAt) }}</span>
                  <span v-if="l.openCount > 1" class="block text-muted">{{ l.openCount }}x · última {{ dataHora(l.lastOpenAt) }}</span>
                </template>
                <UTooltip
                  v-else-if="l.firstOpenAt"
                  text="Só carregamento automático do cliente de e-mail — não indica leitura"
                >
                  <span class="text-muted italic">automático ({{ l.openCount }}x)</span>
                </UTooltip>
                <span v-else>—</span>
              </td>
              <td class="px-3 py-2 text-xs" :class="l.firstAccessAt && 'text-info'">{{ dataHora(l.firstAccessAt) }}</td>
              <td class="px-3 py-2 text-xs" :class="l.confirmedAt && 'font-medium text-primary'">{{ dataHora(l.confirmedAt) }}</td>
              <td class="px-3 py-2 text-xs" :class="l.firstDownloadAt && 'text-primary'">
                {{ dataHora(l.firstDownloadAt) }}
                <span v-if="l.downloadCount > 1" class="text-muted">({{ l.downloadCount }}x)</span>
              </td>
              <td class="px-3 py-2 font-mono text-xs text-muted">{{ l.ultimoIp || '—' }}</td>
              <td class="px-3 py-2">
                <UButton :to="`/admin/destinatario/${l.id}`" icon="i-lucide-arrow-right" size="xs" color="neutral" variant="ghost" />
              </td>
            </tr>
          </tbody>
        </table>

        <p v-if="!data?.linhas.length" class="py-12 text-center text-muted">
          Nenhum registro encontrado com esses filtros.
        </p>
      </div>

      <div v-if="data?.total" class="flex flex-wrap items-center justify-between gap-3 border-t border-default px-3 py-3 text-sm">
        <span class="text-muted">
          {{ (filtros.pagina - 1) * filtros.porPagina + 1 }}–{{ Math.min(filtros.pagina * filtros.porPagina, data.total) }}
          de {{ data.total }}
        </span>
        <div class="flex items-center gap-2">
          <UButton icon="i-lucide-chevron-left" size="xs" color="neutral" variant="outline" :disabled="filtros.pagina <= 1" @click="filtros.pagina--" />
          <span class="text-xs text-muted">{{ filtros.pagina }} / {{ totalPaginas }}</span>
          <UButton icon="i-lucide-chevron-right" size="xs" color="neutral" variant="outline" :disabled="filtros.pagina >= totalPaginas" @click="filtros.pagina++" />
        </div>
      </div>
    </UCard>
  </div>
</template>
