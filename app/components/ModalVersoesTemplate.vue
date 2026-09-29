<script setup lang="ts">
/**
 * Histórico de versões de um template, com "restaurar".
 *
 * Restaurar não apaga nada: vira uma versão nova, e a que estava em vigor
 * continua na lista — dá para desfazer a restauração do mesmo jeito.
 */
const props = defineProps<{ template: Template | null; podeRestaurar: boolean }>()
const aberto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ restaurado: [] }>()

const toast = useToast()
const versoes = ref<VersaoTemplate[]>([])
const carregando = ref(false)
const restaurando = ref<number | null>(null)

watch(aberto, async v => {
  if (!v || !props.template) return
  carregando.value = true
  try {
    versoes.value = (await $fetch<{ versoes: VersaoTemplate[] }>(api(`/api/admin/templates/${props.template.id}/versoes`))).versoes
  } finally {
    carregando.value = false
  }
})

async function restaurar(v: VersaoTemplate) {
  if (!props.template) return
  restaurando.value = v.versao
  try {
    const r = await $fetch<{ versao: number }>(
      api(`/api/admin/templates/${props.template.id}/versoes/${v.versao}/restaurar`),
      { method: 'POST' }
    )
    toast.add({ title: `Versão ${v.versao} restaurada`, description: `Ela agora é a versão ${r.versao}.`, color: 'success' })
    aberto.value = false
    emit('restaurado')
  } catch (e: any) {
    toast.add({ title: 'Não foi possível restaurar', description: e?.statusMessage, color: 'error' })
  } finally {
    restaurando.value = null
  }
}
</script>

<template>
  <UModal v-model:open="aberto" title="Histórico de versões" :description="template?.nome">
    <template #body>
      <p v-if="carregando" class="py-6 text-center text-sm text-muted">Carregando…</p>
      <ol v-else class="space-y-2">
        <li
          v-for="(v, i) in versoes"
          :key="v.versao"
          class="flex flex-wrap items-center gap-3 rounded-lg border border-default p-3"
        >
          <span class="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
            v{{ v.versao }}
          </span>
          <div class="min-w-0 flex-1 text-sm">
            <p class="font-medium">
              {{ v.nome }}
              <UBadge v-if="i === 0" class="ml-1" color="primary" variant="subtle" size="xs" label="atual" />
            </p>
            <p class="truncate text-xs text-muted">{{ v.assunto }}</p>
            <p class="text-xs text-muted">{{ formatarDataHora(v.salvoEm) }}<template v-if="v.salvoPorNome"> · {{ v.salvoPorNome }}</template></p>
          </div>
          <UButton
            v-if="i > 0 && podeRestaurar"
            label="Restaurar"
            icon="i-lucide-undo-2"
            size="xs"
            color="neutral"
            variant="outline"
            :loading="restaurando === v.versao"
            @click="restaurar(v)"
          />
        </li>
      </ol>
    </template>
  </UModal>
</template>
