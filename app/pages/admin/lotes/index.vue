<script setup lang="ts">
import { dataHora, CORES_STATUS } from '~/utils/formato'

definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: 'Lotes — Gaulke Envios' })

const toast = useToast()
const { data, refresh, status } = await useFetch<RespostaLotes>(api('/api/admin/batches'))

// enquanto houver lote rodando, atualiza a lista sozinha
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => {
    if (data.value?.lotes.some(l => l.status === 'enviando')) refresh()
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

    <UCard v-if="!data?.lotes.length">
      <div class="space-y-3 py-10 text-center">
        <UIcon name="i-lucide-inbox" class="size-12 text-muted" />
        <p class="font-medium">Nenhum lote criado ainda</p>
        <p class="text-sm text-muted">Comece importando a lista de destinatários.</p>
        <UButton to="/admin/lotes/novo" icon="i-lucide-plus" label="Criar primeiro envio" class="mt-2" />
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
              Criado em {{ dataHora(l.createdAt) }} · intervalo de {{ l.intervaloMs / 1000 }}s
              <template v-if="l.arquivoNome"> · {{ l.arquivoNome }}</template>
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
    </div>
  </div>
</template>
