<script setup lang="ts">
definePageMeta({ layout: 'admin' })
useHead({ title: 'Assinaturas — Gaulke Comunica' })

type Resposta = { documentos: ResumoAssinatura[]; contadores: { aguardando: number; concluido: number; recusado: number } }
const aba = ref('aguardando')
const minhas = ref(false)
const busca = ref('')
const buscaAtrasada = ref('')
let atraso: ReturnType<typeof setTimeout> | undefined
watch(busca, v => {
  clearTimeout(atraso)
  atraso = setTimeout(() => (buscaAtrasada.value = v.trim()), 300)
})
const { data, status } = await useFetch<Resposta>(api('/api/admin/assinaturas'), {
  query: computed(() => ({ status: aba.value, minhas: minhas.value ? '1' : undefined, busca: buscaAtrasada.value || undefined }))
})
const ABAS = computed(() => [
  { valor: 'aguardando', rotulo: 'Aguardando', n: data.value?.contadores.aguardando },
  { valor: 'concluido', rotulo: 'Assinados', n: null },
  { valor: 'recusado', rotulo: 'Recusados', n: data.value?.contadores.recusado || null },
  { valor: 'cancelado', rotulo: 'Cancelados', n: null },
  { valor: 'todos', rotulo: 'Todos', n: null }
])
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">Assinaturas</h1>
        <p class="text-sm text-muted">Documentos internos e contratos assinados eletronicamente, com o selo da Gaulke quando marcado.</p>
      </div>
      <UButton to="/admin/assinaturas/nova" label="Nova assinatura" icon="i-lucide-plus" />
    </div>

    <div class="flex flex-wrap items-center gap-3">
      <div class="flex flex-wrap gap-1">
        <UButton v-for="a in ABAS" :key="a.valor" :color="aba === a.valor ? 'primary' : 'neutral'" :variant="aba === a.valor ? 'soft' : 'ghost'" size="sm" @click="aba = a.valor">
          {{ a.rotulo }}
          <UBadge v-if="a.n" color="neutral" variant="subtle" size="sm">{{ a.n }}</UBadge>
        </UButton>
      </div>
      <USwitch v-model="minhas" label="Só as que eu enviei" class="ml-auto" />
      <UInput v-model="busca" icon="i-lucide-search" placeholder="Título, quem assina ou ASS-000045" class="w-full sm:w-72" />
    </div>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-elevated/50 text-left text-xs uppercase text-muted">
            <tr>
              <th class="px-3 py-2">Documento</th>
              <th class="px-3 py-2">Assinaturas</th>
              <th class="px-3 py-2">Situação</th>
              <th class="px-3 py-2">Prazo</th>
              <th class="px-3 py-2">Enviado por</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in data?.documentos" :key="d.id" class="cursor-pointer border-t border-default hover:bg-elevated/50" @click="navigateTo(`/admin/assinaturas/${d.id}`)">
              <td class="max-w-[340px] px-3 py-2">
                <NuxtLink :to="`/admin/assinaturas/${d.id}`" class="block truncate font-medium hover:text-primary" @click.stop>{{ d.titulo }}</NuxtLink>
                <p class="text-xs text-muted">
                  <span class="font-mono">{{ d.codigo }}</span> · {{ formatarData(d.createdAt) }}
                  <template v-if="d.clienteNome"> · {{ d.clienteNome }}</template>
                  <UIcon v-if="d.assinarComoGaulke" name="i-lucide-badge-check" class="ml-1 size-3.5 align-[-2px] text-primary" title="Com selo da Gaulke" />
                </p>
              </td>
              <td class="px-3 py-2">
                <div class="flex items-center gap-2">
                  <div class="h-1.5 w-20 overflow-hidden rounded-full bg-elevated">
                    <div class="h-full rounded-full bg-primary" :style="{ width: `${d.total ? (d.assinados / d.total) * 100 : 0}%` }" />
                  </div>
                  <span class="tabular-nums">{{ d.assinados }}/{{ d.total }}</span>
                </div>
                <p v-if="d.status === 'aguardando' && d.aguardando.length" class="mt-0.5 max-w-[220px] truncate text-xs text-muted">Com: {{ d.aguardando.join(', ') }}</p>
                <p v-if="d.finalizacaoErro" class="mt-0.5 text-xs text-error">PDF final falhou</p>
              </td>
              <td class="px-3 py-2"><UBadge :color="COR_STATUS_ASSIN[d.status]" variant="subtle">{{ ROTULO_STATUS_ASSIN[d.status] }}</UBadge></td>
              <td class="whitespace-nowrap px-3 py-2" :class="{ 'font-medium text-error': d.status === 'aguardando' && d.prazo && d.prazo < dataSP() }">{{ formatarPrazo(d.prazo) }}</td>
              <td class="max-w-[160px] truncate px-3 py-2 text-muted">{{ d.criadoPorNome || '—' }}</td>
            </tr>
          </tbody>
        </table>
        <div v-if="!data?.documentos.length" class="space-y-3 py-12 text-center">
          <UIcon name="i-lucide-signature" class="size-10 text-muted" />
          <p class="text-sm text-muted">{{ status === 'pending' ? 'Carregando…' : 'Nenhum documento aqui.' }}</p>
        </div>
      </div>
    </UCard>
  </div>
</template>
