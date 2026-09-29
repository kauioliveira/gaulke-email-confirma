<script setup lang="ts">
import { dataHora } from '~/utils/formato'

/**
 * Lixeira: lotes já disparados que foram excluídos (exclusão lógica, D2).
 *
 * Nada aqui foi apagado — destinatários e eventos continuam guardados como
 * prova de entrega. Só o admin vê e restaura.
 */
definePageMeta({ layout: 'admin', middleware: 'admin', papel: 'admin' })
useHead({ title: 'Lixeira — Gaulke Comunica' })

const toast = useToast()
const { data, refresh, status } = await useFetch<{ lotes: LoteLixeira[]; apagarAposDias: number | null }>(api('/api/admin/lixeira'))
const apagaEm = (excluidoEm: string) =>
  data.value?.apagarAposDias ? new Date(new Date(excluidoEm).getTime() + data.value.apagarAposDias * 86_400_000).toISOString() : null
const restaurando = ref<number | null>(null)

async function restaurar(l: LoteLixeira) {
  restaurando.value = l.id
  try {
    await $fetch(api(`/api/admin/batches/${l.id}/restaurar`), { method: 'POST' })
    toast.add({
      title: `"${l.nome}" restaurado`,
      description: 'O lote voltou à lista e os links dos destinatários voltaram a funcionar.',
      color: 'success'
    })
    await refresh()
  } catch (e: any) {
    toast.add({ title: 'Não foi possível restaurar', description: e?.statusMessage, color: 'error' })
  } finally {
    restaurando.value = null
  }
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-semibold">Lixeira</h1>
      <p class="text-sm text-muted">
        Lotes já disparados que foram excluídos. Os registros de entrega continuam guardados; enquanto o lote
        estiver aqui, os links dos destinatários não abrem.
        <template v-if="data?.apagarAposDias"> Depois de {{ data.apagarAposDias }} dias na lixeira o lote é apagado de vez (retenção LGPD).</template>
      </p>
    </div>

    <UCard v-if="!data?.lotes.length">
      <div class="space-y-2 py-10 text-center">
        <UIcon name="i-lucide-trash" class="mx-auto size-10 text-muted" />
        <p class="font-medium">{{ status === 'pending' ? 'Carregando…' : 'A lixeira está vazia' }}</p>
      </div>
    </UCard>

    <div v-else class="grid gap-3">
      <UCard v-for="l in data.lotes" :key="l.id">
        <div class="flex flex-wrap items-start gap-4">
          <div class="min-w-0 flex-1">
            <NuxtLink :to="`/admin/lotes/${l.id}`" class="font-semibold hover:text-primary">{{ l.nome }}</NuxtLink>
            <p class="truncate text-sm text-muted">{{ l.assunto }}</p>
            <p class="mt-1 text-xs text-muted">
              {{ l.enviados }} de {{ l.total }} enviado(s)
              <template v-if="l.startedAt"> · disparado em {{ dataHora(l.startedAt) }}</template>
              <template v-if="l.disparadoPorNome"> por {{ l.disparadoPorNome }}</template>
            </p>
            <p class="mt-2 text-sm">
              <UIcon name="i-lucide-trash-2" class="mr-1 inline size-3.5 text-error" />
              Excluído em {{ dataHora(l.excluidoEm) }} por <strong>{{ l.excluidoPorNome ?? '—' }}</strong>
            </p>
            <p v-if="l.excluidoMotivo" class="text-sm text-muted">Motivo: {{ l.excluidoMotivo }}</p>
            <p v-if="l.excluidoEm && apagaEm(l.excluidoEm)" class="text-xs text-warning">
              Apagado de vez em {{ formatarData(apagaEm(l.excluidoEm)) }}
            </p>
          </div>
          <UButton
            label="Restaurar"
            icon="i-lucide-undo-2"
            color="neutral"
            variant="outline"
            :loading="restaurando === l.id"
            @click="restaurar(l)"
          />
        </div>
      </UCard>
    </div>
  </div>
</template>
