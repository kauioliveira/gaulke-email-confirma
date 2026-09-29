<script setup lang="ts">
import { dataHora } from '~/utils/formato'

/**
 * Listas de contatos salvas: montadas uma vez ("Clientes do Simples", "DP -
 * folha") e usadas no novo envio e nas solicitações.
 */
definePageMeta({ layout: 'admin' })
useHead({ title: 'Listas de contatos — Gaulke Comunica' })

const toast = useToast()
const { data: listas, refresh, status } = await useFetch<ResumoLista[]>(api('/api/admin/listas'), { default: () => [] })

const busca = ref('')
const filtradas = computed(() => {
  const q = busca.value.trim().toLowerCase()
  return q ? listas.value.filter(l => `${l.nome} ${l.descricao ?? ''}`.toLowerCase().includes(q)) : listas.value
})

const modalNova = ref(false)
const nova = reactive({ nome: '', descricao: '' })
const criando = ref(false)
async function criar() {
  criando.value = true
  try {
    const r = await $fetch<{ id: number }>(api('/api/admin/listas'), {
      method: 'POST',
      body: { nome: nova.nome, descricao: nova.descricao || null }
    })
    modalNova.value = false
    nova.nome = ''
    nova.descricao = ''
    await navigateTo(`/admin/listas/${r.id}`)
  } catch (e: any) {
    toast.add({ title: 'Não foi possível criar', description: e?.data?.statusMessage || e?.statusMessage, color: 'error' })
  } finally {
    criando.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">Listas de contatos</h1>
        <p class="text-sm text-muted">
          Monte uma vez e use no novo envio e nas solicitações. Mudar a lista depois não altera o que já foi enviado.
        </p>
      </div>
      <UButton label="Nova lista" icon="i-lucide-plus" @click="modalNova = true" />
    </div>

    <UInput v-if="listas.length > 5" v-model="busca" icon="i-lucide-search" placeholder="Buscar lista" class="w-full sm:w-80" />

    <UCard v-if="!filtradas.length">
      <div class="space-y-2 py-10 text-center">
        <UIcon name="i-lucide-list" class="mx-auto size-10 text-muted" />
        <p class="font-medium">{{ status === 'pending' ? 'Carregando…' : busca ? 'Nenhuma lista com esse nome' : 'Nenhuma lista ainda' }}</p>
        <p v-if="!busca && status !== 'pending'" class="text-sm text-muted">
          Crie aqui, ou use “Salvar como lista” no passo 1 do novo envio.
        </p>
      </div>
    </UCard>

    <div v-else class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <NuxtLink
        v-for="l in filtradas"
        :key="l.id"
        :to="`/admin/listas/${l.id}`"
        class="rounded-lg border border-default bg-default p-4 transition hover:border-primary"
      >
        <div class="flex items-start gap-3">
          <UIcon name="i-lucide-list" class="mt-0.5 size-5 shrink-0 text-primary" />
          <div class="min-w-0 flex-1">
            <p class="truncate font-semibold">{{ l.nome }}</p>
            <p v-if="l.descricao" class="line-clamp-2 text-sm text-muted">{{ l.descricao }}</p>
            <p class="mt-2 text-xs text-muted">
              Atualizada em {{ dataHora(l.atualizadoEm) }}<template v-if="l.atualizadoPorNome"> por {{ l.atualizadoPorNome }}</template>
            </p>
          </div>
          <UBadge color="neutral" variant="subtle" :label="`${l.total} contato(s)`" class="shrink-0" />
        </div>
      </NuxtLink>
    </div>

    <UModal v-model:open="modalNova" title="Nova lista">
      <template #body>
        <form class="space-y-4" @submit.prevent="criar">
          <UFormField label="Nome" required>
            <UInput v-model="nova.nome" placeholder="Clientes do Simples Nacional" class="w-full" autofocus />
          </UFormField>
          <UFormField label="Descrição" hint="opcional">
            <UTextarea v-model="nova.descricao" :rows="2" placeholder="Para que serve, quem mantém" class="w-full" />
          </UFormField>
          <div class="flex justify-end gap-2">
            <UButton label="Cancelar" color="neutral" variant="ghost" @click="modalNova = false" />
            <UButton type="submit" label="Criar e acrescentar contatos" :loading="criando" :disabled="nova.nome.trim().length < 2" />
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>
